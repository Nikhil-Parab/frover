import { Env } from "../types";

interface CachedItem<T> {
  value: T;
  expires: number;
}

export class CacheService {
  constructor(private env: Env) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.env.RAG_CACHE.get(`cache:${key}`);
      if (!raw) return null;

      const parsed: CachedItem<T> = JSON.parse(raw);

      if (parsed.expires && Date.now() > parsed.expires) {
        await this.delete(key); // Expired → nuke it
        return null;
      }

      return parsed.value;
    } catch (error) {
      console.error(`Cache get failed for key=${key}`, error);
      return null;
    }
  }

  async set<T>(
    key: string,
    value: T,
    ttlSeconds: number = 3600
  ): Promise<void> {
    try {
      const expires = Date.now() + ttlSeconds * 1000;
      const data: CachedItem<T> = { value, expires };

      await this.env.RAG_CACHE.put(`cache:${key}`, JSON.stringify(data));
    } catch (error) {
      console.error(`Cache set failed for key=${key}`, error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.env.RAG_CACHE.delete(`cache:${key}`);
    } catch (error) {
      console.error(`Cache delete failed for key=${key}`, error);
    }
  }
}
