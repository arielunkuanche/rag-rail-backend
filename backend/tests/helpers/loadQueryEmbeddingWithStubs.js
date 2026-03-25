const queryEmbeddingPath = require.resolve("../../services/queryEmbedding");
const configPath = require.resolve("../../config/config");
const axiosPath = require.resolve("axios");

const setStubModule = (modulePath, exports) => {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports
    };
};

const loadQueryEmbeddingWithStubs = ({
    config = {},
    axiosPost = async () => ({ data: [] })
} = {}) => {
    const originalModules = new Map([
        [queryEmbeddingPath, require.cache[queryEmbeddingPath]],
        [configPath, require.cache[configPath]],
        [axiosPath, require.cache[axiosPath]]
    ]);

    delete require.cache[queryEmbeddingPath];
    setStubModule(configPath, {
        apiUrl: config.apiUrl || "https://example.test/embeddings",
        hfApiKey: config.hfApiKey || "",
        embeddingModel: config.embeddingModel || "test-model"
    });
    setStubModule(axiosPath, { post: axiosPost });

    try {
        return require(queryEmbeddingPath).queryEmbedding;
    } finally {
        delete require.cache[queryEmbeddingPath];

        for (const [modulePath, originalModule] of originalModules.entries()) {
            if (originalModule) {
                require.cache[modulePath] = originalModule;
            } else {
                delete require.cache[modulePath];
            }
        }
    }
};

module.exports = { loadQueryEmbeddingWithStubs };
