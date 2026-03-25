const detectQueryIntentPath = require.resolve("../../lib/detectQueryIntent");
const stopServicePath = require.resolve("../../services/stopService");

const loadDetectQueryIntentWithStopStub = (getStopByQuery) => {
    const originalDetectModule = require.cache[detectQueryIntentPath];
    const originalStopServiceModule = require.cache[stopServicePath];

    delete require.cache[detectQueryIntentPath];
    require.cache[stopServicePath] = {
        id: stopServicePath,
        filename: stopServicePath,
        loaded: true,
        exports: { getStopByQuery }
    };

    try {
        return require(detectQueryIntentPath).detectQueryIntent;
    } finally {
        delete require.cache[detectQueryIntentPath];

        if (originalStopServiceModule) {
            require.cache[stopServicePath] = originalStopServiceModule;
        } else {
            delete require.cache[stopServicePath];
        }

        if (originalDetectModule) {
            require.cache[detectQueryIntentPath] = originalDetectModule;
        }
    }
};

module.exports = { loadDetectQueryIntentWithStopStub };