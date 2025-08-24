// src/types/index.ts - Enhanced types for RAG Brain

export interface Env {
  PINECONE_ENVIRONMENT: string;
  AI: any; // Cloudflare Workers AI
  RAG_CACHE: KVNamespace;
  PINECONE_API_KEY: string;
  PINECONE_INDEX_URL?: string;
}

// =====================================================
// ORIGINAL TYPES (Backward Compatibility)
// =====================================================

export interface ConversationData {
  id: string;
  content: string;
  metadata?: {
    userId?: string;
    conversationId?: string;
    timestamp?: number;
    type?: string;
    [key: string]: any;
  };
}

export interface QueryOptions {
  userId?: string;
  conversationId?: string;
  limit?: number;
  threshold?: number;
  includeMetadata?: boolean;
}

export interface QueryData {
  query: string;
  options?: QueryOptions;
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: any;
}

export interface QueryResult {
  answer: string;
  sources: SearchResult[];
  confidence: number;
  strategy?: string; // Enhanced: track which search strategy was used
  metadata?: any; // Enhanced: additional query metadata
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

// =====================================================
// ENHANCED BRAIN TYPES
// =====================================================

/** Core data structure for the brain - can represent any type of information */
export interface BrainData {
  id: string;
  content: string;
  type: string; // document, conversation, note, task, knowledge, etc.
  metadata?: BrainMetadata;
}

/** Enhanced entity with system-managed fields */
export interface BrainEntity extends BrainData {
  metadata: BrainMetadata & {
    createdAt: number;
    updatedAt: number;
    version: number;
    indexed?: boolean;
    indexedAt?: number;
    previousVersion?: number;
  };
}

/** Flexible metadata structure */
export interface BrainMetadata {
  agentId?: string;
  userId?: string;
  organizationId?: string;

  // Categorization
  category?: string;
  tags?: string[];
  priority?: "low" | "medium" | "high" | "critical";

  // Relationships
  parentId?: string;
  relatedIds?: string[];
  conversationId?: string;

  // Content attributes
  language?: string;
  format?: string; // markdown, json, text, html, etc.
  source?: string;
  author?: string;

  // Business logic
  status?: "draft" | "active" | "archived" | "deleted";
  visibility?: "public" | "private" | "shared";

  // Temporal
  publishedAt?: number;
  expiresAt?: number;
  scheduledFor?: number;

  // Custom fields
  [key: string]: any;
}

/** Query options for brain operations */
export interface BrainQueryOptions {
  // Filtering
  agentId?: string;
  type?: string;
  category?: string;
  tags?: string[];
  userId?: string;
  status?: string;

  // Search parameters
  limit?: number;
  offset?: number;
  threshold?: number;
  includeMetadata?: boolean;

  // Date filtering
  dateRange?: {
    start: number;
    end: number;
  };

  // Fetch by specific IDs
  ids?: string[];

  // Response customization
  responseStyle?: "summary" | "detailed" | "default";
  sortBy?: "relevance" | "date" | "priority";
  sortOrder?: "asc" | "desc";

  // Advanced options
  includeArchived?: boolean;
  includeExpired?: boolean;
  minWordCount?: number;
  maxWordCount?: number;
}

/** CRUD operation result */
export interface CRUDResult {
  success: boolean;
  message: string;
  data: BrainEntity | null;
  metadata?: {
    operation?: "create" | "read" | "update" | "delete";
    duration?: number;
    version?: number;
    [key: string]: any;
  };
}

/** Batch operation result */
export interface BatchResult {
  success: boolean;
  message: string;
  results: CRUDResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    errors: string[];
  };
}

/** Brain analytics and statistics */
export interface BrainAnalytics {
  totalEntities: number;
  byType: Record<string, number>;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  recentActivity: {
    created?: number;
    updated?: number;
    deleted?: number;
    timeframe: string;
  };
  indexingStatus: {
    indexed: number;
    pending: number;
    failed: number;
    lastIndexed?: number;
  };
  storageUsage: {
    totalSize: number;
    averageSize: number;
    largestEntity: string;
  };
  generatedAt: number;
}

/** Vector search configuration */
export interface VectorSearchConfig {
  topK: number;
  filter?: Record<string, any>;
  includeMetadata?: boolean;
  namespace?: string;
}

/** Embedding generation options */
export interface EmbeddingOptions {
  model?: string;
  maxTokens?: number;
  chunkSize?: number;
  overlapTokens?: number;
}

/** Data import/export structures */
export interface DataExport {
  version: string;
  exportedAt: number;
  totalEntities: number;
  entities: BrainEntity[];
  metadata: {
    exportType: "full" | "filtered";
    filters?: any;
    format: string;
  };
}

export interface DataImport {
  entities: BrainData[];
  options?: {
    skipExisting?: boolean;
    updateExisting?: boolean;
    preserveIds?: boolean;
    batchSize?: number;
  };
}

// =====================================================
// SYSTEM OPERATION TYPES
// =====================================================

export interface HealthCheck {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
  services: {
    storage: "ok" | "error";
    vectorDB: "ok" | "error";
    embedding: "ok" | "error";
    cache: "ok" | "error";
  };
  metrics?: {
    responseTime: number;
    memoryUsage: number;
    storageUsage: number;
  };
}

export interface JobStatus {
  id: string;
  type: "indexing" | "bulk_operation" | "maintenance";
  status: "pending" | "running" | "completed" | "failed";
  progress?: number; // 0-100
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  metadata?: any;
}

