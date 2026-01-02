/**
 * Train retriever - return a train package in JSON format pass to ragService
 * - exact train number extraction
 * - train family queries
 * - train ambiguous 
 * - merging static + realtime(optional) context 
 */
const { queryEmbedding } = require("../queryEmbedding");
const { vectorSearch } = require("../vectorSearch");
const { fetchRealTimeUpdates } = require("../gtfsRtService");
const { detectRtIntent } = require("../../lib/detectRtIntent");
const { extractStopTimeUpdates } = require("../../lib/sanitizeRtRawData")

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
        limit: 12,
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
    console.log("\ntrainRetriever get trainFaimily filter: ", filter);

    const searchResults = await vectorSearch(queryVector, {
        filter,
        limit: 15,
        minScore: 0.70
    });
    // 3. Re-ranking logic for search quality
    console.log(`\n[trainRetriever fetchFamilyStatic]static vector search final results: \n`, searchResults);
    return searchResults;
};

// Helper function to optionally fetch RT feed updates based on rtNeeds Boolean
const mergeRealtime = async (tripIds, routeIds) => {
    let realtime = {
        summary: "",
        raw: {}
    };
    try {
            const rtResponse = await fetchRealTimeUpdates();
            const rtData = rtResponse.data || [];

            console.log("1. [Train Retriever] get realtime updates data and list all routeIds:\n ", 
                rtData.tripUpdates.map(d => d.routeId).join(", "));
            console.log("\n2. [Train Retriever] get realtime updates data and list all tripIds:\n ", 
                rtData.tripUpdates.map(d => d.tripId).join(", "));
            console.log(
                "\n3. [Train Retriever] Vehicle routeIds:\n",
                rtData.vehicleUpdates?.map(v => v.routeId)
            );
            
            const matchedUpdates = {
                tripUpdates: rtData.tripUpdates?.filter(t => tripIds.includes(t.tripId) || routeIds.includes(t.routeId)) || [],
                vehiclePositions: rtData.vehicleUpdates?.filter(v => tripIds.includes(v.tripId) || routeIds.includes(v.routeId)) || [],
                alerts: rtData.alertUpdates?.filter(a => routeIds.includes(a.routeId)) || []
            };
            console.log("[TrainRetriever] Filtered RT data based on tripIds or routeIds: \n", matchedUpdates);
        
            if (
                matchedUpdates.tripUpdates.length === 0 &&
                matchedUpdates.vehiclePositions.length === 0 &&
                matchedUpdates.alerts.length === 0
            ) {
                return realtime = {
                    summary: `No active real-time data found for this train.`,
                    raw: {}
                }
            }; 

            // Sorting unique matched RouteId before extracting stop info for each route
            const uniqueMatched = [
                ...new Map(
                    matchedUpdates.tripUpdates.map(tu => [tu.routeId, tu])
                ).values()
            ]
            console.log("[Train Retriever] get unique RT matched documents before sending to extract stops: \n", uniqueMatched)

            // Utilize util function to extract meaningful realtime tripUpdates raw updates
            const processedStops = extractStopTimeUpdates(uniqueMatched);

            realtime.summary = `Real-time status for this train: \n`;
            realtime.summary += processedStops.map(stop => stop.summary).join("\n");
            realtime.raw = {
                tripUpdates: matchedUpdates,
                stopDetails: processedStops
            };
            
            return realtime;
        } catch (err) {
            console.warn("[TrainRetriever] RT live retrieval action failed due to technical error", err);
            realtime = {
                summary: "Real-time data is currently unavailable.",
                raw: {}
            };
            return realtime;
        }
};

