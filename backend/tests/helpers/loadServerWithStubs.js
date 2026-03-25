const serverPath = require.resolve("../../server");
const ragServicePath = require.resolve("../../services/ragService");
const queryRoutesPath = require.resolve("../../routes/queryRoutes");

const setStubModule = (modulePath, exports) => {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports
    };
};

const loadServerWithStubs = ({
    getRagResults = async() => ({})
} = {}) => {
    const originalModules = new Map([
        [serverPath, require.cache[serverPath]],
        [ragServicePath, require.cache[ragServicePath]],
        [queryRoutesPath, require.cache[queryRoutesPath]]
    ]);

    delete require.cache[serverPath];
    delete require.cache[queryRoutesPath];
    setStubModule(ragServicePath, { getRagResults });

    try {
        return require(serverPath);
    } finally {
        delete require.cache[serverPath];

        for (const [modulePath, originalModule] of originalModules.entries()) {
            if (originalModule) {
                require.cache[modulePath] = originalModule;
            } else {
                delete require.cache[modulePath];
            }
        }
    }
};

module.exports = { loadServerWithStubs };
