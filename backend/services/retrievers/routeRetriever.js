const { detectRtIntent } = require("../../lib/detectRtIntent");
const { interpretTrainRouteRealtime } = require("../../realtime/interpreTrainRouteRealtime");
const { normalizeToRtFacts } = require("../../realtime/normalizeToRtFacts");
const { fetchRealTimeUpdates } = require("../gtfsRtService");
const { queryEmbedding } = require("../queryEmbedding");
const { vectorSearch } = require("../vectorSearch");

const routeRetriever = async (queryText, intent) => {
    const { origin, destination } = intent.direction || {};

    const retrieverPackage = {
        intent: "route",
        origin, 
        destination,
        staticDocs: [],
        realtime: {},
        routeIds: [],
        tripIds: []
    };

    // 1. Embed user query
    const queryVector = await queryEmbedding(queryText);

    // 2. Vector search using filter
    const filter = { "metadata.type": "trip_pattern" };
    console.log("\n[Route Retriever] get vector search filter: ", filter);
    const searchResults = await vectorSearch(queryVector, {
        filter,
        limit: 5,
        minScore: 0.85
    });
    console.log(`\n[Route Retriever] static vector search results: \n`, searchResults);

    retrieverPackage.staticDocs = searchResults;

    // 3. Extract Ids
    routeIds = [...new Set(searchResults.map(doc => doc.metadata.route_id))];
    tripIds = [...new Set(searchResults.map(doc => doc.metadata.trip_id))];
    console.log("[Route Retriever]routeIds and tripIds set from search results: ", routeIds, tripIds);

    retrieverPackage.routeIds = routeIds;
    retrieverPackage.tripIds = tripIds;

    // 4. Check optional RT updates need
    const { needsRt }= detectRtIntent(queryText);
    console.log("[Route Retriever] Activate rt data fetch or not?", needsRt);

    if (!needsRt || routeIds.length === 0) return {};

    const rtRaw = await fetchRealTimeUpdates();
    console.log(`[Route Retriever] ready to sent RT tripUpdates to sanitize. 
        Loaded ${rtRaw.data.tripUpdates.length} tripUpdates.`);

    // Get all RT updates results that has the query stop 
    const realtimeFacts = normalizeToRtFacts(rtRaw.data.tripUpdates);
    console.log("[Route Retriever] RT updates schema first element: ", realtimeFacts?.[0]);

    const routeRtUpdates = interpretTrainRouteRealtime({ realtimeFacts, routeIds, tripIds });
    console.log("[Route Retriever] returns the route interpretations:", routeRtUpdates);

    retrieverPackage.realtime = routeRtUpdates;

    return retrieverPackage;
};

module.exports = { routeRetriever };