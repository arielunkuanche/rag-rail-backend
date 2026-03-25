const serverPath = require.resolve('../../server');
const queryRoutesPath = require.resolve('../../routes/queryRoutes');
const ragServicePath = require.resolve('../../services/ragService');
const detectQueryIntentPath = require.resolve('../../lib/detectQueryIntent');
const llmServicePath = require.resolve('../../services/llmService');
const trainRetrieverPath = require.resolve('../../services/retrievers/trainRetriever');
const routeRetrieverPath = require.resolve('../../services/retrievers/routeRetriever');
const stopRetrieverPath = require.resolve('../../services/retrievers/stopRetriever');

const setStubModule = (modulePath, exports) => {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports
    };
};

const loadServerWithRagDependencyStubs = ({
    detectQueryIntent = () => ({ intent: 'route', direction: { origin: 'Helsinki', destination: 'Oulu' } }),
    generateResponse = async() => ({}),
    handleTrainExact = async() => ({ staticDocs: [], realtime: {}, retrievalStatus: { code: 'OK', message: '' } }),
    handleTrainGroup = async() => ({ staticDocs: [], realtime: {}, retrievalStatus: { code: 'OK', message: '' } }),
    routeRetriever = async() => ({ staticDocs: [], realtime: {}, retrievalStatus: { code: 'OK', message: '' } }),
    stopRetriever = async() => ({ staticDocs: [], realtime: {}, retrievalStatus: { code: 'OK', message: '' } })
} = {}) => {
    const originalModules = new Map([
        [serverPath, require.cache[serverPath]],
        [queryRoutesPath, require.cache[queryRoutesPath]],
        [ragServicePath, require.cache[ragServicePath]],
        [detectQueryIntentPath, require.cache[detectQueryIntentPath]],
        [llmServicePath, require.cache[llmServicePath]],
        [trainRetrieverPath, require.cache[trainRetrieverPath]],
        [routeRetrieverPath, require.cache[routeRetrieverPath]],
        [stopRetrieverPath, require.cache[stopRetrieverPath]]
    ]);

    delete require.cache[serverPath];
    delete require.cache[queryRoutesPath];
    delete require.cache[ragServicePath];
    setStubModule(detectQueryIntentPath, { detectQueryIntent });
    setStubModule(llmServicePath, { generateResponse });
    setStubModule(trainRetrieverPath, { handleTrainExact, handleTrainGroup });
    setStubModule(routeRetrieverPath, { routeRetriever });
    setStubModule(stopRetrieverPath, { stopRetriever });

    try {
        return require(serverPath);
    } finally {
        delete require.cache[serverPath];
        delete require.cache[queryRoutesPath];
        delete require.cache[ragServicePath];

        for (const [modulePath, originalModule] of originalModules.entries()) {
            if (originalModule) {
                require.cache[modulePath] = originalModule;
            } else {
                delete require.cache[modulePath];
            }
        }
    }
};

module.exports = { loadServerWithRagDependencyStubs };
