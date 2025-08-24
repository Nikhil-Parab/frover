// src/rag/storage.ts - Enhanced Storage Service for Brain Operations
import {
  Env,
  ConversationData,
  BrainEntity,
  BrainAnalytics,
  EntityType,
  EntityStatus,
} from "../types";

export class StorageService {
  private keyPrefix = "brain:";
  private conversationPrefix = "conversation:"; // Backward compatibility

  constructor(private env: Env) {}

  // =====================================================
  // ENHANCED BRAIN OPERATIONS
  // =====================================================

  /** Store brain entity with enhanced metadata */
  async storeBrainData(data: BrainEntity): Promise<void> {
    const key = `${this.keyPrefix}${data.id}`;

    // Add system metadata
    const enrichedData: BrainEntity = {
      ...data,
      metadata: {
        ...data.metadata,
        storedAt: Date.now(),
        storageKey: key,
        size: JSON.stringify(data).length,
      },
    };

    await this.env.RAG_CACHE.put(key, JSON.stringify(enrichedData), {
      expirationTtl: data.metadata?.expiresAt
        ? Math.max(0, Math.floor((data.metadata.expiresAt - Date.now()) / 1000))
        : 365 * 24 * 60 * 60, // 1 year default
    });

    // Update type index for fast filtering
    await this.updateTypeIndex(data.type, data.id, "add");

    // Update category index if present
    if (data.metadata?.category) {
      await this.updateCategoryIndex(data.metadata.category, data.id, "add");
    }
  }

  /** Retrieve brain entity by ID */
  async retrieveBrainData(id: string): Promise<BrainEntity | null> {
    const key = `${this.keyPrefix}${id}`;
    const data = await this.env.RAG_CACHE.get(key);

    if (!data) return null;

    try {
      const entity = JSON.parse(data) as BrainEntity;

      // Check if expired
      if (
        entity.metadata?.expiresAt &&
        entity.metadata.expiresAt < Date.now()
      ) {
        await this.deleteBrainData(id); // Auto-cleanup
        return null;
      }

      return entity;
    } catch (error) {
      console.error("Error parsing brain data:", error);
      return null;
    }
  }

  /** Delete brain entity and cleanup indexes */
  async deleteBrainData(id: string): Promise<boolean> {
    const key = `${this.keyPrefix}${id}`;

    // Get existing data for cleanup
    const existing = await this.retrieveBrainData(id);

    // Delete main record
    await this.env.RAG_CACHE.delete(key);

    // Cleanup indexes
    if (existing) {
      await this.updateTypeIndex(existing.type, id, "remove");
      if (existing.metadata?.category) {
        await this.updateCategoryIndex(
          existing.metadata.category,
          id,
          "remove"
        );
      }
    }

    return true;
  }

