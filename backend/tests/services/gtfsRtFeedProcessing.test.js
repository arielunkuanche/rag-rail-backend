const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { loadGtfsRtServiceWithStubs } = require("../helpers/loadGtfsRtServiceWithStubs");
const { loadNormalizeToRtFactsWithStopStub } = require("../helpers/loadNormalizeToRtFactsWithStopStub");

describe("GTFS-RT feed extraction and normalization to facts", () => {
    test("extracts trip updates from the feed and normalizes them into realtime facts", async () => {
        const tripUpdateRaw = {
            trip: {
                routeId: "route-helsinki-tampere",
                tripId: "trip-001",
                startDate: "20260321",
                scheduleRelationship: 0
            },
            stopTimeUpdate: [
                {
                    stopId: "PSL_1",
                    stopSequence: 5,
                    arrival: { delay: 180 },
                    departure: { delay: 180 },
                    scheduleRelationship: 0
                },
                {
                    stopTimeProperties: { assignedStopId: "HKI_2" },
                    stopSequence: 8,
                    departure: { delay: 0 },
                    scheduleRelationship: 1
                }
            ]
        };
        const decodedFeed = {
            entity: [
                {
                    id: "trip-entity-1",
                    tripUpdate: tripUpdateRaw
                },
                {
                    id: "vehicle-entity-1",
                    vehicle: {
                        trip: {
                            tripId: "trip-001",
                            routeId: "route-helsinki-tampere"
                        },
                        vehicle: {
                            id: "vehicle-001",
                            label: "IC 45"
                        },
                        position: {
                            latitude: 60.1719,
                            longitude: 24.941
                        },
                        currentStatus: 2,
                        timestamp: 1711010101
                    }
                },
                {
                    id: "alert-entity-1",
                    alert: {
                        informedEntity: { routeId: "route-helsinki-tampere" },
                        cause: 1,
                        effect: 2,
                        descriptionText: {
                            translation: [{ text: "Delay on the route" }]
                        },
                        url: {
                            translation: [{ text: "https://example.test/alert" }]
                        }
                    }
                }
            ]
        };

        let axiosRequest = null;
        let decodeInput = null;

        const { fetchRealTimeUpdates } = loadGtfsRtServiceWithStubs({
            axiosGet: async (url, options) => {
                axiosRequest = { url, options };
                return { data: new Uint8Array([1, 2, 3, 4]) };
            },
            decode: (input) => {
                decodeInput = input;
                return decodedFeed;
            }
        });
        const normalizeToRtFacts = loadNormalizeToRtFactsWithStopStub({
            getStopById: (stopId) => {
                if (stopId === "PSL") return { stop_name: "Pasila" };
                if (stopId === "HKI") return { stop_name: "Helsinki Central" };
                return null;
            }
        });

        const realtimeResult = await fetchRealTimeUpdates(true);
        const facts = normalizeToRtFacts(realtimeResult.data.tripUpdates);

        assert.deepEqual(axiosRequest, {
            url: "https://example.test/gtfs-rt",
            options: {
                headers: {
                    "Digitraffic-User": "test-user-header",
                    Accept: "application/x-protobuf"
                },
                responseType: "arraybuffer"
            }
        });
        assert.ok(decodeInput instanceof Uint8Array);
        assert.equal(realtimeResult.source, "api");
        assert.equal(realtimeResult.data.tripUpdates.length, 1);
        assert.equal(realtimeResult.data.vehicleUpdates.length, 1);
        assert.equal(realtimeResult.data.alertUpdates.length, 1);
        assert.deepEqual(realtimeResult.data.tripUpdates[0], {
            id: "trip-entity-1",
            routeId: "route-helsinki-tampere",
            tripId: "trip-001",
            startDate: "20260321",
            scheduleRelationship: 0,
            raw: tripUpdateRaw
        });
        assert.deepEqual(facts.map(({ timestamp, ...fact }) => fact), [
            {
                tripId: "trip-001",
                routeId: "route-helsinki-tampere",
                stopId: "PSL",
                stopName: "Pasila",
                stopSequence: 5,
                delay: 180,
                status: "delayed",
                scheduleRelationshipRaw: 0,
                scheduleRelationshipLabel: "SCHEDULED",
                arrivalDelay: 180,
                departureDelay: 180
            },
            {
                tripId: "trip-001",
                routeId: "route-helsinki-tampere",
                stopId: "HKI",
                stopName: "Helsinki Central",
                stopSequence: 8,
                delay: 0,
                status: "cancelled",
                scheduleRelationshipRaw: 1,
                scheduleRelationshipLabel: "SKIPPED",
                arrivalDelay: null,
                departureDelay: null
            }
        ]);
    });
});
