const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { connectDB } = require("./config/db");
const { loadStops } = require("./services/stopService");
const { validateEnv } = require("./config/validateEnv");
const { healthHandler, readyHandler, requireReady } = require("./middleware/readinessMiddleware");
const { queryRouter } = require("./routes/queryRoutes");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const runtimeState = {
    bootStartedAt: new Date().toISOString(),
    envValidated: false,
    dbConnected: false,
    stopsLoaded: false,
    lastBootError: null
};

app.use(cors());

app.use(express.json())

app.get("/", (req, res) => {
    res.send("Finnish Railway RAG Backend API is running.");
});

app.get("/health", healthHandler(runtimeState));
app.get("/ready", readyHandler(runtimeState));

app.use("/api/query", requireReady(runtimeState), queryRouter);

// Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: "Something broke."})
});

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

        app.listen(PORT, () => {
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

startServer();
