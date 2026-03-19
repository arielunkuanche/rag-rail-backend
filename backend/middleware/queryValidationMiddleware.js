const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 500;

const validateQueryBody = (req, res, next) => {
    const { queryText } = req.body || {};

    if (typeof queryText !== "string") {
        return res.status(400).json({
            error: "Invalid request body",
            code: "INVALID_QUERY_BODY",
            details: "queryText must be a string."
        });
    }

    const trimmedQuery = queryText.trim();
    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
        return res.status(400).json({
            error: "Invalid query text",
            code: "QUERY_TEXT_TOO_SHORT",
            details: `queryText must be at least ${MIN_QUERY_LENGTH} characters.`
        });
    }

    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
        return res.status(400).json({
            error: "Invalid query text",
            code: "QUERY_TEXT_TOO_LONG",
            details: `queryText must be at most ${MAX_QUERY_LENGTH} characters.`
        });
    }

    req.body.queryText = trimmedQuery;
    next();
};

module.exports = { validateQueryBody, MIN_QUERY_LENGTH, MAX_QUERY_LENGTH };