  /** List entities by type with pagination */
  async listByType(
    type: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<BrainEntity[]> {
    // Get type index
    const typeIndex = await this.getTypeIndex(type);
    if (!typeIndex || typeIndex.length === 0) return [];

    // Apply pagination
    const paginatedIds = typeIndex.slice(offset, offset + limit);

    // Fetch entities
    const entities: BrainEntity[] = [];
    for (const id of paginatedIds) {
      const entity = await this.retrieveBrainData(id);
      if (entity) entities.push(entity);
    }

    return entities;
  }

  /** List entities by category */
  async listByCategory(
    category: string,
    limit: number = 100
  ): Promise<BrainEntity[]> {
    const categoryIndex = await this.getCategoryIndex(category);
    if (!categoryIndex || categoryIndex.length === 0) return [];

    const limitedIds = categoryIndex.slice(0, limit);
    const entities: BrainEntity[] = [];

    for (const id of limitedIds) {
      const entity = await this.retrieveBrainData(id);
      if (entity) entities.push(entity);
    }

    return entities;
  }
  /** Fetch entities based on BrainQueryOptions */
  async getEntities(options: {
    ids?: string[];
    category?: string;
    type?: string;
  }): Promise<BrainEntity[]> {
    if (options.ids && options.ids.length > 0) {
      const entities: BrainEntity[] = [];
      for (const id of options.ids) {
        const entity = await this.retrieveBrainData(id);
        if (entity) entities.push(entity);
      }
      return entities;
    }

    if (options.category) {
      return this.listByCategory(options.category);
    }

    if (options.type) {
      return this.listByType(options.type);
    }

    // fallback: return first 100 entities
    const allIds = await this.getAllBrainEntityIds();
    const limitedIds = allIds.slice(0, 100);
    const entities: BrainEntity[] = [];
    for (const id of limitedIds) {
      const entity = await this.retrieveBrainData(id);
      if (entity) entities.push(entity);
    }
    return entities;
  }
  /** Search entities with complex filters */
  async searchEntities(filters: {
    type?: string;
    category?: string;
    userId?: string;
    status?: EntityStatus;
    tags?: string[];
    dateRange?: { start: number; end: number };
    textSearch?: string;
    limit?: number;
  }): Promise<BrainEntity[]> {
    console.log("🔍 Searching entities with filters:", filters);

    // Start with all entities if no specific index to use
    let candidates: string[] = [];

    // Use type index if available (most efficient)
    if (filters.type) {
      candidates = await this.getTypeIndex(filters.type);
    } else if (filters.category) {
      candidates = await this.getCategoryIndex(filters.category);
    } else {
      // Fallback: scan all brain entities (expensive!)
      candidates = await this.getAllBrainEntityIds();
    }

    const results: BrainEntity[] = [];
    let processed = 0;
    const maxToProcess = Math.min(
      candidates.length,
      (filters.limit || 100) * 3
    ); // Process 3x limit for filtering

    for (const id of candidates) {
      if (processed >= maxToProcess) break;

      const entity = await this.retrieveBrainData(id);
      if (!entity) continue;

      processed++;

      // Apply filters
      if (filters.userId && entity.metadata?.userId !== filters.userId)
        continue;
      if (filters.status && entity.metadata?.status !== filters.status)
        continue;
      if (filters.category && entity.metadata?.category !== filters.category)
        continue;

      // Tag filtering
      if (filters.tags && filters.tags.length > 0) {
        const entityTags = entity.metadata?.tags || [];
        const hasRequiredTags = filters.tags.every((tag) =>
          entityTags.includes(tag)
        );
        if (!hasRequiredTags) continue;
      }

      // Date range filtering
      if (filters.dateRange) {
        const createdAt = entity.metadata?.createdAt || 0;
        if (
          createdAt < filters.dateRange.start ||
          createdAt > filters.dateRange.end
        ) {
          continue;
        }
      }

      // Text search (simple contains)
      if (filters.textSearch) {
        const searchText = filters.textSearch.toLowerCase();
        const contentMatch = entity.content.toLowerCase().includes(searchText);
        const idMatch = entity.id.toLowerCase().includes(searchText);
        if (!contentMatch && !idMatch) continue;
      }

      results.push(entity);

      if (results.length >= (filters.limit || 100)) break;
    }

    console.log(`✅ Found ${results.length} entities after filtering`);
    return results;
  }

  /** Get comprehensive brain statistics */
  async getBrainStats(): Promise<BrainAnalytics> {
    console.log("📊 Generating brain statistics...");

    const allIds = await this.getAllBrainEntityIds();
    const totalEntities = allIds.length;

    // Sample entities for detailed stats (limit for performance)
    const sampleSize = Math.min(totalEntities, 1000);
    const sampleIds = allIds.slice(0, sampleSize);

    const byType: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    let totalSize = 0;
    let largestEntity = "";
    let largestSize = 0;
    let indexedCount = 0;
    let recentActivity = { created: 0, updated: 0, deleted: 0 };

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const id of sampleIds) {
      const entity = await this.retrieveBrainData(id);
      if (!entity) continue;

      // Type stats
      byType[entity.type] = (byType[entity.type] || 0) + 1;

      // Category stats
      if (entity.metadata?.category) {
        byCategory[entity.metadata.category] =
          (byCategory[entity.metadata.category] || 0) + 1;
      }

      // Status stats
      const status = entity.metadata?.status || "active";
      byStatus[status] = (byStatus[status] || 0) + 1;

      // Size tracking
      const entitySize = entity.metadata?.size || 0;
      totalSize += entitySize;
      if (entitySize > largestSize) {
        largestSize = entitySize;
        largestEntity = entity.id;
      }

      // Indexing status
      if (entity.metadata?.indexed) {
        indexedCount++;
      }

      // Recent activity
      const createdAt = entity.metadata?.createdAt || 0;
      const updatedAt = entity.metadata?.updatedAt || 0;

      if (createdAt > oneDayAgo) recentActivity.created++;
      if (updatedAt > oneDayAgo && updatedAt !== createdAt)
        recentActivity.updated++;
    }

    // Extrapolate sample data to full dataset
    const scaleFactor = totalEntities / sampleSize;

    return {
      totalEntities,
      byType: this.scaleStats(byType, scaleFactor),
      byCategory: this.scaleStats(byCategory, scaleFactor),
      byStatus: this.scaleStats(byStatus, scaleFactor),
      recentActivity: {
        ...this.scaleStats(recentActivity, scaleFactor),
        timeframe: "last_24_hours",
      },
      indexingStatus: {
        indexed: Math.round(indexedCount * scaleFactor),
        pending: totalEntities - Math.round(indexedCount * scaleFactor),
        failed: 0, // TODO: track indexing failures
      },
      storageUsage: {
        totalSize: Math.round(totalSize * scaleFactor),
        averageSize:
          totalEntities > 0
            ? Math.round((totalSize * scaleFactor) / totalEntities)
            : 0,
        largestEntity,
      },
      generatedAt: Date.now(),
    };
  }

  // =====================================================
  // INDEX MANAGEMENT
  // =====================================================

