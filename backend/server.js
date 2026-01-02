const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { connectDB } = require("./config/db");
const { loadStops } = require("./services/stopService");
const { queryRouter } = require("./routes/queryRoutes");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
app.use(cors());

app.use(express.json())

app.get("/", (req, res) => {
    res.send("Finnish Railway RAG Backend API is running.");
});

app.use("/api/query", queryRouter);

// Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: "Something broke."})
    next();
});

// Only start server when DB connection success
const startServer = async() => {
    try {
        await connectDB();
        app.listen(PORT, () => {
            console.log(`Backend running on ${PORT}`);
            console.log(`Access query route:  POST http://localhost:${PORT}/api/query/search`);
        });

        // Load database stop data
        await loadStops();
    } catch (err) {
        console.error("Failed to start server due to DB connection failed");
        process.exit(1);
    }
};

startServer();