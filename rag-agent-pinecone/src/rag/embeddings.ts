import { Env } from "../types";

export class EmbeddingService {
  constructor(private env: Env) {}

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.env.AI.run("@cf/baai/bge-small-en-v1.5", {
        text: text.substring(0, 512), // Limit text length
      });

      if (!response?.data?.[0]) {
        throw new Error("Invalid embedding response");
      }

      return response.data[0];
    } catch (error) {
      console.error("Error generating embedding:", error);
      throw error;
    }
  }

  async generateMultipleEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (const text of texts) {
      const embedding = await this.generateEmbedding(text);
      embeddings.push(embedding);
    }

    return embeddings;
  }

  chunkText(text: string, maxLength: number = 400): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    let currentChunk = "";

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (currentChunk.length + trimmedSentence.length + 1 <= maxLength) {
        currentChunk += (currentChunk ? ". " : "") + trimmedSentence;
      } else {
        if (currentChunk) chunks.push(currentChunk + ".");
        currentChunk = trimmedSentence;
      }
    }

    if (currentChunk) chunks.push(currentChunk + ".");

    return chunks;
  }
}
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dot / (magA * magB);
}

export async function semanticSearch(
  query: string,
  entities: { id: string; content: string }[],
  env: Env
): Promise<{ id: string; content: string; score: number }[]> {
  const embeddingService = new EmbeddingService(env);

  // Generate query embedding
  const queryEmbedding = await embeddingService.generateEmbedding(query);

  // Compare with each entity
  const results = await Promise.all(
    entities.map(async (entity) => {
      const contentEmbedding = await embeddingService.generateEmbedding(
        entity.content
      );
      const score = cosineSimilarity(queryEmbedding, contentEmbedding);
      return { id: entity.id, content: entity.content, score };
    })
  );

  // Sort by similarity
  return results.sort((a, b) => b.score - a.score);
}
