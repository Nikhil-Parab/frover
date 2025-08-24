import {
  Env,
  ConversationData,
  QueryOptions,
  QueryResult,
  SearchResult,
  AgentTool,
} from "../types";
import { EmbeddingService } from "./embeddings";
import { PineconeService } from "./pinecone";
import { StorageService } from "./storage";
import { CacheService } from "../utils/cache";

export class RAGAgent {
  private embedding: EmbeddingService;
  private pinecone: PineconeService;
  private storage: StorageService;
  private cache: CacheService;

  constructor(env: Env) {
    this.embedding = new EmbeddingService(env);
    this.pinecone = new PineconeService({
      PINECONE_API_KEY: env.PINECONE_API_KEY,
      PINECONE_ENVIRONMENT: env.PINECONE_ENVIRONMENT,
      PINECONE_INDEX_NAME: "conversation-history",
      PINECONE_INDEX_URL: env.PINECONE_INDEX_URL,
    });
    this.storage = new StorageService(env);
    this.cache = new CacheService(env);
  }

  /** Store conversation in KV + Pinecone */
  async write(
    data: ConversationData
  ): Promise<{ success: boolean; message: string }> {
    try {
      console.log("📝 Writing data:", data.id);

      // Store in KV
      await this.storage.store(data);
      console.log("✅ Stored in KV");

      // Chunk + embed + push into Pinecone
      const chunks = this.embedding.chunkText(data.content);
      console.log("📄 Created chunks:", chunks.length);

      const vectors = await Promise.all(
        chunks.map(async (chunk, i) => {
          const chunkId = `${data.id}_chunk_${i}`;
          console.log(
            `🧠 Generating embedding for chunk ${i}:`,
            chunk.substring(0, 100)
          );
          const embedding = await this.embedding.generateEmbedding(chunk);
          console.log(
            `📊 Embedding dimensions for chunk ${i}:`,
            embedding.length
          );

          return {
            id: chunkId,
            values: embedding,
            metadata: {
              originalId: data.id,
              content: chunk,
              chunkIndex: i,
              totalChunks: chunks.length,
              ...data.metadata,
            },
          };
        })
      );

      console.log("🚀 Upserting to Pinecone...");
      await this.pinecone.upsert(vectors);
      console.log("✅ Successfully stored in Pinecone");

      return { success: true, message: "Data stored successfully" };
    } catch (error) {
      console.error("❌ Error in write:", error);
      return { success: false, message: "Failed to store data" };
    }
  }

  /** Query Pinecone + cache results */
  async query(query: string, options: QueryOptions = {}): Promise<QueryResult> {
    try {
      const cacheKey = `query:${btoa(query)}:${JSON.stringify(options)}`;
      const cached = await this.cache.get<QueryResult>(cacheKey);
      if (cached) {
        console.log("💾 Returning cached result");
        return cached;
      }

      // Embed query
      console.log("🔍 Query:", query);
      const queryEmbedding = await this.embedding.generateEmbedding(query);
      console.log("📊 Query embedding dimensions:", queryEmbedding.length);
      console.log("📊 First 5 embedding values:", queryEmbedding.slice(0, 5));

      // Build filter
      const filter: Record<string, any> = {};
      if (options.userId) filter.userId = options.userId;
      if (options.conversationId)
        filter.conversationId = options.conversationId;
      console.log("🔧 Filter:", filter);

      // Pinecone search
      console.log("🎯 Starting Pinecone search...");
      const searchResult = await this.pinecone.query(queryEmbedding, {
        topK: options.limit || 10,
        filter: Object.keys(filter).length ? filter : undefined,
        includeMetadata: true,
      });

      console.log(
        "🎯 Pinecone raw response:",
        JSON.stringify(searchResult, null, 2)
      );
      console.log("🎯 Number of matches:", searchResult.matches?.length || 0);

      // Log each match with score
      if (searchResult.matches) {
        searchResult.matches.forEach((match, i) => {
          console.log(`📋 Match ${i}:`, {
            id: match.id,
            score: match.score,
            content: match.metadata?.content?.substring(0, 100) + "...",
          });
        });
      }

      // Extract usable results
      const threshold = options.threshold ?? 0.3;
      console.log("🎚️ Using threshold:", threshold);

      const sources: SearchResult[] = (searchResult.matches || [])
        .filter((m) => {
          const passesThreshold = m.score >= threshold;
          if (!passesThreshold) {
            console.log(
              `❌ Match ${m.id} filtered out: score ${m.score} < ${threshold}`
            );
          }
          return passesThreshold;
        })
        .map((m) => ({
          id: m.metadata?.originalId || m.id,
          content: m.metadata?.content || "",
          score: m.score,
          metadata: options.includeMetadata ? m.metadata : undefined,
        }));

      console.log("✅ Final sources after filtering:", sources.length);

      // Generate AI-style response
      const context = sources.map((s) => s.content).join("\n\n");
      console.log("📝 Context length:", context.length);
      console.log("📝 Context preview:", context.substring(0, 200));

      const answer = await this.generateAnswer(query, context);

      const result: QueryResult = {
        answer,
        sources,
        confidence: sources[0]?.score ?? 0,
      };

      await this.cache.set(cacheKey, result, 300); // cache for 5 min
      return result;
    } catch (error) {
      console.error("❌ Error in query:", error);
      return {
        answer: "Sorry, I hit an error while searching for info.",
        sources: [],
        confidence: 0,
      };
    }
  }

