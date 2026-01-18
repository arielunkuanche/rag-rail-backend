const { detectRtIntent } = require("../../lib/detectRtIntent");
const { fetchRealTimeUpdates } = require("../gtfsRtService");
const { normalizeToRtFacts } = require("../../realtime/normalizeToRtFacts");
const { queryEmbedding } = require("../queryEmbedding");
const { vectorSearch } = require("../vectorSearch");
const { interpretStopRealtime } = require("../../realtime/interpretStopRealtime.js");

const stopRetriever = async (queryText, intent) => {
    // 1. Resolve stop object
    const stopObject = intent.stop;
    if (!stopObject) return null;
    console.log("[Stop Retriever] get stop object from DB: ", stopObject);

    const stopName = stopObject.stop_name;
    const retrieverPackage = {
        intent:"stop",
        stopName,
        stop: stopObject,
        staticDocs: [],
        realtime: {}
    };

    // 2. Embed user query
    const queryVector = await queryEmbedding(queryText);

    // 3. Vector search
    const filter = { 
        "metadata.type": "trip_pattern",
        "metadata.stops": stopObject.stop_name
    };
    const searchResults = await vectorSearch(queryVector, {
        filter,
        limit: 4,
        minScore: 0.70
    });
    console.log(`\n[Stop Retriever] static vector search results: \n`, searchResults);

    retrieverPackage.staticDocs = searchResults;
    console.log("[Stop Retriever] retrieverPackage before getting RT updates: ", retrieverPackage);

    // 3. Optionally RT updates based on needs
    const { needsRt }= detectRtIntent(queryText);
    console.log("[Stop Retriever] Activate rt data fetch or not?", needsRt);

    if (needsRt) {
        const rtRaw = await fetchRealTimeUpdates();
        console.log(`[Stop Retriever] ready to sent RT tripUpdates to sanitize. 
            Loaded ${rtRaw.data.tripUpdates.length} tripUpdates.`);

        // Get all RT updates results that has the query stop 
        const realtimeFacts = normalizeToRtFacts(rtRaw.data.tripUpdates);
        console.log("[Stop Retriever] RT updates schema first element: ", realtimeFacts?.[0]);

        const stopRtUpdates = interpretStopRealtime({ stop: stopObject, realtimeFacts });
        console.log("[Stop Retriever] returns the stop interpretations:", stopRtUpdates);

        retrieverPackage.realtime = stopRtUpdates;
    };

    return retrieverPackage;
}

module.exports = { stopRetriever }