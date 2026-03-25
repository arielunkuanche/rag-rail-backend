const llmServicePath = require.resolve("../../services/llmService");
const genAiPath = require.resolve("@google/genai");
const configPath = require.resolve("../../config/config");
const sanitizeLLMOutputPath = require.resolve("../../lib/sanitizeLLMOutput");
const dotenvPath = require.resolve("dotenv");

const setStubModule = (modulePath, exports) => {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports
    };
};

const loadLlmServiceWithStubs = ({
    geminiApiKey,
    GoogleGenAI = class {
        constructor() {}
    },
    config = {},
    sanitizeLLMOutput = (value) => value
} = {}) => {
    const originalModules = new Map([
        [llmServicePath, require.cache[llmServicePath]],
        [genAiPath, require.cache[genAiPath]],
        [configPath, require.cache[configPath]],
        [sanitizeLLMOutputPath, require.cache[sanitizeLLMOutputPath]],
        [dotenvPath, require.cache[dotenvPath]]
    ]);
    const originalGeminiApiKey = process.env.GEMINI_API_KEY;

    if (geminiApiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
    } else {
        process.env.GEMINI_API_KEY = geminiApiKey;
    }

    delete require.cache[llmServicePath];
    setStubModule(genAiPath, { GoogleGenAI });
    setStubModule(configPath, {
        genAiModel: config.genAiModel || "test-genai-model"
    });
    setStubModule(sanitizeLLMOutputPath, { sanitizeLLMOutput });
    setStubModule(dotenvPath, { config: () => ({ parsed: {} }) });

    try {
        return require(llmServicePath);
    } finally {
        delete require.cache[llmServicePath];

        if (originalGeminiApiKey === undefined) {
            delete process.env.GEMINI_API_KEY;
        } else {
            process.env.GEMINI_API_KEY = originalGeminiApiKey;
        }

        for (const [modulePath, originalModule] of originalModules.entries()) {
            if (originalModule) {
                require.cache[modulePath] = originalModule;
            } else {
                delete require.cache[modulePath];
            }
        }
    }
};

module.exports = { loadLlmServiceWithStubs };
