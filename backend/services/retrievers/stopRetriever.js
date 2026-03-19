const { detectRtIntent } = require("../../lib/detectRtIntent");
const { fetchRealTimeUpdates } = require("../gtfsRtService");
const { normalizeToRtFacts } = require("../../realtime/normalizeToRtFacts");
const { queryEmbedding } = require("../queryEmbedding");
const { vectorSearch } = require("../vectorSearch");
const { interpretStopRealtime } = require("../../realtime/interpretStopRealtime.js");

const normalizePlaceName = (value = "") => {
    if (!value || typeof value !== "string") return "";

    return value
        .trim()
        .replace(/[.,?!:;()]+$/g, "")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, char => char.toUpperCase());
};

const stopRetriever = async (queryText, intent) => {
    // 1. Resolve stop object
    const stopObject = intent.stop;
    const routeContext = intent.routeContext || null;
    if (!stopObject) return null;
    console.log("[Stop Retriever] get stop object from DB: ", stopObject);

    const stopName = stopObject.stop_name;
    const retrieverPackage = {
        intent:"stop",
        stopName,
        stop: stopObject,
        routeContext,
        staticDocs: [],
        realtime: {},
        retrievalStatus: {
            code: "OK",
            scope: "stop",
            message: ""
        }
    };

    // 2. Embed user query
    const queryVector = await queryEmbedding(queryText);

    // 3. Vector search
    const baseFilter = {
        "metadata.type": "trip_pattern",
        "metadata.stops": stopObject.stop_name
    };
    const stopDedupe = {
        enabled: true,
        keyFields: ["route_pattern_id"],
        applyTypes: ["trip_pattern"]
    };
    const destination = normalizePlaceName(routeContext?.destination);
    const destinationExactFilter = destination
        ? { ...baseFilter, "metadata.destination": destination }
        : null;
    let stageUsed = destinationExactFilter ? "destination_exact" : "stop_only";
    let searchResults = [];

    // Pass 1: current stop + exact destination in metadata.destination
    if (destinationExactFilter) {
        console.log(`\n[Stop Retriever] vector search filter (destination_exact): \n`, destinationExactFilter);
        searchResults = await vectorSearch(queryVector, {
            filter: destinationExactFilter,
            limit: 8,
            minScore: 0.75,
            dedupe: stopDedupe
        });
    }

    // Pass 2: current stop + destination appears as a stop in the trip pattern
    if (destinationExactFilter && searchResults.length === 0) {
        console.log("[Stop Retriever] destination_exact returned 0 results. Trying stop+destination-in-stops stage.");
        const stopCandidates = await vectorSearch(queryVector, {
            filter: baseFilter,
            limit: 12,
            minScore: 0.70,
            dedupe: stopDedupe
        });

        const viaStopResults = stopCandidates.filter(doc =>
            Array.isArray(doc?.metadata?.stops) && doc.metadata.stops.includes(destination)
        );

        console.log(`[Stop Retriever] stop+destination-in-stops viaStopResults=${viaStopResults.length}`);
        if (viaStopResults.length > 0) {
            stageUsed = "destination_in_stops";
            searchResults = viaStopResults.slice(0, 8);
        } else {
            stageUsed = "stop_only_fallback";
            searchResults = stopCandidates.slice(0, 8);
        }
    }

    // Pass 3: only stop filter (for queries without routeContext.destination)
    if (!destinationExactFilter) {
        console.log(`\n[Stop Retriever] vector search filter (stop_only): \n`, baseFilter);
        searchResults = await vectorSearch(queryVector, {
            filter: baseFilter,
            limit: 8,
            minScore: 0.70,
            dedupe: stopDedupe
        });
    }

    console.log("[Stop Retriever] final retrieval stage used:", stageUsed);
    //console.log(`\n[Stop Retriever] static vector search results: \n`, searchResults);

    retrieverPackage.staticDocs = searchResults;
    if (searchResults.length === 0) {
        retrieverPackage.retrievalStatus = {
            code: "NO_STATIC_MATCH",
            scope: "stop",
            message: `No static stop traveling route matches found for stop ${stopObject.stop_name}.`
        };
    }
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
