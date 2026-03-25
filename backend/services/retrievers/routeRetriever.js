const { detectRtIntent } = require("../../lib/detectRtIntent");
const { interpretTrainRouteRealtime } = require("../../realtime/interpreTrainRouteRealtime");
const { normalizeToRtFacts } = require("../../realtime/normalizeToRtFacts");
const { fetchRealTimeUpdates } = require("../gtfsRtService");
const { queryEmbedding } = require("../queryEmbedding");
const { vectorSearch } = require("../vectorSearch");

const normalizePlaceName = (value = "") => {
    if (!value || typeof value !== "string") return "";

    return value
        .trim()
        .replace(/[.,?!:;()]+$/g, "")
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("fi-FI")
        .split(" ")
        .map(token => token ? token[0].toLocaleUpperCase("fi-FI") + token.slice(1) : token)
        .join(" ");
};

const isForwardStopOrder = (doc, origin, destination) => {
    const stops = doc?.metadata?.stops;
    if (!Array.isArray(stops) || !origin || !destination) return false;

    const originIndex = stops.indexOf(origin);
    const destinationIndex = stops.indexOf(destination);
    const stopOrderMatch = originIndex !== -1 && destinationIndex !== -1 && originIndex < destinationIndex;
    
    console.log("[Route Retriever] detected route direction stops sequence: ", stopOrderMatch);
    return stopOrderMatch;
};

const routeRetriever = async (queryText, intent) => {
    const { origin, destination } = intent.direction || {};

    const retrieverPackage = {
        intent: "route",
        origin, 
        destination,
        staticDocs: [],
        realtime: {},
        routeIds: [],
        tripIds: [],
        retrievalStatus: {
            code: "OK",
            scope: "route",
            message: ""
        }
    };

    // 1. Embed user query
    const queryVector = await queryEmbedding(queryText);

    // 2. Vector search using filter
    const normalizedOrigin = normalizePlaceName(origin);
    const normalizedDestination = normalizePlaceName(destination);
    const strictFilter = {
        "metadata.type": "trip_pattern"
    };
    if (normalizedOrigin) {
        strictFilter["metadata.origin"] = normalizedOrigin;
    }
    if (normalizedDestination) {
        strictFilter["metadata.destination"] = normalizedDestination;
    }

    const fallbackBothStopsFilter =
        normalizedOrigin && normalizedDestination
            ? {
                "$and": [
                    { "metadata.type": "trip_pattern" },
                    { "metadata.stops": normalizedOrigin },
                    { "metadata.stops": normalizedDestination }
                ]
            }
            : null;

    const fallbackDestinationFilter =
        normalizedDestination
            ? {
                "metadata.type": "trip_pattern",
                "metadata.stops": normalizedDestination
            }
            : null;
    const hasDirectionalQuery = Boolean(normalizedOrigin && normalizedDestination);

    const routeDedupe = {
        enabled: true,
        keyFields: ["route_pattern_id"],
        applyTypes: ["trip_pattern"]
    };

    // Pass 1: strict endpoint match (origin + destination) and strictest minScore
    let stageUsed = "strict_origin_destination";
    console.log("\n[Route Retriever] vector search strict filter: ", strictFilter);
    let searchResults = await vectorSearch(queryVector, {
        filter: strictFilter,
        limit: 8,
        minScore: 0.70,
        dedupe: routeDedupe
    });

    // Pass 2: boarding-stop fallback for natural phrasing "from <intermediate stop> to <destination>"
    // Lower minScore for fallback
    if (searchResults.length === 0 && fallbackBothStopsFilter) {
        stageUsed = "fallback_both_stops";
        console.log("[Route Retriever] strict filter returned 0 results. Trying both-stops fallback:", fallbackBothStopsFilter);
        const bothStopsResults = await vectorSearch(queryVector, {
            filter: fallbackBothStopsFilter,
            limit: 8,
            minScore: 0.70,
            dedupe: routeDedupe
        });

        // Filter only matched user query route.origin + destination direction matched
        searchResults = bothStopsResults.filter(doc =>
            isForwardStopOrder(doc, normalizedOrigin, normalizedDestination)
        );
        if (searchResults.length === 0) {
            console.log("[Route Retriever] both-stops fallback had no forward-direction matches.");
        }
    }

    // Pass 3: destination-only fallback only when origin is missing/uncertain.
    // For explicit "from X to Y" queries, skip this stage to avoid wrong-direction leakage.
    if (searchResults.length === 0 && fallbackDestinationFilter && !hasDirectionalQuery) {
        stageUsed = "fallback_destination_in_stops";
        console.log("[Route Retriever] previous stages returned 0 results. Trying destination-in-stops fallback:", fallbackDestinationFilter);
        searchResults = await vectorSearch(queryVector, {
            filter: fallbackDestinationFilter,
            limit: 8,
            minScore: 0.70,
            dedupe: routeDedupe
        });
    }

    if (searchResults.length === 0 && hasDirectionalQuery) {
        stageUsed = "no_directional_match";
        retrieverPackage.retrievalStatus = {
            code: "NO_DIRECTIONAL_MATCH",
            scope: "route",
            message: `No directional route match found from ${origin} to ${destination}.`
        };
        console.log("[Route Retriever] no directional match found for explicit origin/destination query.");
    }

    console.log("[Route Retriever] final retrieval stage used:", stageUsed);
    console.log(`\n[Route Retriever] static vector search results: \ntrip_pattern=${searchResults.length} \n`, searchResults);

    retrieverPackage.staticDocs = searchResults;

    // 3. Extract Ids
    const routeIds = [...new Set(searchResults.map(doc => doc.metadata.route_id).filter(Boolean))];
    const tripIds = [...new Set(searchResults.map(doc => doc.metadata.trip_id).filter(Boolean))];
    console.log("[Route Retriever]routeIds and tripIds set from search results: ", routeIds, tripIds);

    retrieverPackage.routeIds = routeIds;
    retrieverPackage.tripIds = tripIds;

    // 4. Check optional RT updates need
    const { needsRt }= detectRtIntent(queryText);
    console.log("[Route Retriever] Activate rt data fetch or not?", needsRt);

    if (!needsRt || routeIds.length === 0) return retrieverPackage;

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