const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { loadRouteRetrieverWithStubs } = require("../../helpers/loadRouteRetrieverWithStubs");

describe("routeRetriever strict origin and destination retrieval", () => {
    test("uses strict retrieval filter and returns static docs with route and trip ids", async () => {
        const queryText = "What is the route from Helsinki to Rovaniemi?";
        const queryVector = [0.11, 0.22, 0.33];
        const staticDocs = [
            {
                text: "Trip pattern Helsinki to Rovaniemi",
                score: 0.91,
                metadata: {
                    type: "trip_pattern",
                    route_id: "route-001",
                    trip_id: "trip-001",
                    route_pattern_id: "route-001_Helsinki_Rovaniemi"
                }
            },
            {
                text: "Trip pattern Helsinki to Rovaniemi variant",
                score: 0.88,
                metadata: {
                    type: "trip_pattern",
                    route_id: "route-002",
                    trip_id: "trip-002",
                    route_pattern_id: "route-002_Helsinki_Rovaniemi"
                }
            }
        ];

        let capturedEmbeddingQuery = null;
        let capturedVectorSearchQueryVector = null;
        let capturedVectorSearchOptions = null;

        const routeRetriever = loadRouteRetrieverWithStubs({
            queryEmbedding: async (receivedQueryText) => {
                capturedEmbeddingQuery = receivedQueryText;
                return queryVector;
            },
            vectorSearch: async (receivedQueryVector, options) => {
                capturedVectorSearchQueryVector = receivedQueryVector;
                capturedVectorSearchOptions = options;
                return staticDocs;
            },
            detectRtIntent: () => ({ needsRt: false, matchedKeyword: null })
        });

        const result = await routeRetriever(queryText, {
            direction: {
                origin: "helsinki",
                destination: "rovaniemi?"
            }
        });

        assert.equal(capturedEmbeddingQuery, queryText);
        assert.deepEqual(capturedVectorSearchQueryVector, queryVector);
        assert.deepEqual(capturedVectorSearchOptions, {
            filter: {
                "metadata.type": "trip_pattern",
                "metadata.origin": "Helsinki",
                "metadata.destination": "Rovaniemi"
            },
            limit: 8,
            minScore: 0.70,
            dedupe: {
                enabled: true,
                keyFields: ["route_pattern_id"],
                applyTypes: ["trip_pattern"]
            }
        });

        assert.equal(result.intent, "route");
        assert.equal(result.origin, "helsinki");
        assert.equal(result.destination, "rovaniemi?");
        assert.deepEqual(result.staticDocs, staticDocs);
        assert.deepEqual(result.routeIds, ["route-001", "route-002"]);
        assert.deepEqual(result.tripIds, ["trip-001", "trip-002"]);
        assert.deepEqual(result.retrievalStatus, {
            code: "OK",
            scope: "route",
            message: ""
        });
        assert.deepEqual(result.realtime, {});
    });
});

describe("routeRetriever not matching metadata origin and destination, falls back to metadata stops and direction filtering", () => {
    test("uses metadata.stops fallback and keeps only forward-direction matches", async () => {
        const queryText = "Which trains operate between Pasila and Kerava?";
        const queryVector = [0.41, 0.52, 0.63];
        const strictResults = [];
        const bothStopsResults = [
            {
                text: "Forward trip pattern Pasila to Kerava",
                score: 0.87,
                metadata: {
                    type: "trip_pattern",
                    route_id: "route-forward",
                    trip_id: "trip-forward",
                    route_pattern_id: "route-forward_Pasila_Kerava",
                    stops: ["Pasila", "Tikkurila", "Kerava"]
                }
            },
            {
                text: "Reverse trip pattern Kerava to Pasila",
                score: 0.85,
                metadata: {
                    type: "trip_pattern",
                    route_id: "route-reverse",
                    trip_id: "trip-reverse",
                    route_pattern_id: "route-reverse_Kerava_Pasila",
                    stops: ["Kerava", "Tikkurila", "Pasila"]
                }
            }
        ];

        const capturedVectorSearchCalls = [];

        const routeRetriever = loadRouteRetrieverWithStubs({
            queryEmbedding: async () => queryVector,
            vectorSearch: async (receivedQueryVector, options) => {
                capturedVectorSearchCalls.push({
                    queryVector: receivedQueryVector,
                    options
                });

                if (capturedVectorSearchCalls.length === 1) return strictResults;
                if (capturedVectorSearchCalls.length === 2) return bothStopsResults;

                throw new Error("vectorSearch should only be called twice in this scenario.");
            },
            detectRtIntent: () => ({ needsRt: false, matchedKeyword: null })
        });

        const result = await routeRetriever(queryText, {
            direction: {
                origin: "Pasila",
                destination: "Kerava"
            }
        });

        assert.equal(capturedVectorSearchCalls.length, 2);
        assert.deepEqual(capturedVectorSearchCalls[0], {
            queryVector,
            options: {
                filter: {
                    "metadata.type": "trip_pattern",
                    "metadata.origin": "Pasila",
                    "metadata.destination": "Kerava"
                },
                limit: 8,
                minScore: 0.70,
                dedupe: {
                    enabled: true,
                    keyFields: ["route_pattern_id"],
                    applyTypes: ["trip_pattern"]
                }
            }
        });
        assert.deepEqual(capturedVectorSearchCalls[1], {
            queryVector,
            options: {
                filter: {
                    "$and": [
                        { "metadata.type": "trip_pattern" },
                        { "metadata.stops": "Pasila" },
                        { "metadata.stops": "Kerava" }
                    ]
                },
                limit: 8,
                minScore: 0.70,
                dedupe: {
                    enabled: true,
                    keyFields: ["route_pattern_id"],
                    applyTypes: ["trip_pattern"]
                }
            }
        });

        assert.equal(result.intent, "route");
        assert.deepEqual(result.staticDocs, [bothStopsResults[0]]);
        assert.deepEqual(result.routeIds, ["route-forward"]);
        assert.deepEqual(result.tripIds, ["trip-forward"]);
        assert.deepEqual(result.retrievalStatus, {
            code: "OK",
            scope: "route",
            message: ""
        });
        assert.deepEqual(result.realtime, {});
    });
});

