// src/rag/brain.ts - Enhanced RAG Brain Agent (hybrid: Pinecone or KV-only)
// - Full CRUD
// - Semantic search (Pinecone if configured, otherwise in-memory cosine search)
// - Chunked indexing, caching, analytics, bulk ops

import {
  Env,
  ConversationData,
  QueryOptions,
  QueryResult,
  SearchResult,
  AgentTool,
  BrainData,
  BrainQueryOptions,
  BrainEntity,
  CRUDResult,
} from "../types";
import { EmbeddingService } from "./embeddings";
import { StorageService } from "./storage";
import { CacheService } from "../utils/cache";

// Optional Pinecone import; guard all calls if it's not configured
// If you don't have this file, keep the import and mode will fall back automatically.
import { PineconeService } from "./pinecone";

// ---------- utils ----------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function hasPinecone(env: Env): boolean {
  return Boolean(env.PINECONE_API_KEY && env.PINECONE_INDEX_URL);
}

export class RAGBrainAgent {
  private embedding: EmbeddingService;
  private storage: StorageService;
  private cache: CacheService;
  private pinecone?: PineconeService; // only if configured

  constructor(private env: Env) {
    this.embedding = new EmbeddingService(env);
    this.storage = new StorageService(env);
    this.cache = new CacheService(env);

    if (hasPinecone(env)) {
      this.pinecone = new PineconeService({
        PINECONE_API_KEY: env.PINECONE_API_KEY,
        PINECONE_ENVIRONMENT: env.PINECONE_ENVIRONMENT,
        PINECONE_INDEX_NAME: "conversation-history",
        PINECONE_INDEX_URL: env.PINECONE_INDEX_URL,
      });
    }
  }

  // =====================================================
  // ENHANCED CRUD OPERATIONS
  // =====================================================

  /** CREATE - Store any type of data with intelligent indexing */
  async create(data: BrainData): Promise<CRUDResult> {
    try {
      console.log("🧠 BRAIN CREATE:", data.id, "Type:", data.type);

      if (!data.id || !data.content || !data.type) {
        return {
          success: false,
          message: "Missing required fields: id, content, type",
          data: null,
        };
      }

      const enrichedData: BrainEntity = {
        ...data,
        metadata: {
          ...data.metadata,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
          indexed: false,
        },
      };

      await this.storage.storeBrainData(enrichedData);
      console.log("✅ Stored in KV");

      await this.indexContent(enrichedData);
      await this.clearRelatedCaches(data.type, data.metadata?.category);

      return {
        success: true,
        message: "Data created and indexed successfully",
        data: enrichedData,
      };
    } catch (error) {
      console.error("❌ Brain CREATE error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to create: ${msg}`,
        data: null,
      };
    }
  }

