const axios = require("axios");
const { apiUrl, hfApiKey } = require("../config/config")

const EMBEDDING_TIMEOUT_MS = 15000;
const EMBEDDING_MAX_RETRIES = 3;
const EMBEDDING_INITIAL_RETRY_DELAY_MS = 750;
const EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000;
const embeddingCache = new Map();

const sleep = (delayMs) => new Promise(resolve => setTimeout(resolve, delayMs));

const normalizeCacheKey = (queryText) => queryText.trim().toLowerCase().replace(/\s+/g, " ");

const getCachedEmbedding = (cacheKey) => {
    const cached = embeddingCache.get(cacheKey);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
        embeddingCache.delete(cacheKey);
        return null;
    }
    return cached.value;
};

const setCachedEmbedding = (cacheKey, embedding) => {
    embeddingCache.set(cacheKey, {
        value: embedding,
        expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS
    });
};

const isRetryableEmbeddingError = (error) => {
    const status = error?.response?.status;
    console.log("[queryEmbedding] retryableEmbedding status: ",  status);
    return Boolean(
        error?.code === "ECONNABORTED" ||
        error?.code === "ETIMEDOUT" ||
        [408, 425, 429, 500, 502, 503, 504].includes(status)
    );
};

const mapEmbeddingError = (error) => {
    const status = error?.response?.status;

    if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") {
        return new Error(`[queryEmbedding] Embedding request timed out after ${EMBEDDING_TIMEOUT_MS}ms.`);
    }
    if (status === 401 || status === 403) {
        return new Error("[queryEmbedding] Embedding provider authentication failed.");
    }
    if (status === 429) {
        return new Error("[queryEmbedding] Embedding provider rate limited the request.");
    }
    if (status && status >= 500) {
        return new Error(`[queryEmbedding] Embedding provider returned server error ${status}.`);
    }

    return new Error(`[queryEmbedding] Embedding service failed: ${error?.message || "Unknown error"}`);
};

const retryWithBackoff = async (fn) => {
    let delay = EMBEDDING_INITIAL_RETRY_DELAY_MS;

    for (let attempt = 0; attempt < EMBEDDING_MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const shouldRetry = isRetryableEmbeddingError(error) && attempt < EMBEDDING_MAX_RETRIES - 1;
            if (!shouldRetry) {
                throw error;
            }

            console.warn(`[queryEmbedding] transient failure (${error?.response?.status || error?.code || error?.message}). Retrying in ${delay}ms...`);
            await sleep(delay);
            delay *= 2;
        }
    }
};

const queryEmbedding = async (queryText) => {
    //console.log(`queryText get in queryEmbedding function: ${queryText}`);
    if(!queryText) throw new Error("Query text is required.")
    if(!hfApiKey) throw new Error("HuggingFace API key is missing.")
    const cacheKey = normalizeCacheKey(queryText);
    const cachedEmbedding = getCachedEmbedding(cacheKey);
    if (cachedEmbedding) {
        console.log(`[queryEmbedding] cache hit, dimensions ${cachedEmbedding.length}`);
        return cachedEmbedding;
    }

    const embeddingApiCall = async() => {
        const res = await axios.post(
            apiUrl, 
            { inputs: queryText,options: { wait_for_model: true } },
            {
                headers: {
                    "Authorization": `Bearer ${hfApiKey}`,
                    "Content-Type": "application/json",
                },
                timeout: EMBEDDING_TIMEOUT_MS,
            }
        );
        // console.log("Embedding call res format: ", res);
        const embeddings = res?.data;

        if (!embeddings) {
            throw new Error("No embeddings data returned from HF API Interface");
        };

        // Return flat array (length 384)
        if (Array.isArray(embeddings)) return embeddings;
        // Some models return nested arrays
        if (embeddings && Array.isArray(embeddings[0])) return embeddings[0];

        throw new Error("Embedding response format was invalid.");
    };

    try {
        const embedding = await retryWithBackoff(embeddingApiCall);
        setCachedEmbedding(cacheKey, embedding);
        console.log(`Successfully generated embedding, dimensions ${embedding.length}`);
        return embedding;
    } catch (err) {
        console.error("Error generating query embedding: ", err.response?.data || err.message );
        throw mapEmbeddingError(err);
    }

};

module.exports = { queryEmbedding }