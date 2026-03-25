const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const dotenv = require("dotenv");
const { connectDB } = require("./config/db");
const { loadStops } = require("./services/stopService");
const { getRealtimeDiagnostic } = require("./services/gtfsRtService");
const { validateEnv } = require("./config/validateEnv");
const { healthHandler, readyHandler, requireReady } = require("./middleware/readinessMiddleware");
const { requestContextMiddleware } = require("./middleware/requestContextMiddleware");
const { requestDebugMiddleware } = require("./middleware/requestDebugMiddleware");
const { requestTimeoutMiddleware } = require("./middleware/requestTimeoutMiddleware");
const { errorResponseMiddleware } = require("./middleware/errorResponseMiddleware");
const { queryRouter } = require("./routes/queryRoutes");

dotenv.config();

const PORT = process.env.PORT || 8000;
const createRuntimeState = () => ({
    bootStartedAt: new Date().toISOString(),
    envValidated: false,
    dbConnected: false,
    stopsLoaded: false,
    lastBootError: null
});

const createApp = (runtimeState = createRuntimeState()) => {
    const app = express();

    app.disable("x-powered-by");
    app.use(helmet());
    app.use(cors());
    app.use(requestContextMiddleware);
    app.use(express.json());
    if (process.env.NODE_ENV !== "production") {
        app.use(requestDebugMiddleware);
    }

    app.get("/", (req, res) => {
        res.send("Finnish Railway RAG Backend API is running.");
    });

    app.get("/health", healthHandler(runtimeState));
    app.get("/health/realtime", async (req, res) => {
        const diagnostic = await getRealtimeDiagnostic();
        return res.status(diagnostic.reachable ? 200 : 503).json(diagnostic);
    });
    app.get("/ready", readyHandler(runtimeState));

    // Added endpoint validation middleware
    app.use("/api/query", requestTimeoutMiddleware, requireReady(runtimeState), queryRouter);

    // Error Handler
    app.use(errorResponseMiddleware);

    return app;
};

const runtimeState = createRuntimeState();
const app = createApp(runtimeState);

// Only start server when DB connection success
const startServer = async() => {
    try {
        validateEnv();
        runtimeState.envValidated = true;

        await connectDB();
        runtimeState.dbConnected = true;

        // Load database stop data
        await loadStops();
        runtimeState.stopsLoaded = true;

        return app.listen(PORT, () => {
            console.log(`Backend running on ${PORT}`);
            console.log(`Access query route:  POST http://localhost:${PORT}/api/query/search`);
        });
    } catch (err) {
        runtimeState.lastBootError = err?.message || String(err);
        console.error("Failed to start server during environment validation or dependency initialization.");
        console.error(err?.message || err);
        process.exit(1);
    }
};

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    runtimeState,
    createApp,
    createRuntimeState,
    startServer
};
