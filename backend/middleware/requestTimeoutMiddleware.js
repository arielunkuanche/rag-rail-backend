const { sendErrorResponse } = require("./errorResponseMiddleware");
const QUERY_TIMEOUT_MS = 35_000;

const requestTimeoutMiddleware = (req, res, next) => {
    let timedOut = false;

    const timer = setTimeout(() => {
        if (res.headersSent) return;

        timedOut = true;
        req.timedOut = true;

        sendErrorResponse(res, {
            status: 504,
            code: "REQUEST_TIMEOUT",
            message: "Request timed out.",
            requestId: req.requestId || null,
            extra: {
                timeoutMs: QUERY_TIMEOUT_MS
            }
        });
    }, QUERY_TIMEOUT_MS);

    req.timedOut = false;

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    req.isTimedOut = () => timedOut || req.timedOut === true;
    next();
};

module.exports = { requestTimeoutMiddleware, QUERY_TIMEOUT_MS };
