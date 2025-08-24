export class CacheService {
    env;
    constructor(env) {
        this.env = env;
    }
    async get(key) {
        try {
            const raw = await this.env.RAG_CACHE.get(`cache:${key}`);
            if (!raw)
                return null;
            const parsed = JSON.parse(raw);
            if (parsed.expires && Date.now() > parsed.expires) {
                await this.delete(key); // Expired → nuke it
                return null;
            }
            return parsed.value;
        }
        catch (error) {
            console.error(`Cache get failed for key=${key}`, error);
            return null;
        }
    }
    async set(key, value, ttlSeconds = 3600) {
        try {
            const expires = Date.now() + ttlSeconds * 1000;
            const data = { value, expires };
            await this.env.RAG_CACHE.put(`cache:${key}`, JSON.stringify(data));
        }
        catch (error) {
            console.error(`Cache set failed for key=${key}`, error);
        }
    }
    async delete(key) {
        try {
            await this.env.RAG_CACHE.delete(`cache:${key}`);
        }
        catch (error) {
            console.error(`Cache delete failed for key=${key}`, error);
        }
    }
}
