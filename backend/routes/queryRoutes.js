const express = require("express");
const queryRouter = express.Router();
const { getRagResults } = require("../services/ragService");

/**
 * POST /api/query/search
 * Handles a natural language query, generates an embedding, and performs vector search.
 * Expected body: { queryText: "your question about Finnish railways" }
 */
queryRouter.post("/search", async (req, res) => {
    try {
        const { queryText } = req.body;

        if(!queryText || typeof queryText !== "string") {
            res.status(400).json({ message: "Missing user query text or invalid format in request."})
        };
        const result = await getRagResults(queryText)
        //Return the RAG final answer
        res.status(200).json({
            query: queryText,
            ...result
        });
    } catch (err) {
        console.error("Error processing user query search:", err.message || err);
        res.status(500).json({ 
            error: "Query processing failed",
            details: `${err.message || "Internal server error"}`
        });
    }
});

module.exports = { queryRouter }