describe("routeRetriever no directional match handling", () => {
    test("returns NO_DIRECTIONAL_MATCH when explicit directional query has no strict or forward fallback stops matches", async () => {
        const queryText = "Which trains operate between Pasila and Kerava?";
        const queryVector = [0.71, 0.82, 0.93];
        const strictResults = [];
        const bothStopsResults = [
            {
                text: "Reverse trip pattern Kerava to Pasila",
                score: 0.85,
                metadata: {
                    type: "trip_pattern",
                    route_id: "route-reverse",
                    trip_id: "trip-reverse",
                    route_pattern_id: "route-reverse_Kerava_Pasila",
                    stops: ["Kerava", "Tikkurila", "Pasila"]
                }
            }
        ];

        let vectorSearchCallCount = 0;

        const routeRetriever = loadRouteRetrieverWithStubs({
            queryEmbedding: async () => queryVector,
            vectorSearch: async () => {
                vectorSearchCallCount += 1;

                if (vectorSearchCallCount === 1) return strictResults;
                if (vectorSearchCallCount === 2) return bothStopsResults;

                throw new Error("vectorSearch should only be called twice in this scenario.");
            },
            detectRtIntent: () => ({ needsRt: false, matchedKeyword: null })
        });

        const result = await routeRetriever(queryText, {
            direction: {
                origin: "Pasila",
                destination: "Kerava"
            }
        });

        assert.equal(vectorSearchCallCount, 2);
        assert.equal(result.intent, "route");
        assert.deepEqual(result.staticDocs, []);
        assert.deepEqual(result.routeIds, []);
        assert.deepEqual(result.tripIds, []);
        assert.deepEqual(result.retrievalStatus, {
            code: "NO_DIRECTIONAL_MATCH",
            scope: "route",
            message: "No directional route match found from Pasila to Kerava."
        });
        assert.deepEqual(result.realtime, {});
    });
});

describe("routeRetriever realtime enrichment", () => {
    test("returns realtime-enriched package when realtime is requested and route ids exist", async () => {
        const queryText = "Is there any disruption on the Turku route today?";
        const queryVector = [0.14, 0.24, 0.34];
        const staticDocs = [
            {
                text: "Trip pattern Turku to Helsinki",
                score: 0.9,
                metadata: {
                    type: "trip_pattern",
                    route_id: "route-turku-helsinki",
                    trip_id: "trip-turku-helsinki",
                    route_pattern_id: "route-turku-helsinki_Turku_Helsinki"
                }
            }
        ];
        const realtimePayload = {
            data: {
                tripUpdates: [
                    {
                        tripId: "trip-turku-helsinki",
                        routeId: "route-turku-helsinki",
                        delay: 180
                    }
                ]
            }
        };
        const realtimeFacts = [
            {
                routeId: "route-turku-helsinki",
                tripId: "trip-turku-helsinki",
                status: "delayed",
                delay: 180
            }
        ];
        const interpretedRealtime = {
            hasRealtime: true,
            summary: "One delayed trip found on the route.",
            facts: realtimeFacts,
            stats: {
                delayed: 1
            }
        };

        let fetchRealTimeUpdatesCalled = 0;
        let normalizeToRtFactsInput = null;
        let interpretTrainRouteRealtimeInput = null;

        const routeRetriever = loadRouteRetrieverWithStubs({
            queryEmbedding: async () => queryVector,
            vectorSearch: async () => staticDocs,
            detectRtIntent: () => ({ needsRt: true, matchedKeyword: "disruption" }),
            fetchRealTimeUpdates: async () => {
                fetchRealTimeUpdatesCalled += 1;
                return realtimePayload;
            },
            normalizeToRtFacts: (tripUpdates) => {
                normalizeToRtFactsInput = tripUpdates;
                return realtimeFacts;
            },
            interpretTrainRouteRealtime: (input) => {
                interpretTrainRouteRealtimeInput = input;
                return interpretedRealtime;
            }
        });

        const result = await routeRetriever(queryText, {
            direction: {
                origin: "Turku",
                destination: "Helsinki"
            }
        });

        assert.equal(fetchRealTimeUpdatesCalled, 1);
        assert.deepEqual(normalizeToRtFactsInput, realtimePayload.data.tripUpdates);
        assert.deepEqual(interpretTrainRouteRealtimeInput, {
            realtimeFacts,
            routeIds: ["route-turku-helsinki"],
            tripIds: ["trip-turku-helsinki"]
        });

        assert.equal(result.intent, "route");
        assert.deepEqual(result.staticDocs, staticDocs);
        assert.deepEqual(result.routeIds, ["route-turku-helsinki"]);
        assert.deepEqual(result.tripIds, ["trip-turku-helsinki"]);
        assert.deepEqual(result.retrievalStatus, {
            code: "OK",
            scope: "route",
            message: ""
        });
        assert.deepEqual(result.realtime, interpretedRealtime);
    });
});
