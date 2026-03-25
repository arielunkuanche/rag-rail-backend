const gtfsRtServicePath = require.resolve("../../services/gtfsRtService");
const axiosPath = require.resolve("axios");
const gtfsRealtimeBindingsPath = require.resolve("gtfs-realtime-bindings");
const configPath = require.resolve("../../config/config");

const setStubModule = (modulePath, exports) => {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports
    };
};

const loadGtfsRtServiceWithStubs = ({
    axiosGet = async () => ({ data: new Uint8Array([1, 2, 3]) }),
    decode = () => ({ entity: [] }),
    config = {}
} = {}) => {
    const originalModules = new Map([
        [gtfsRtServicePath, require.cache[gtfsRtServicePath]],
        [axiosPath, require.cache[axiosPath]],
        [gtfsRealtimeBindingsPath, require.cache[gtfsRealtimeBindingsPath]],
        [configPath, require.cache[configPath]]
    ]);

    delete require.cache[gtfsRtServicePath];
    setStubModule(axiosPath, { get: axiosGet });
    setStubModule(gtfsRealtimeBindingsPath, {
        transit_realtime: {
            FeedMessage: {
                decode
            }
        }
    });
    setStubModule(configPath, {
        gtfsRtUrl: config.gtfsRtUrl || "https://example.test/gtfs-rt",
        digiTrafficUserHeader: config.digiTrafficUserHeader || "test-user-header"
    });

    try {
        return require(gtfsRtServicePath);
    } finally {
        delete require.cache[gtfsRtServicePath];

        for (const [modulePath, originalModule] of originalModules.entries()) {
            if (originalModule) {
                require.cache[modulePath] = originalModule;
            } else {
                delete require.cache[modulePath];
            }
        }
    }
};

module.exports = { loadGtfsRtServiceWithStubs };