  /** GET BY ID - exact fetch from KV */
  async getById(id: string): Promise<CRUDResult> {
    try {
      const entity = await this.storage.retrieveBrainData(id);
      if (!entity) {
        return {
          success: false,
          message: `Data with ID ${id} not found`,
          data: null,
        };
      }
      return {
        success: true,
        message: "Data retrieved successfully",
        data: entity,
      };
    } catch (error) {
      console.error("❌ Brain GET error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Failed to fetch: ${msg}`, data: null };
    }
  }

  /** READ - Intelligent retrieval with multiple strategies */
  async read(
    query:
      | string
      | { id?: string; type?: string; filters?: Record<string, any> },
    options: BrainQueryOptions = {}
  ): Promise<QueryResult> {
    try {
      console.log("🧠 BRAIN READ:", typeof query === "string" ? query : query);

      // Strategy 1: Direct ID
      if (typeof query === "object" && query.id) {
        const direct = await this.storage.retrieveBrainData(query.id);
        if (direct) {
          return {
            answer: `Found direct match for ID: ${query.id}`,
            sources: [
              {
                id: direct.id,
                content: direct.content,
                score: 1.0,
                metadata: direct.metadata,
              },
            ],
            confidence: 1.0,
            strategy: "direct_lookup",
          };
        }
      }

      // Strategy 2: Type filter
      if (typeof query === "object" && query.type) {
        const typeResults = await this.storage.listByType(
          query.type,
          options.limit || 10
        );
        if (typeResults.length > 0) {
          return {
            answer: `Found ${typeResults.length} items of type: ${query.type}`,
            sources: typeResults.map((item) => ({
              id: item.id,
              content: item.content,
              score: 0.9,
              metadata: item.metadata,
            })),
            confidence: 0.9,
            strategy: "type_filter",
          };
        }
      }

      // Strategy 3: Semantic search
      const searchQuery =
        typeof query === "string"
          ? query
          : query.filters?.searchTerm || "general search";

      return await this.semanticSearch(searchQuery, options);
    } catch (error) {
      console.error("❌ Brain READ error:", error);
      return {
        answer: "Error occurred during read operation",
        sources: [],
        confidence: 0,
        strategy: "error",
      };
    }
  }

  /** UPDATE - Modify existing data with versioning */
  async update(id: string, updates: Partial<BrainData>): Promise<CRUDResult> {
    try {
      console.log("🧠 BRAIN UPDATE:", id);
      const existing = await this.storage.retrieveBrainData(id);
      if (!existing) {
        return {
          success: false,
          message: `Data with ID ${id} not found`,
          data: null,
        };
      }

      const updatedData: BrainEntity = {
        ...existing,
        ...updates,
        id,
        metadata: {
          ...existing.metadata,
          ...updates.metadata,
          updatedAt: Date.now(),
          version: (existing.metadata?.version || 1) + 1,
          previousVersion: existing.metadata?.version || 1,
        },
      };

      await this.storage.storeBrainData(updatedData);

      if (updates.content && updates.content !== existing.content) {
        console.log("📝 Content changed, re-indexing...");
        await this.deleteFromIndex(id);
        await this.indexContent(updatedData);
      }

      await this.clearRelatedCaches(
        updatedData.type,
        updatedData.metadata?.category
      );
      return {
        success: true,
        message: "Data updated successfully",
        data: updatedData,
      };
    } catch (error) {
      console.error("❌ Brain UPDATE error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to update: ${msg}`,
        data: null,
      };
    }
  }

  /** DELETE - Remove data from all storage layers */
  async delete(id: string): Promise<CRUDResult> {
    try {
      console.log("🧠 BRAIN DELETE:", id);

      const existing = await this.storage.retrieveBrainData(id);
      await this.storage.deleteBrainData(id);
      await this.deleteFromIndex(id);

      if (existing) {
        await this.clearRelatedCaches(
          existing.type,
          existing.metadata?.category
        );
      }

      return {
        success: true,
        message: "Data deleted successfully",
        data: null,
      };
    } catch (error) {
      console.error("❌ Brain DELETE error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to delete: ${msg}`,
        data: null,
      };
    }
  }

  // =====================================================
  // INTELLIGENT SEARCH & ANALYSIS
  // =====================================================

  /** Hybrid semantic search: Pinecone (if available) OR KV-only cosine search */
  private async semanticSearch(
    query: string,
    options: BrainQueryOptions
  ): Promise<QueryResult> {
    const cacheKey = `semantic:${btoa(query)}:${JSON.stringify(options)}`;
    const cached = await this.cache.get<QueryResult>(cacheKey);
    if (cached) {
      console.log("💾 Returning cached semantic search");
      return { ...cached, strategy: "cached_semantic" };
    }

    // 1) Build query embedding
    const queryEmbedding = await this.embedding.generateEmbedding(query);

    // 2) If Pinecone is configured, use it
    if (this.pinecone) {
      const filter: Record<string, any> = {};
      if (options.type) filter.type = options.type;
      if (options.category) filter.category = options.category;
      if (options.userId) filter.userId = options.userId;
      if (options.dateRange) {
        filter.createdAt = {
          $gte: options.dateRange.start,
          $lte: options.dateRange.end,
        };
      }

      const searchResult = await this.pinecone.query(queryEmbedding, {
        topK: options.limit || 10,
        filter: Object.keys(filter).length ? filter : undefined,
        includeMetadata: true,
      });

      const threshold = options.threshold ?? 0.3;
      const sources: SearchResult[] = (searchResult.matches || [])
        .filter((m: any) => m.score >= threshold)
        .map((m: any) => ({
          id: m.metadata?.originalId || m.id,
          content: m.metadata?.content || "",
          score: m.score,
          metadata: options.includeMetadata ? m.metadata : undefined,
        }));

      const answer = await this.generateIntelligentAnswer(
        query,
        sources,
        options
      );

      const result: QueryResult = {
        answer,
        sources,
        confidence: sources[0]?.score ?? 0,
        strategy: "semantic_search_pinecone",
        metadata: {
          totalMatches: searchResult.matches?.length || 0,
          filteredMatches: sources.length,
          threshold,
          processingTime: Date.now(),
        },
      };

      await this.cache.set(cacheKey, result, 300);
      return result;
    }

    // 3) KV-only fallback: fetch candidates & compute cosine similarity
    console.log("🧩 Pinecone not configured — using KV-only semantic search");
    const candidates = await this.storage.getEntities({
      type: options.type,
      category: options.category,
      ids: options.ids,
    });

    // Ensure each candidate has an embedding (store in metadata.embedding)
    const enriched = [];
    for (const c of candidates) {
      let emb = c.metadata?.embedding as number[] | undefined;

      if (!emb) {
        // Chunk content; use the first chunk embedding as a doc-level embedding for quick search
        const chunks = this.embedding.chunkText(c.content);
        const firstChunk = chunks[0] ?? c.content;
        emb = await this.embedding.generateEmbedding(firstChunk);

        // persist back for next time
        const updated: BrainEntity = {
          ...c,
          metadata: {
            ...c.metadata,
            embedding: emb,
            indexed: true,
            indexedAt: Date.now(),
          },
        };
        await this.storage.storeBrainData(updated);
        enriched.push(updated);
      } else {
        enriched.push(c);
      }
    }

    // Score
    const scored = enriched
      .map((e) => {
        const docEmb = (e.metadata?.embedding as number[]) || [];
        const score = cosineSimilarity(queryEmbedding, docEmb);
        return { entity: e, score };
      })
      .sort((a, b) => b.score - a.score);

    const threshold = options.threshold ?? 0.25; // slightly lower for doc-level cosine
    const topN = (
      options.limit && options.limit > 0 ? options.limit : 10
    ) as number;

    const sources: SearchResult[] = scored
      .filter((s) => s.score >= threshold)
      .slice(0, topN)
      .map((s) => ({
        id: s.entity.id,
        content: s.entity.content,
        score: s.score,
        metadata: options.includeMetadata ? s.entity.metadata : undefined,
      }));

    const answer = await this.generateIntelligentAnswer(
      query,
      sources,
      options
    );

    const result: QueryResult = {
      answer,
      sources,
      confidence: sources[0]?.score ?? 0,
      strategy: "semantic_search_kv",
      metadata: {
        totalMatches: scored.length,
        filteredMatches: sources.length,
        threshold,
        processingTime: Date.now(),
      },
    };

    await this.cache.set(cacheKey, result, 300);
    return result;
  }

  /** Generate contextual answers based on retrieved data */
  /** Generate contextual answers based on retrieved data */
  private async generateIntelligentAnswer(
    query: string,
    sources: SearchResult[],
    options: BrainQueryOptions
  ): Promise<string> {
    if (sources.length === 0) {
      return `I couldn't find relevant information for "${query}" in my knowledge base.`;
    }

    // Check if this is a meeting query
    const meetingMatch = query.match(/meeting[_\s]*id[_\s]*(\d+)/i);
    if (meetingMatch) {
      const meetingId = meetingMatch[1];
      const targetMeeting = sources.find(
        (s) =>
          s.id.includes(meetingId) ||
          s.content.includes(`meeting_id_${meetingId}`)
      );

      if (targetMeeting) {
        let answer = `Meeting ${meetingId} Discussion:\n\n`;
        answer += `What was discussed: ${targetMeeting.content}\n\n`;

        const relatedMeetings = sources.filter(
          (s) => s.id !== targetMeeting.id
        );
        if (relatedMeetings.length > 0) {
          answer += `Related meetings with similar topics:\n`;
          relatedMeetings.slice(0, 3).forEach((meeting) => {
            const id = meeting.id.match(/(\d+)/)?.[1] || meeting.id;
            answer += `- Meeting ${id}: ${meeting.content.substring(
              0,
              100
            )}...\n`;
          });
        }
        return answer;
      }
    }

    const context = sources.map((s) => s.content).join("\n\n");

    if (options.responseStyle === "summary") {
      return `Based on ${sources.length} relevant sources: ${context.substring(
        0,
        200
      )}...`;
    }

    if (options.responseStyle === "detailed") {
      return `Query: ${query}\n\nDetailed analysis based on ${sources.length} sources:\n\n${context}`;
    }

    return `Found ${sources.length} relevant items. Top result (${Math.round(
      (sources[0].score || 0) * 100
    )}% match): ${sources[0].content.substring(0, 300)}...`;
  }
  // =====================================================
  // INDEXING
  // =====================================================

  /** Index content (Pinecone if available; always store doc-level embedding in KV) */
  private async indexContent(data: BrainEntity): Promise<void> {
    try {
      // 1) Always compute and store a doc-level embedding for KV fallback
      const docChunks = this.embedding.chunkText(data.content);
      const docEmb = await this.embedding.generateEmbedding(
        docChunks[0] ?? data.content
      );

      let newMeta = {
        ...data.metadata,
        embedding: docEmb,
        indexed: true,
        indexedAt: Date.now(),
      };

      // 2) If Pinecone exists, index chunk-level vectors
      if (this.pinecone) {
        const chunks = docChunks;
        console.log(`📄 Created ${chunks.length} chunks for indexing`);

        const vectors = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const chunkId = `${data.id}_chunk_${i}`;
          const emb = await this.embedding.generateEmbedding(chunk);
          vectors.push({
            id: chunkId,
            values: emb,
            metadata: {
              ...data.metadata,
              createdAt: data.metadata?.createdAt,
              originalId: data.id,
              content: chunk,
              chunkIndex: i,
              totalChunks: chunks.length,
              type: data.type,
              category: data.metadata?.category,
              userId: data.metadata?.userId,
            },
          });
        }

        await this.pinecone.upsert(vectors);
        console.log("✅ Content indexed in Pinecone");
      } else {
        console.log(
          "ℹ️ Pinecone not configured — stored doc-level embedding in KV"
        );
      }

      // Persist metadata update
      await this.storage.storeBrainData({ ...data, metadata: newMeta });
    } catch (error) {
      console.error("❌ Indexing failed:", error);
      throw error;
    }
  }

