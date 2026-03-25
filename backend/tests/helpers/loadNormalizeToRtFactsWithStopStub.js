const normalizeToRtFactsPath = require.resolve("../../realtime/normalizeToRtFacts");
const stopServicePath = require.resolve("../../services/stopService");

const setStubModule = (modulePath, exports) => {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports
    };
};

const loadNormalizeToRtFactsWithStopStub = ({ getStopById = () => null } = {}) => {
    const originalModules = new Map([
        [normalizeToRtFactsPath, require.cache[normalizeToRtFactsPath]],
        [stopServicePath, require.cache[stopServicePath]]
    ]);

    delete require.cache[normalizeToRtFactsPath];
    setStubModule(stopServicePath, { getStopById });

    try {
        return require(normalizeToRtFactsPath).normalizeToRtFacts;
    } finally {
        delete require.cache[normalizeToRtFactsPath];

        for (const [modulePath, originalModule] of originalModules.entries()) {
            if (originalModule) {
                require.cache[modulePath] = originalModule;
            } else {
                delete require.cache[modulePath];
            }
        }
    }
};

module.exports = { loadNormalizeToRtFactsWithStopStub };
