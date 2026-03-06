const validateEnv = () => {
    const required = [
        "MONGODB_URI",
        "HUGGINGFACE_API_KEY",
        "GEMINI_API_KEY"
    ];

    const missing = required.filter((name) => {
        const value = process.env[name];
        return !value || typeof value !== "string" || value.trim() === "";
    });

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
};

module.exports = { validateEnv };
