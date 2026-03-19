const requestDebugMiddleware = (req, res, next) => {
    const debugEntry = {
        level: "debug",
        type: "request-debug",
        requestId: req.requestId || null,
        method: req.method,
        path: req.originalUrl,
        bodyKeys: req.body && typeof req.body === "object" ? Object.keys(req.body) : [],
        hasBody: Boolean(req.body && Object.keys(req.body || {}).length > 0)
    };

    console.log("Request Debug middleware debugEntry: ", JSON.stringify(debugEntry));
    next();
};

module.exports = { requestDebugMiddleware };
