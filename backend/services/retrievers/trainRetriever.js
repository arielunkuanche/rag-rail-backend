/**
 * Train retriever - return a train package in JSON format pass to ragService
 * - exact train number extraction
 * - train family queries
 * - train ambiguous 
 */
const { queryEmbedding } = require("../queryEmbedding");
const { vectorSearch } = require("../vectorSearch");
const { detectRtIntent } = require("../../lib/detectRtIntent");
const { interpretTrainRouteRealtime } = require("../../realtime/interpreTrainRouteRealtime");
const { fetchRealTimeUpdates } = require("../gtfsRtService");
const { normalizeToRtFacts } = require("../../realtime/normalizeToRtFacts");

// Helper function to get GTFS DB docs if get exact train number
const fetchExactStaticDocs = async (queryVector, trainNumber) => {
    // Set up static Context vector search with two filters to get more diverse documents
    // const filter = { 
    //     $or: [
    //         {"metadata.train_number": trainNumber},
    //         {"metadata.route_short_name": trainNumber}
    //     ]
    // };
    const filter = {
        "metadata.train_number": trainNumber
    };
    console.log("\ntrainRetriever get exact trainNumber filter: ", filter);

    const searchResults = await vectorSearch(queryVector, {
        filter, 
        limit: 6,
        minScore: 0.70
    });
    // 3. Re-ranking logic for search quality
    console.log(`\n[trainRetriever fetchExactStatic]static vector search results after re-ranking: \n`, searchResults);
    return searchResults;
};

// Helper function to get GTFS DB docs when getting a group trains
const fetchFamilyStaticDocs = async (queryVector, trainFamily) => {
    const filter = {
        "metadata.route_short_name": trainFamily
    };
    console.log("\n[Train Retriever] get trainFaimily filter: ", filter);

    const searchResults = await vectorSearch(queryVector, {
        filter,
        limit: 10,
        minScore: 0.70
    });
    // 3. Re-ranking logic for search quality
    console.log(`\n[trainRetriever fetchFamilyStatic]static vector search final results: \n`, searchResults);
    return searchResults;
};

// Helper function to get RT feeds, facts schema and interpretations
const fetchAndInterpretTrainRt = async ({ queryText, routeIds, tripIds }) => {
    const { needsRt }= detectRtIntent(queryText);
    console.log("Activate rt data fetch or not in handleTrainExact?", needsRt);

    if (!needsRt || routeIds.length === 0) return {};

    const rtRaw = await fetchRealTimeUpdates();
    console.log(`[Train Retriever] ready to sent RT tripUpdates to sanitize. 
        Loaded ${rtRaw.data.tripUpdates.length} tripUpdates.`);

    // Get all RT updates results that has the query stop 
    const realtimeFacts = normalizeToRtFacts(rtRaw.data.tripUpdates);
    console.log("[Train Retriever] RT updates schema first element: ", realtimeFacts?.[0]);

    const trainRtUpdates = interpretTrainRouteRealtime({ realtimeFacts, routeIds, tripIds });
    console.log("[Train Retriever] returns the train interpretations:", trainRtUpdates);

    return trainRtUpdates;
}


// Function to handle exact train number detect
const handleTrainExact = async (queryText, intent) => {
    const trainNumber = intent.trainNumber;
    console.log("\n[trainRetriever] get exact train number: ", trainNumber);

    const retrieverPackage = {
        intent: "train-exact",
        staticDocs: [],
        realtime: {},
        trainNumber,
        routeIds: [],
        tripIds: []
    };
    if (!trainNumber) return retrieverPackage;

    // 1. Generate user query text embedding
    const queryVector = await queryEmbedding(queryText);
    
    // 2. Fetch static docs
    const docs = await fetchExactStaticDocs(queryVector, trainNumber);
    retrieverPackage.staticDocs = docs;

    // Extract vector search results routeId and tripId for later optionally check RT data matching
    const routeIds = [...new Set(docs.map(data => data.metadata.route_id))];
    const tripIds = [...new Set(docs.map(data => 
        data.metadata.type === "trip_pattern" ? data.metadata.trip_id : null))];
    console.log("[trainRetriever] routeIds and tripIds set from re-ranked search results: ", routeIds, tripIds);

    retrieverPackage.routeIds = routeIds;
    retrieverPackage.tripIds = tripIds;

    // 3. Fetch RT updates based on needs
    retrieverPackage.realtime = await fetchAndInterpretTrainRt({ queryText, routeIds, tripIds });

    return retrieverPackage;
};

// Function to handle train family logic
const handleTrainGroup = async (queryText, intent) => {
    const family = intent.trainFamily;
    console.log("[trainRetriever] get train family: ", family);

    const retrieverPackage = {
        intent: "train-group",
        staticDocs: [],
        realtime: {},
        trainFamily: family,
        directionSummary: [],
        routeIds: [],
        tripIds: [],
    };

    if (!family) return retrieverPackage;

    // 1. Generate user query text embedding
    const queryVector = await queryEmbedding(queryText);
    
    // 2. Fetch static docs
    const docs = await fetchFamilyStaticDocs(queryVector, family);
    retrieverPackage.staticDocs = docs;
    
    // Extract all route directions on this train group
    const directions = [...new Set(
        docs
            .filter(doc => doc.metadata.type === "route")
            .map(doc => `${doc.metadata.route_long_name}`)
    )];
    console.log("[Train retriever] train group get all directions: ", directions);
    retrieverPackage.directionSummary = directions;

    // Extract vector search results routeId and tripId for later optionally check RT data matching
    const routeIds = [...new Set(docs.map(data => data.metadata.route_id))];
    const tripIds = [...new Set(docs.map(data => 
        data.metadata.type === "trip_pattern" ? data.metadata.trip_id : null))];
    console.log("routeIds and tripIds set from re-ranked search results: ", routeIds, tripIds);

    retrieverPackage.routeIds = routeIds;
    retrieverPackage.tripIds = tripIds;

    // 3. Fetch RT updates based on needs
    retrieverPackage.realtime = await fetchAndInterpretTrainRt({ queryText, routeIds, tripIds });

    return retrieverPackage
};

module.exports = { handleTrainExact, handleTrainGroup }