  /** Retrieve from KV */
  async read(id: string): Promise<ConversationData | null> {
    return this.storage.retrieve(id);
  }

  /** Delete from KV + Pinecone */
  async delete(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.storage.delete(id);
      await this.pinecone.deleteByFilter({ originalId: id });

      return { success: true, message: "Data deleted successfully" };
    } catch (error) {
      console.error("❌ Error in delete:", error);
      return { success: false, message: "Failed to delete data" };
    }
  }

  /** Generate answer from retrieved context */
  private async generateAnswer(
    query: string,
    context: string
  ): Promise<string> {
    if (!context.trim()) {
      return "I don't have enough relevant information in my knowledge base to answer this.";
    }

    // TODO: Replace with LLM call if you want proper answers
    return `Q: ${query}\n\nBased on retrieved info: ${context.substring(
      0,
      300
    )}...`;
  }
  /** Custom query for meeting and related meetings */
  async queryMeetingAndRelated(query: string, meetingId: string): Promise<any> {
    try {
      console.log("🔍 Looking up meeting:", meetingId);

      // Embed the query
      const queryEmbedding = await this.embedding.generateEmbedding(query);

      // Search Pinecone for matches
      const searchResult = await this.pinecone.query(queryEmbedding, {
        topK: 20,
        includeMetadata: true,
      });

      const matches = searchResult.matches || [];
      console.log("🎯 Total matches:", matches.length);

      // Find the main meeting
      const mainMeeting = matches.find(
        (m) => m.metadata?.originalId === meetingId
      );

      if (!mainMeeting) {
        return { error: `Meeting ${meetingId} not found.` };
      }

      const discussedTopics = mainMeeting.metadata?.topics || [];
      console.log("📌 Topics in main meeting:", discussedTopics);

      // Find related meetings with same topics
      const relatedMeetings = matches.filter(
        (m) =>
          m.metadata?.originalId !== meetingId &&
          m.metadata?.topics?.some((topic: string) =>
            discussedTopics.includes(topic)
          )
      );

      return {
        main_meeting: {
          id: mainMeeting.metadata?.originalId,
          content: mainMeeting.metadata?.content,
          topics: discussedTopics,
        },
        related_meetings: relatedMeetings.map((m) => ({
          id: m.metadata?.originalId,
          topics: m.metadata?.topics,
          content: m.metadata?.content,
        })),
      };
    } catch (error) {
      console.error("❌ Error in queryMeetingAndRelated:", error);
      return { error: "Internal server error" };
    }
  }

  /** List available tools for agent */
  getAgentTools(): AgentTool[] {
    return [
      {
        name: "search_conversations",
        description:
          "Search through past conversations for relevant information",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            userId: {
              type: "string",
              description: "Optional filter by userId",
            },
            limit: {
              type: "number",
              description: "Max results (default: 10)",
              minimum: 1,
              maximum: 50,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "store_conversation",
        description: "Store a new conversation/message for future retrieval",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique conversation/message ID",
            },
            content: { type: "string", description: "Content to store" },
            metadata: {
              type: "object",
              description: "Extra metadata (userId, conversationId, etc.)",
            },
          },
          required: ["id", "content"],
        },
      },
    ];
  }
}