  /** Remove content from vector index (no-op if Pinecone not configured) */
  private async deleteFromIndex(id: string): Promise<void> {
    try {
      if (!this.pinecone) return;
      await this.pinecone.deleteByFilter({ originalId: id });
      console.log("✅ Removed from vector index");
    } catch (error) {
      console.error("❌ Index deletion failed:", error);
    }
  }

  /** Clear related caches */
  private async clearRelatedCaches(
    type?: string,
    category?: string
  ): Promise<void> {
    if (type) await this.cache.delete(`type:${type}`);
    if (category) await this.cache.delete(`category:${category}`);
  }

  // =====================================================
  // BATCH OPS
  // =====================================================

  async bulkCreate(items: BrainData[]): Promise<CRUDResult[]> {
    const results: CRUDResult[] = [];
    for (const item of items) {
      results.push(await this.create(item));
      await new Promise((r) => setTimeout(r, 5));
    }
    return results;
  }

  async bulkUpdate(
    updates: Array<{ id: string; data: Partial<BrainData> }>
  ): Promise<CRUDResult[]> {
    const results: CRUDResult[] = [];
    for (const { id, data } of updates) {
      results.push(await this.update(id, data));
      await new Promise((r) => setTimeout(r, 5));
    }
    return results;
  }

  async bulkDelete(ids: string[]): Promise<CRUDResult[]> {
    const results: CRUDResult[] = [];
    for (const id of ids) {
      results.push(await this.delete(id));
      await new Promise((r) => setTimeout(r, 5));
    }
    return results;
  }

