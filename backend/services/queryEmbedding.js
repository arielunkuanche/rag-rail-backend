const axios = require("axios");
const { apiUrl, hfApiKey } = require("../config/config")

const queryEmbedding = async (queryText) => {
    //console.log(`queryText get in queryEmbedding function: ${queryText}`);
    if(!queryText) throw new Error("Query text is required.")
    if(!hfApiKey) throw new Error("HuggingFace API key is missing.")

    // To handle the exponential backoff logic for retries
    const retryWithBackoff = async (fn, maxRetries = 5, delay = 1000) => {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                // Only retry on specific server errors or rate limiting (429)
                if (error.response && [429, 500, 503].includes(error.response.status) && i < maxRetries - 1) {
                    console.warn(`HuggingFace API failed with status ${error.response.status}. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; 
                } else {
                    throw error;
                }
            }
        }
    };

    const embeddingApiCall = async() => {
        const res = await axios.post(
            apiUrl, 
            { inputs: queryText,options: { wait_for_model: true } },
            {
                headers: {
                    "Authorization": `Bearer ${hfApiKey}`,
                    "Content-Type": "application/json",
                },
                timeout: 30000,
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
    };

    try {
        const embedding = await retryWithBackoff(embeddingApiCall);
        console.log(`Successfully generated embedding, dimensions ${embedding.length}`);
        return embedding;
    } catch (err) {
        console.error("Error generating query embedding: ", err.response?.data || err.message );
        throw new Error(`Embedding service failed: ${err.message || "Unknown error"}`)
    }

};

module.exports = { queryEmbedding }