export interface RateLimit {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (request: Request) => string;
  skipSuccessfulRequests?: boolean;
}

// =====================================================
// API REQUEST/RESPONSE TYPES
// =====================================================

export interface CreateRequest {
  data: BrainData & { metadata?: BrainMetadata };
  options?: {
    skipIndexing?: boolean;
    backgroundIndex?: boolean;
  };
}

export interface UpdateRequest {
  id: string;
  updates: Partial<BrainData> & { metadata?: BrainMetadata };
  options?: {
    reindex?: boolean;
    incrementVersion?: boolean;
  };
}

export interface QueryRequest {
  query: string | { id?: string; type?: string; filters?: Record<string, any> };
  options?: BrainQueryOptions;
}

export interface BulkCreateRequest {
  items: BrainData[]; // ✅ Array of BrainData
  options?: {
    batchSize?: number;
    skipIndexing?: boolean;
    stopOnError?: boolean;
  };
}

export interface BulkUpdateRequest {
  updates: Array<{
    id: string;
    data: Partial<BrainData>;
  }>;
  options?: {
    batchSize?: number;
    reindexAll?: boolean;
  };
}

export interface BulkDeleteRequest {
  ids: string[];
  options?: {
    batchSize?: number;
    softDelete?: boolean;
  };
}

// =====================================================
// UTILITY TYPES
// =====================================================

export type EntityType =
  | "conversation"
  | "document"
  | "note"
  | "task"
  | "knowledge"
  | "image"
  | "video"
  | "audio"
  | "code"
  | "data"
  | "custom";

export type EntityStatus =
  | "draft"
  | "active"
  | "archived"
  | "deleted"
  | "processing"
  | "error";

export type SearchStrategy =
  | "direct_lookup"
  | "type_filter"
  | "semantic_search"
  | "hybrid_search"
  | "cached_semantic"
  | "error";

export type OperationResult<T = any> =
  | {
      success: true;
      data: T;
      message?: string;
    }
  | {
      success: false;
      error: string;
      code?: string;
    };

export type BrainDataUpdate = Partial<Omit<BrainData, "id">> & {
  id?: never;
};

// =====================================================
// ADDITIONAL TYPES
// =====================================================

export interface BrainMemory {
  id: string;
  content: string;
  category:
    | "conversation"
    | "knowledge"
    | "preference"
    | "context"
    | "learning";
  importance: number; // 0-1 scale
  timestamp: string;
  conversationId?: string;
  embedding?: number[];
  metadata: {
    source?: string;
    tags?: string[];
    confidence?: number;
    lastAccessed?: string;
    accessCount?: number;
  };
}

export interface BrainRequest {
  query: string;
  conversationId?: string;
  context?: {
    includeMemories?: boolean;
    memoryCategories?: string[];
    maxMemories?: number;
    learningEnabled?: boolean;
  };
  userPreferences?: {
    responseStyle?: "concise" | "detailed" | "creative";
    maxTokens?: number;
    temperature?: number;
  };
}

export interface BrainResponse {
  response: string;
  conversationId: string;
  memories: BrainMemory[];
  sources: SearchResult[];
  reasoning?: {
    strategy: string;
    confidence: number;
    memoryMatches: number;
    contextUsed: boolean;
  };
  learning?: {
    newMemories: number;
    updatedMemories: number;
    insights: string[];
  };
  metadata: {
    processingTime: number;
    tokensUsed: number;
    model?: string;
    timestamp: string;
  };
}

export interface BrainSearchRequest {
  query: string;
  filters?: {
    category?: string[];
    conversationId?: string;
    importance?: {
      min?: number;
      max?: number;
    };
    dateRange?: {
      start: string;
      end: string;
    };
  };
  options?: {
    limit?: number;
    threshold?: number;
    includeEmbeddings?: boolean;
  };
}

export interface BrainSearchResponse {
  memories: BrainMemory[];
  totalFound: number;
  query: string;
  searchTime: number;
  filters?: any;
}

export interface BrainStatsResponse {
  totalMemories: number;
  memoriesByCategory: {
    conversation: number;
    knowledge: number;
    preference: number;
    context: number;
    learning: number;
  };
  averageImportance: number;
  oldestMemory?: string;
  newestMemory?: string;
  conversationCount: number;
  storageUsed: {
    memories: number;
    embeddings: number;
    total: number;
  };
  performance: {
    averageQueryTime: number;
    cacheHitRate: number;
    indexingStatus: "healthy" | "degraded" | "error";
  };
  lastUpdated: string;
}

// =====================================================
// ORIGINAL RAG TYPES
// =====================================================

export interface RAGRequest {
  query: string;
  conversationId?: string;
  context?: {
    maxResults?: number;
    threshold?: number;
    includeMetadata?: boolean;
  };
}

export interface RAGResponse {
  response: string;
  sources: SearchResult[];
  conversationId: string;
  confidence: number;
  metadata: {
    processingTime: number;
    model?: string;
    timestamp: string;
  };
}

export interface Conversation {
  id: string;
  title?: string;
  messages: ConversationMessage[];
  lastMessage?: string;
  timestamp: string;
  messageCount?: number;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  metadata?: any;
}

export interface ConversationListResponse {
  conversations: Array<{
    id: string;
    title: string;
    lastMessage?: string;
    timestamp: string;
    messageCount: number;
  }>;
}
