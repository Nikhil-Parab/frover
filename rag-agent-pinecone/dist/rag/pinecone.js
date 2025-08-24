export class PineconeService {
    baseUrl;
    headers;
    constructor(env) {
        // ✅ Use provided URL or build from environment + index name
        this.baseUrl =
            env.PINECONE_INDEX_URL ||
                `https://${env.PINECONE_INDEX_NAME}-${env.PINECONE_ENVIRONMENT}.svc.${env.PINECONE_ENVIRONMENT}.pinecone.io`;
        this.headers = {
            "Api-Key": env.PINECONE_API_KEY,
            "Content-Type": "application/json",
            Accept: "application/json",
        };
    }
    /** ✅ Upsert vectors to Pinecone */
    async upsert(vectors, namespace) {
        const body = { vectors };
        if (namespace)
            body.namespace = namespace;
        const response = await fetch(`${this.baseUrl}/vectors/upsert`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Pinecone upsert failed: ${response.status} ${await response.text()}`);
        }
        return response.json();
    }
    /** ✅ Query vectors from Pinecone */
    async query(queryVector, options) {
        const body = {
            vector: queryVector,
            topK: options.topK,
            includeMetadata: options.includeMetadata ?? true,
            includeValues: options.includeValues ?? false,
        };
        if (options.filter)
            body.filter = options.filter;
        if (options.namespace)
            body.namespace = options.namespace;
        const response = await fetch(`${this.baseUrl}/query`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Pinecone query failed: ${response.status} ${await response.text()}`);
        }
        return response.json();
    }
    /** ✅ Delete vectors by IDs */
    async deleteById(ids, namespace) {
        const body = { ids };
        if (namespace)
            body.namespace = namespace;
        const response = await fetch(`${this.baseUrl}/vectors/delete`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Pinecone delete failed: ${response.status} ${await response.text()}`);
        }
    }
    /** ✅ Delete vectors by filter */
    async deleteByFilter(filter, namespace) {
        const body = { filter };
        if (namespace)
            body.namespace = namespace;
        const response = await fetch(`${this.baseUrl}/vectors/delete`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Pinecone delete by filter failed: ${response.status} ${await response.text()}`);
        }
    }
    /** ✅ Delete all vectors in a namespace */
    async deleteAll(namespace) {
        const body = { deleteAll: true };
        if (namespace)
            body.namespace = namespace;
        const response = await fetch(`${this.baseUrl}/vectors/delete`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Pinecone delete all failed: ${response.status} ${await response.text()}`);
        }
    }
    /** ✅ Fetch vectors by IDs */
    async fetch(ids, namespace) {
        const params = new URLSearchParams();
        ids.forEach((id) => params.append("ids", id));
        if (namespace)
            params.set("namespace", namespace);
        const response = await fetch(`${this.baseUrl}/vectors/fetch?${params}`, {
            method: "GET",
            headers: this.headers,
        });
        if (!response.ok) {
            throw new Error(`Pinecone fetch failed: ${response.status} ${await response.text()}`);
        }
        return response.json();
    }
    /** ✅ Get index statistics */
    async getStats(namespace) {
        const params = new URLSearchParams();
        if (namespace)
            params.set("namespace", namespace);
        const response = await fetch(`${this.baseUrl}/describe_index_stats?${params}`, {
            method: "GET",
            headers: this.headers,
        });
        if (!response.ok) {
            throw new Error(`Pinecone stats failed: ${response.status} ${await response.text()}`);
        }
        return response.json();
    }
    /** ✅ Update vector metadata */
    async updateMetadata(id, metadata, namespace) {
        const body = {
            id,
            setMetadata: metadata,
        };
        if (namespace)
            body.namespace = namespace;
        const response = await fetch(`${this.baseUrl}/vectors/update`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Pinecone update metadata failed: ${response.status} ${await response.text()}`);
        }
    }
    /** ✅ Health check */
    async healthCheck() {
        try {
            const start = Date.now();
            await this.getStats();
            return { status: "healthy", latency: Date.now() - start };
        }
        catch (error) {
            return {
                status: "unhealthy",
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }
    /** ✅ Batch upsert */
    async batchUpsert(vectors, batchSize = 100, namespace) {
        const results = [];
        for (let i = 0; i < vectors.length; i += batchSize) {
            const batch = vectors.slice(i, i + batchSize);
            const result = await this.upsert(batch, namespace);
            results.push(result);
            if (i + batchSize < vectors.length) {
                await new Promise((res) => setTimeout(res, 100));
            }
        }
        return results;
    }
}
