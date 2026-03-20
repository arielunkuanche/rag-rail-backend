const express = require("express");
const queryRouter = express.Router();
const { getRagResults } = require("../services/ragService");
const { validateQueryBody } = require("../middleware/queryValidationMiddleware");
const { sendErrorResponse } = require("../middleware/errorResponseMiddleware");

/**
 * POST /api/query/search
 * Handles a natural language query, generates an embedding, and performs vector search.
 * Expected body: { queryText: "your question about Finnish railways" }
 * Added route-specific middleware to check user queries
 */
queryRouter.post("/search", validateQueryBody, async (req, res, next) => {
    try {
        const { queryText } = req.body;

        if (req.isTimedOut && req.isTimedOut()) {
            return;
        }

        req.ragStartedAt = Date.now();
        const result = await getRagResults(queryText);
        if (req.isTimedOut && req.isTimedOut()) {
            return;
        }
        //Return the RAG final answer
        res.status(200).json({
            query: queryText,
            ...result
        });
    } catch (err) {
        console.error("Error processing user query search:", err.message || err);
        if (res.headersSent || (req.isTimedOut && req.isTimedOut())) {
            return;
        }
        if (err?.status || err?.code) {
            return next(err);
        }
        return sendErrorResponse(res, {
            status: 500,
            code: "QUERY_PROCESSING_FAILED",
            message: "Query processing failed.",
            requestId: req.requestId || null,
            details: {
                stage: "query_route",
                code: "QUERY_PROCESSING_FAILED"
            }
        });
    }
});

module.exports = { queryRouter }
