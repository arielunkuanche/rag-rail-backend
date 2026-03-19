const crypto = require("crypto");

const classifyRouteGroup = (path = "") => {
    if (path.startsWith("/api/query")) return "query";
    if (path === "/health") return "health";
    if (path === "/ready") return "ready";
    if (path === "/") return "root";
    return "other";
};

const requestContextMiddleware = (req, res, next) => {
    const requestId = req.get("x-request-id") || crypto.randomUUID();
    console.log("Request Context middleware requestId: ", requestId);
    const startTime = Date.now();
    const routeGroup = classifyRouteGroup(req.originalUrl || req.path || "");

    req.requestId = requestId;
    req.routeGroup = routeGroup;
    res.setHeader("X-Request-Id", requestId);

    res.on("finish", () => {
        const ragLatencyMs = req.ragStartedAt ? Date.now() - req.ragStartedAt : null;
        const logEntry = {
            level: "info",
            type: "access",
            requestId,
            routeGroup,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            latencyMs: Date.now() - startTime,
            ragLatencyMs
        };
        console.log("Request Context middleware request log: ",JSON.stringify(logEntry));
    });

    next();
};

module.exports = { requestContextMiddleware };
