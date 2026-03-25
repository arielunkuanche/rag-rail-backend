const routeRetrieverPath = require.resolve("../../services/retrievers/routeRetriever");
const detectRtIntentPath = require.resolve("../../lib/detectRtIntent");
const interpretTrainRouteRealtimePath = require.resolve("../../realtime/interpreTrainRouteRealtime");
const normalizeToRtFactsPath = require.resolve("../../realtime/normalizeToRtFacts");
const gtfsRtServicePath = require.resolve("../../services/gtfsRtService");
const queryEmbeddingPath = require.resolve("../../services/queryEmbedding");
const vectorSearchPath = require.resolve("../../services/vectorSearch");

const setStubModule = (modulePath, exports) => {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports
    };
};

const loadRouteRetrieverWithStubs = ({
    detectRtIntent = () => ({ needsRt: false, matchedKeyword: null }),
    interpretTrainRouteRealtime = () => ({}),
    normalizeToRtFacts = () => [],
    fetchRealTimeUpdates = async () => ({ data: { tripUpdates: [] } }),
    queryEmbedding = async () => [],
    vectorSearch = async () => []
} = {}) => {
    const originalModules = new Map([
        [routeRetrieverPath, require.cache[routeRetrieverPath]],
        [detectRtIntentPath, require.cache[detectRtIntentPath]],
        [interpretTrainRouteRealtimePath, require.cache[interpretTrainRouteRealtimePath]],
        [normalizeToRtFactsPath, require.cache[normalizeToRtFactsPath]],
        [gtfsRtServicePath, require.cache[gtfsRtServicePath]],
        [queryEmbeddingPath, require.cache[queryEmbeddingPath]],
        [vectorSearchPath, require.cache[vectorSearchPath]]
    ]);

    delete require.cache[routeRetrieverPath];
    setStubModule(detectRtIntentPath, { detectRtIntent });
    setStubModule(interpretTrainRouteRealtimePath, { interpretTrainRouteRealtime });
    setStubModule(normalizeToRtFactsPath, { normalizeToRtFacts });
    setStubModule(gtfsRtServicePath, { fetchRealTimeUpdates });
    setStubModule(queryEmbeddingPath, { queryEmbedding });
    setStubModule(vectorSearchPath, { vectorSearch });

    try {
        return require(routeRetrieverPath).routeRetriever;
    } finally {
        delete require.cache[routeRetrieverPath];

        for (const [modulePath, originalModule] of originalModules.entries()) {
            if (originalModule) {
                require.cache[modulePath] = originalModule;
            } else {
                delete require.cache[modulePath];
            }
        }
    }
};

module.exports = { loadRouteRetrieverWithStubs };