  // =====================================================
  // ANALYTICS
  // =====================================================

  async getAnalytics(): Promise<any> {
    try {
      const stats = await this.storage.getBrainStats();
      return {
        totalEntities: stats.totalEntities,
        byType: stats.byType,
        byCategory: stats.byCategory,
        recentActivity: stats.recentActivity,
        indexingStatus: stats.indexingStatus,
        storageUsage: stats.storageUsage,
        generatedAt: Date.now(),
      };
    } catch (error) {
      console.error("❌ Analytics error:", error);
      return { error: "Failed to generate analytics" };
    }
  }

  // =====================================================
  // AGENT TOOLS
  // =====================================================

  getAgentTools(): AgentTool[] {
    return [
      {
        name: "brain_create",
        description:
          "Store any type of data in the brain with intelligent indexing",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique identifier" },
            content: { type: "string", description: "Content to store" },
            type: {
              type: "string",
              description: "Data type (document, conversation, note, etc.)",
            },
            metadata: { type: "object", description: "Additional metadata" },
          },
          required: ["id", "content", "type"],
        },
      },
      {
        name: "brain_read",
        description:
          "Intelligent retrieval from the brain using multiple search strategies",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: ["string", "object"],
              description: "Search query or filter object",
            },
            options: {
              type: "object",
              properties: {
                type: { type: "string" },
                category: { type: "string" },
                ids: { type: "array", items: { type: "string" } },
                limit: { type: "number", minimum: 1, maximum: 100 },
                threshold: { type: "number", minimum: 0, maximum: 1 },
                includeMetadata: { type: "boolean" },
                responseStyle: {
                  type: "string",
                  enum: ["summary", "detailed", "default"],
                },
              },
            },
          },
          required: ["query"],
        },
      },
      {
        name: "brain_update",
        description: "Update existing data in the brain with versioning",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "ID of data to update" },
            updates: { type: "object", description: "Fields to update" },
          },
          required: ["id", "updates"],
        },
      },
      {
        name: "brain_delete",
        description: "Remove data from the brain completely",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "ID of data to delete" },
          },
          required: ["id"],
        },
      },
      {
        name: "brain_analytics",
        description: "Get insights and statistics about the brain's contents",
        parameters: { type: "object", properties: {}, required: [] },
      },
    ];
  }

  // =====================================================
  // BACKWARD COMPATIBILITY
  // =====================================================

  async write(
    data: ConversationData
  ): Promise<{ success: boolean; message: string }> {
    const brainData: BrainData = {
      id: data.id,
      content: data.content,
      type: "conversation",
      metadata: data.metadata,
    };
    const result = await this.create(brainData);
    return { success: result.success, message: result.message };
  }

  async query(query: string, options: QueryOptions = {}): Promise<QueryResult> {
    const brainOptions: BrainQueryOptions = {
      ...options,
      type: options.conversationId ? "conversation" : undefined,
    };
    return this.read(query, brainOptions);
  }
}
