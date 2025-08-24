// src/index.ts - Full RAG Brain API with CRUD + Query
import { Env } from "./types";
import { RAGAgent } from "./rag/agent";
import { RAGBrainAgent } from "./rag/brain";
import {
  BrainData,
  QueryRequest,
  BulkCreateRequest,
  BulkDeleteRequest,
} from "./types";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    const indexName = "conversation-history";
    const openaiApiKey = "your-openai-api-key-here";

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      console.log(`🌐 ${request.method} ${url.pathname}`);

      // ----------------------
      // Health check
      // ----------------------
      if (url.pathname === "/health") {
        return new Response(
          JSON.stringify(
            {
              status: "healthy",
              timestamp: Date.now(),
              services: {
                storage: "ok",
                vectorDB: indexName ? "ok" : "missing",
                embedding: openaiApiKey ? "ok" : "missing",
                cache: "ok",
              },
              version: "2.0.0",
            },
            null,
            2
          ),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Initialize agents
      // (legacyAgent kept for compatibility—even if unused, it's harmless)
      const legacyAgent = new RAGAgent(env);
      const brainAgent = new RAGBrainAgent(env);

      // ----------------------
      // /query (root) endpoint
      // ----------------------
      if (url.pathname === "/query" && request.method === "POST") {
        try {
          const readData = (await request.json()) as QueryRequest;

          // Direct ID lookup path
          if (readData.options && Array.isArray(readData.options.ids)) {
            const docs = await Promise.all(
              readData.options.ids.map((id) => brainAgent.getById(id))
            );

            const topics = docs
              .filter((d) => d.success && d.data?.metadata)
              .map((d) => (d.data?.metadata as any)?.topic ?? "Unknown");

            return new Response(
              JSON.stringify(
                {
                  success: true,
                  strategy: "id_lookup",
                  query: readData.query,
                  answer: topics.length
                    ? `Topics: ${topics.join(", ")}`
                    : "No topics found",
                  sources: readData.options.ids,
                  confidence: 1,
                },
                null,
                2
              ),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          // Semantic / default read
          const result = await brainAgent.read(
            readData.query,
            readData.options
          );

          return new Response(JSON.stringify(result, null, 2), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err: any) {
          return new Response(
            JSON.stringify(
              {
                success: false,
                message: err?.message || "Failed to process query",
              },
              null,
              2
            ),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }

      // ----------------------
      // /brain/* endpoints
      // ----------------------
      if (url.pathname.startsWith("/brain/")) {
        // parts: ["", "brain", path, subPath, ...]
        const parts = url.pathname.split("/").filter(Boolean);
        // parts[0] = "brain", parts[1] = main path (create/read/update/delete/get/bulk/query)
        let path = parts[1] || "";
        // alias: /brain/query -> /brain/read
        if (path === "query") path = "read";
        const subPath = parts[2] || "";
        const id = url.searchParams.get("id");

        switch (path) {
          // CREATE
          case "create": {
            if (request.method !== "POST") {
              return new Response("Method not allowed", {
                status: 405,
                headers: corsHeaders,
              });
            }
            const data = (await request.json()) as BrainData;
            const res = await brainAgent.create(data);
            return new Response(JSON.stringify(res, null, 2), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // WRITE (alias of create)
          case "write": {
            if (request.method !== "POST") {
              return new Response("Method not allowed", {
                status: 405,
                headers: corsHeaders,
              });
            }
            const data = (await request.json()) as BrainData;
            const res = await brainAgent.create(data);
            return new Response(JSON.stringify(res, null, 2), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // READ
          case "read": {
            if (request.method !== "POST") {
              return new Response("Method not allowed", {
                status: 405,
                headers: corsHeaders,
              });
            }
            const data = (await request.json()) as QueryRequest;

            // If options.ids present, do the lightweight ID lookup summary
            if (data.options && Array.isArray(data.options.ids)) {
              const docs = await Promise.all(
                data.options.ids.map((docId) => brainAgent.getById(docId))
              );
              const topics = docs
                .filter((d) => d.success && d.data?.metadata)
                .map((d) => (d.data?.metadata as any)?.topic ?? "Unknown");

              return new Response(
                JSON.stringify(
                  {
                    success: true,
                    strategy: "id_lookup",
                    query: data.query,
                    answer: topics.length
                      ? `Topics: ${topics.join(", ")}`
                      : "No topics found",
                    sources: data.options.ids,
                    confidence: 1,
                  },
                  null,
                  2
                ),
                {
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                }
              );
            }

            const res = await brainAgent.read(data.query, data.options);
            return new Response(JSON.stringify(res, null, 2), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // UPDATE
          case "update": {
            if (request.method !== "PUT" || !id) {
              return new Response(
                JSON.stringify(
                  { success: false, message: "Missing id or wrong method" },
                  null,
                  2
                ),
                {
                  status: 400,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                }
              );
            }
            const data = (await request.json()) as Partial<BrainData>;
            const res = await brainAgent.update(id, data);
            return new Response(JSON.stringify(res, null, 2), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // DELETE
          case "delete": {
            if (request.method !== "DELETE" || !id) {
              return new Response(
                JSON.stringify(
                  { success: false, message: "Missing id or wrong method" },
                  null,
                  2
                ),
                {
                  status: 400,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                }
              );
            }
            const res = await brainAgent.delete(id);
            return new Response(JSON.stringify(res, null, 2), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // GET BY ID
          case "get": {
            if (request.method !== "GET" || !id) {
              return new Response(
                JSON.stringify(
                  { success: false, message: "Missing id or wrong method" },
                  null,
                  2
                ),
                {
                  status: 400,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                }
              );
            }
            const res = await brainAgent.getById(id);
            return new Response(JSON.stringify(res, null, 2), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // BULK
          case "bulk": {
            // /brain/bulk/create  (POST)
            if (subPath === "create" && request.method === "POST") {
              const data = (await request.json()) as BulkCreateRequest;

              if (!data || !Array.isArray(data.items)) {
                return new Response(
                  JSON.stringify(
                    { success: false, message: "Invalid items array" },
                    null,
                    2
                  ),
                  {
                    status: 400,
                    headers: {
                      ...corsHeaders,
                      "Content-Type": "application/json",
                    },
                  }
                );
              }

              if (!Array.isArray(data.items)) {
                return new Response(
                  JSON.stringify({
                    success: false,
                    message: "Invalid items array",
                  }),
                  {
                    status: 400,
                    headers: {
                      ...corsHeaders,
                      "Content-Type": "application/json",
                    },
                  }
                );
              }

              const items: BrainData[] = data.items.map((item) => ({
                id: String(item.id || crypto.randomUUID()),
                content: String(item.content || ""),
                type: String(item.type || "text"),
                metadata:
                  typeof item.metadata === "object" ? item.metadata : {},
              }));
              const res = await brainAgent.bulkCreate(items);
              return new Response(JSON.stringify(res, null, 2), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            // /brain/bulk/delete  (POST)
            if (subPath === "delete" && request.method === "POST") {
              const data = (await request.json()) as BulkDeleteRequest;

              if (!data || !Array.isArray(data.ids)) {
                return new Response(
                  JSON.stringify(
                    { success: false, message: "Invalid ids array" },
                    null,
                    2
                  ),
                  {
                    status: 400,
                    headers: {
                      ...corsHeaders,
                      "Content-Type": "application/json",
                    },
                  }
                );
              }

              const res = await brainAgent.bulkDelete(data.ids);
              return new Response(JSON.stringify(res, null, 2), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            // Unknown bulk subroute
            return new Response(
              JSON.stringify(
                { success: false, message: "Unknown bulk route" },
                null,
                2
              ),
              {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          default: {
            return new Response("RAG endpoint not found", {
              status: 404,
              headers: corsHeaders,
            });
          }
        }
      }

      // ----------------------
      // API documentation
      // ----------------------
      if (url.pathname === "/docs" || url.pathname === "/") {
        const apiDocs = {
          name: "RAG Brain Agent API",
          version: "2.0.0",
          endpoints: {
            query: "POST /query",
            brain: {
              create: "POST /brain/create",
              write: "POST /brain/write",
              read: "POST /brain/read  (alias: POST /brain/query)",
              update: "PUT /brain/update?id=...",
              delete: "DELETE /brain/delete?id=...",
              get: "GET /brain/get?id=...",
              bulkCreate: "POST /brain/bulk/create",
              bulkDelete: "POST /brain/bulk/delete",
            },
            health: "GET /health",
            docs: "GET /docs",
          },
        };

        return new Response(JSON.stringify(apiDocs, null, 2), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ----------------------
      // Fallback 404
      // ----------------------
      return new Response(JSON.stringify({ error: "Not found" }, null, 2), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error: any) {
      return new Response(
        JSON.stringify(
          {
            error: "Internal server error",
            message: error?.message || "Unknown error",
            timestamp: Date.now(),
          },
          null,
          2
        ),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  },
};