  /** Update type index for fast filtering */
  private async updateTypeIndex(
    type: string,
    id: string,
    operation: "add" | "remove"
  ): Promise<void> {
    const indexKey = `index:type:${type}`;
    const existing = await this.env.RAG_CACHE.get(indexKey);

    let ids: string[] = [];
    if (existing) {
      try {
        ids = JSON.parse(existing);
      } catch (error) {
        console.error("Error parsing type index:", error);
      }
    }

    if (operation === "add" && !ids.includes(id)) {
      ids.push(id);
    } else if (operation === "remove") {
      ids = ids.filter((existingId) => existingId !== id);
    }

    await this.env.RAG_CACHE.put(indexKey, JSON.stringify(ids), {
      expirationTtl: 365 * 24 * 60 * 60, // 1 year
    });
  }

  /** Get type index */
  private async getTypeIndex(type: string): Promise<string[]> {
    const indexKey = `index:type:${type}`;
    const data = await this.env.RAG_CACHE.get(indexKey);

    if (!data) return [];

    try {
      return JSON.parse(data);
    } catch (error) {
      console.error("Error parsing type index:", error);
      return [];
    }
  }

  /** Update category index */
  private async updateCategoryIndex(
    category: string,
    id: string,
    operation: "add" | "remove"
  ): Promise<void> {
    const indexKey = `index:category:${category}`;
    const existing = await this.env.RAG_CACHE.get(indexKey);

    let ids: string[] = [];
    if (existing) {
      try {
        ids = JSON.parse(existing);
      } catch (error) {
        console.error("Error parsing category index:", error);
      }
    }

    if (operation === "add" && !ids.includes(id)) {
      ids.push(id);
    } else if (operation === "remove") {
      ids = ids.filter((existingId) => existingId !== id);
    }

    await this.env.RAG_CACHE.put(indexKey, JSON.stringify(ids), {
      expirationTtl: 365 * 24 * 60 * 60,
    });
  }

  /** Get category index */
  private async getCategoryIndex(category: string): Promise<string[]> {
    const indexKey = `index:category:${category}`;
    const data = await this.env.RAG_CACHE.get(indexKey);

    if (!data) return [];

    try {
      return JSON.parse(data);
    } catch (error) {
      console.error("Error parsing category index:", error);
      return [];
    }
  }

  /** Get all brain entity IDs (expensive operation) */
  private async getAllBrainEntityIds(): Promise<string[]> {
    console.log("⚠️ Performing expensive scan of all brain entities");

    const listResult = await this.env.RAG_CACHE.list({
      prefix: this.keyPrefix,
      limit: 10000, // KV limit
    });

    return listResult.keys
      .map((key) => key.name.replace(this.keyPrefix, ""))
      .filter((id) => !id.startsWith("index:")); // Exclude index keys
  }

  /** Scale statistics from sample to full dataset */
  private scaleStats(
    stats: Record<string, number>,
    scaleFactor: number
  ): Record<string, number> {
    const scaled: Record<string, number> = {};
    for (const [key, value] of Object.entries(stats)) {
      scaled[key] = Math.round(value * scaleFactor);
    }
    return scaled;
  }

  // =====================================================
  // BACKWARD COMPATIBILITY METHODS
  // =====================================================

  /** Store conversation data (legacy method) */
  async store(data: ConversationData): Promise<void> {
    const key = `${this.conversationPrefix}${data.id}`;
    await this.env.RAG_CACHE.put(key, JSON.stringify(data), {
      expirationTtl: 30 * 24 * 60 * 60, // 30 days
    });
  }

  /** Retrieve conversation data (legacy method) */
  async retrieve(id: string): Promise<ConversationData | null> {
    const key = `${this.conversationPrefix}${id}`;
    const data = await this.env.RAG_CACHE.get(key);

    if (!data) return null;

    try {
      return JSON.parse(data);
    } catch (error) {
      console.error("Error parsing stored conversation data:", error);
      return null;
    }
  }

  /** Delete conversation data (legacy method) */
  async delete(id: string): Promise<boolean> {
    const key = `${this.conversationPrefix}${id}`;
    await this.env.RAG_CACHE.delete(key);
    return true;
  }

  /** List conversations by user (legacy method) */
  async listByUser(
    userId: string,
    limit: number = 100
  ): Promise<ConversationData[]> {
    const listResult = await this.env.RAG_CACHE.list({
      prefix: this.conversationPrefix,
      limit: Math.min(limit * 2, 1000), // Get more to account for filtering
    });

    const conversations: ConversationData[] = [];

    for (const key of listResult.keys) {
      const data = await this.env.RAG_CACHE.get(key.name);
      if (data) {
        try {
          const conversation = JSON.parse(data);
          if (conversation.metadata?.userId === userId) {
            conversations.push(conversation);
          }

          if (conversations.length >= limit) break;
        } catch (error) {
          console.error("Error parsing conversation data:", error);
        }
      }
    }

    return conversations;
  }
}
