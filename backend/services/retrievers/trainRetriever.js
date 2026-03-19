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

const TRAIN_LIMITS = {
    exact: 6,
    groupTrip: 10,
    groupCombined: 10
};

// Helper function to get GTFS DB docs if get exact train number
const fetchExactStaticDocs = async (queryVector, trainNumber) => {
    const exactStages = [
        {
            label: "train_number_normalized",
            filter: {
                "metadata.type": "trip_pattern",
                "metadata.train_number_normalized": trainNumber
            },
            dedupe: {
                enabled: true,
                keyFields: ["route_pattern_id"],
                applyTypes: ["trip_pattern"]
            }
        },
        {
            label: "train_number",
            filter: {
                "metadata.type": "trip_pattern",
                "metadata.train_number": trainNumber
            },
            dedupe: {
                enabled: true,
                keyFields: ["route_id", "origin", "destination"],
                applyTypes: ["trip_pattern"]
            }
        }
    ];

    for (const stage of exactStages) {
        console.log(`\n[Train Retriever] exact stage filter (${stage.label}):`, stage.filter);
        const docs = await vectorSearch(queryVector, {
            filter: stage.filter,
            limit: TRAIN_LIMITS.exact,
            minScore: 0.74,
            dedupe: stage.dedupe
        });

        if (docs.length > 0) {
            console.log(`\n[Train Retriever] exact stage "${stage.label}" returned ${docs.length} docs.`);
            return docs;
        }
    }

    console.log("\n[Train Retriever] exact stages returned 0 docs.");
    return [];
};

// Helper function to get GTFS DB docs when getting a group trains
const fetchFamilyStaticDocs = async (queryVector, trainFamily) => {
    const family = (trainFamily || "").trim().toUpperCase();
    if (!family) return [];

    // Stage 1: family -> trip-pattern documents.
    const groupSearchStages = [
        { label: "normalized-family", field: "metadata.train_family_normalized", minScore: 0.70 },
        { label: "legacy-route_short_name", field: "metadata.route_short_name", minScore: 0.55 }
    ];

    for (const stage of groupSearchStages) {
        const tripPatternDocs = await vectorSearch(queryVector, {
            filter: {
                "metadata.type": "trip_pattern",
                [stage.field]: family
            },
            limit: TRAIN_LIMITS.groupTrip,
            minScore: stage.minScore,
            dedupe: {
                enabled: true,
                keyFields: ["route_pattern_id"],
                applyTypes: ["trip_pattern"]
            }
        });

        if (tripPatternDocs.length > 0) {
            const combined = tripPatternDocs
                .sort((a, b) => b.score - a.score)
                .slice(0, TRAIN_LIMITS.groupCombined);
            console.log(`[Train Retriever] train-group stage results: stage=${stage.label}, trip_pattern=${tripPatternDocs.length}, combined=${combined.length}`);
            return combined;
        }
    }

    console.log("[Train Retriever] train-group stages returned 0 docs.");
    return [];
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
        tripIds: [],
        retrievalStatus: {
            code: "OK",
            scope: "train",
            message: ""
        }
    };
    if (!trainNumber) return retrieverPackage;

    // 1. Generate user query text embedding
    const queryVector = await queryEmbedding(queryText);
    
    // 2. Fetch static docs
    const docs = await fetchExactStaticDocs(queryVector, trainNumber);
    retrieverPackage.staticDocs = docs;
    if (docs.length === 0) {
        retrieverPackage.retrievalStatus = {
            code: "NO_STATIC_MATCH",
            scope: "train",
            message: `No static train matches found for exact train query: ${trainNumber}.`
        };
    }

    // Extract vector search results routeId and tripId for later optionally check RT data matching
    const routeIds = [...new Set(docs.map(data => data.metadata.route_id).filter(Boolean))];
    const tripIds = [...new Set(docs.map(data => 
        data.metadata.type === "trip_pattern" ? data.metadata.trip_id : null).filter(Boolean))];
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
        retrievalStatus: {
            code: "OK",
            scope: "train",
            message: ""
        }
    };

    if (!family) return retrieverPackage;

    // 1. Generate user query text embedding
    const queryVector = await queryEmbedding(queryText);
    
    // 2. Fetch static docs
    const docs = await fetchFamilyStaticDocs(queryVector, family);
    retrieverPackage.staticDocs = docs;
    if (docs.length === 0) {
        retrieverPackage.retrievalStatus = {
            code: "NO_STATIC_MATCH",
            scope: "train",
            message: `No static train-group matches found for train family: ${family}.`
        };
    }
    
    // Extract all route directions on this train group
    const directions = [...new Set(
        docs
            .filter(doc => doc.metadata.type === "trip_pattern" && doc.metadata.origin && doc.metadata.destination)
            .map(doc => `${doc.metadata.origin} - ${doc.metadata.destination}`)
    )];
    console.log("[Train retriever] train group get all directions: ", directions);
    retrieverPackage.directionSummary = directions;

    // Extract vector search results routeId and tripId for later optionally check RT data matching
    const routeIds = [...new Set(docs.map(data => data.metadata.route_id).filter(Boolean))];
    const tripIds = [...new Set(docs.map(data => 
        data.metadata.type === "trip_pattern" ? data.metadata.trip_id : null).filter(Boolean))];
    console.log("routeIds and tripIds set from re-ranked search results: ", routeIds, tripIds);

    retrieverPackage.routeIds = routeIds;
    retrieverPackage.tripIds = tripIds;

    // 3. Fetch RT updates based on needs
    retrieverPackage.realtime = await fetchAndInterpretTrainRt({ queryText, routeIds, tripIds });

    return retrieverPackage
};

module.exports = { handleTrainExact, handleTrainGroup }