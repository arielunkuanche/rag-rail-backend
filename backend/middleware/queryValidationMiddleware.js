const { sendErrorResponse } = require("./errorResponseMiddleware");
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 500;

const validateQueryBody = (req, res, next) => {
    const { queryText } = req.body || {};

    if (typeof queryText !== "string") {
        return sendErrorResponse(res, {
            status: 400,
            code: "INVALID_QUERY_BODY",
            message: "Invalid request body.",
            requestId: req.requestId || null,
            details: "queryText must be a string."
        });
    }

    const trimmedQuery = queryText.trim();
    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
        return sendErrorResponse(res, {
            status: 400,
            code: "QUERY_TEXT_TOO_SHORT",
            message: "Invalid query text.",
            requestId: req.requestId || null,
            details: `queryText must be at least ${MIN_QUERY_LENGTH} characters.`
        });
    }

    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
        return sendErrorResponse(res, {
            status: 400,
            code: "QUERY_TEXT_TOO_LONG",
            message: "Invalid query text.",
            requestId: req.requestId || null,
            details: `queryText must be at most ${MAX_QUERY_LENGTH} characters.`
        });
    }

    req.body.queryText = trimmedQuery;
    next();
};

module.exports = { validateQueryBody, MIN_QUERY_LENGTH, MAX_QUERY_LENGTH };
