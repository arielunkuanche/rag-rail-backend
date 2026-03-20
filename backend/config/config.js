const dotenv = require("dotenv");
dotenv.config();

// MongoDB Settings
const dbName = process.env.DB_NAME;
const collectionName = process.env.COLLECTION_NAME;
const vectorIndex = process.env.VECTOR_INDEX_NAME;

// Hugging Face Embedding Model
const embeddingModel = process.env.EMBEDDING_MODEL;
const apiUrl = `https://router.huggingface.co/hf-inference/models/${embeddingModel}/pipeline/feature-extraction`;
const hfApiKey = process.env.HUGGINGFACE_API_KEY || ""; // Load key from environment

// Gemini AI Settings
const genAiModel = process.env.GENAI_MODEL;

// GTFS-RT
const gtfsRtUrl = process.env.GTFS_RT_URL;
const digiTrafficUserHeader = process.env.DIGITRAFFIC_USER_HEADER;

module.exports = {
    dbName,
    collectionName,
    vectorIndex,
    embeddingModel,
    apiUrl,
    hfApiKey,
    genAiModel,
    gtfsRtUrl,
    digiTrafficUserHeader
};