// Function to handle exact train number detect
const handleTrainExact = async (queryText, intent) => {
    const trainNumber = intent.trainNumber;
    console.log("\n[trainRetriever] get exact train number: ", trainNumber);

    let retrieverPackage = {
        intent: "train-exact",
        staticDocs: [],
        realtime: {},
        trainNumber: "",
        routeIds: [],
        tripIds: []
    };
    if (!trainNumber) {
        return retrieverPackage = {
            ...retrieverPackage,
            staticDocs: [`No static GTFS data get on this train ${trainNumber}`],
            trainNumber: null
        };
    };

    // 1. Generate user query text embedding
    const queryVector = await queryEmbedding(queryText);
    
    // 2. Fetch static docs
    const docs = await fetchExactStaticDocs(queryVector, trainNumber);

    if (!docs || docs.length === 0) {
        return retrieverPackage = {
            ...retrieverPackage,
            trainNumber
        }
    } else {
        retrieverPackage = {
            ...retrieverPackage,
            staticDocs: docs,
            trainNumber
        }
    }

    // Extract vector search results routeId and tripId for later optionally check RT data matching
    const routeIds = [...new Set(docs.map(data => data.metadata.route_id))];
    const tripIds = [...new Set(docs.map(data => 
        data.metadata.type === "trip_pattern" ? data.metadata.trip_id : null))];
    console.log("routeIds and tripIds set from re-ranked search results: ", routeIds, tripIds);

    // 3. Fetch RT updates based on needs
    const { needsRt }= detectRtIntent(queryText);
    console.log("Activate rt data fetch or not in handleTrainExact?", needsRt);

    if (needsRt && routeIds.length > 0) {
        const realtime = await mergeRealtime(tripIds, routeIds);
        return retrieverPackage = {
            ...retrieverPackage,
            staticDocs: docs,
            realtime,
            trainNumber,
            routeIds,
            tripIds
        }
    };

    return retrieverPackage;
};

// Function to handle train family logic
const handleTrainGroup = async (queryText, intent) => {
    const family = intent.trainFamily;
    console.log("[trainRetriever get train family: ", family);

    let retrieverPackage = {
        intent: "train-group",
        staticDocs: [],
        realtime: {},
        trainFamily: "",
        directionSummary: [],
        routeIds: [],
        tripIds: [],
    };

    if (!family) {
        return retrieverPackage = {
            ...retrieverPackage,
            staticDocs: [`No static GTFS data get on this train group ${family}`],
            trainFamily: null,
            note: `No train group found from query: ${family}`
        };
    };

    // 1. Generate user query text embedding
    const queryVector = await queryEmbedding(queryText);
    
    // 2. Fetch static docs
    const docs = await fetchFamilyStaticDocs(queryVector, family);

    if (!docs || docs.length === 0) {
        return retrieverPackage = {
            ...retrieverPackage,
            trainFamily: family,
            note: `No train routes found for train group ${family}`
        }
    };
    
    // Extract all route directions on this train group
    const directions = [...new Set(
        docs
            .filter(doc => doc.metadata.type === "route")
            .map(doc => `${doc.metadata.route_long_name}`)
    )];
    console.log("[Train retriever] train group get all directions: ", directions);

    // Extract vector search results routeId and tripId for later optionally check RT data matching
    const routeIds = [...new Set(docs.map(data => data.metadata.route_id))];
    const tripIds = [...new Set(docs.map(data => 
        data.metadata.type === "trip_pattern" ? data.metadata.trip_id : null))];
    console.log("routeIds and tripIds set from re-ranked search results: ", routeIds, tripIds);

    // 3. Fetch RT updates based on needs
    const { needsRt }= detectRtIntent(queryText);
    console.log("Activate rt data fetch or not in handleTrainGroup?", needsRt);

    if (needsRt && routeIds) {
        const realtime = await mergeRealtime(tripIds, routeIds);
        return retrieverPackage = {
            ...retrieverPackage,
            staticDocs: docs,
            realtime,
            trainFamily: family,
            directionSummary: directions,
            routeIds,
            tripIds
        }
    };

    return retrieverPackage = {
        ...retrieverPackage,
        staticDocs: docs,
        trainFamily: family,
        directionSummary: directions,
        routeIds,
        tripIds
    };
};

module.exports = { handleTrainExact, handleTrainGroup }