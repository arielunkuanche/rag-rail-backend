const dotenv = require("dotenv");
dotenv.config();

// MongoDB Settings
const dbName = "finnish_railway_rag";
const collectionName = "gtfs_embeddings";
const vectorIndex = "gtfs_vectorIndex";

// Hugging Face Embedding Model
const embeddingModel= "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";
const apiUrl = `https://router.huggingface.co/hf-inference/models/${embeddingModel}/pipeline/feature-extraction`;
const hfApiKey = process.env.HUGGINGFACE_API_KEY || ""; // Load key from environment

// Gemini AI Settings
const genAiModel =  "gemini-2.5-flash";

// GTFS-RT
const gtfsRtUrl = "https://rata.digitraffic.fi/api/v1/trains/gtfs-rt-updates";
const digiTrafficUserHeader = "ensiJuna/GtfsSystem";

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