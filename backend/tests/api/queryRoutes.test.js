const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const supertest = require("supertest");
const { loadServerWithStubs } = require("../helpers/loadServerWithStubs");

describe("POST /api/query/search", () => {
    test("returns 200 with a stable success response for a valid query", async () => {
        const getRagResultsCalls = [];
        const expectedResult = {
            intent: "route",
            answer: {
                answer: "A route answer",
                static_context_used: ["doc-1"],
                realtime_context_used: [],
                related_routes: ["Helsinki-Rovaniemi"],
                related_train_numbers_or_groups: ["IC 265"],
                confidence: "high",
                notes: "Mocked result."
            }
        };
        const { createApp } = loadServerWithStubs({
            getRagResults: async(queryText) => {
                getRagResultsCalls.push(queryText);
                return expectedResult;
            }
        });
        const app = createApp({
            bootStartedAt: "2026-03-21T00:00:00.000Z",
            envValidated: true,
            dbConnected: true,
            stopsLoaded: true,
            lastBootError: null
        });

        const response = await supertest(app)
            .post("/api/query/search")
            .send({ queryText: "  route from Helsinki to Rovaniemi  " })
            .expect(200)
            .expect("Content-Type", /application\/json/);

        assert.deepEqual(getRagResultsCalls, ["route from Helsinki to Rovaniemi"]);
        assert.equal(response.body.query, "route from Helsinki to Rovaniemi");
        assert.deepEqual(response.body, {
            query: "route from Helsinki to Rovaniemi",
            ...expectedResult
        });
    });

    test("returns 400 when queryText is missing", async () => {
        const getRagResultsCalls = [];
        const { createApp } = loadServerWithStubs({
            getRagResults: async(queryText) => {
                getRagResultsCalls.push(queryText);
                return {};
            }
        });
        const app = createApp({
            bootStartedAt: "2026-03-21T00:00:00.000Z",
            envValidated: true,
            dbConnected: true,
            stopsLoaded: true,
            lastBootError: null
        });

        const response = await supertest(app)
            .post("/api/query/search")
            .send({})
            .expect(400)
            .expect("Content-Type", /application\/json/);

        assert.deepEqual(getRagResultsCalls, []);
        assert.equal(typeof response.body.requestId, "string");
        assert.deepEqual(response.body, {
            code: "INVALID_QUERY_BODY",
            message: "Invalid request body.",
            requestId: response.body.requestId,
            details: "queryText must be a string."
        });
    });

    test("returns 400 when queryText is an empty string", async () => {
        const getRagResultsCalls = [];
        const { createApp } = loadServerWithStubs({
            getRagResults: async(queryText) => {
                getRagResultsCalls.push(queryText);
                return {};
            }
        });
        const app = createApp({
            bootStartedAt: "2026-03-21T00:00:00.000Z",
            envValidated: true,
            dbConnected: true,
            stopsLoaded: true,
            lastBootError: null
        });

        const response = await supertest(app)
            .post("/api/query/search")
            .send({ queryText: "" })
            .expect(400)
            .expect("Content-Type", /application\/json/);

        assert.deepEqual(getRagResultsCalls, []);
        assert.equal(typeof response.body.requestId, "string");
        assert.deepEqual(response.body, {
            code: "QUERY_TEXT_TOO_SHORT",
            message: "Invalid query text.",
            requestId: response.body.requestId,
            details: "queryText must be at least 2 characters."
        });
    });

    test("returns 400 when queryText is too short after trimming", async () => {
        const getRagResultsCalls = [];
        const { createApp } = loadServerWithStubs({
            getRagResults: async(queryText) => {
                getRagResultsCalls.push(queryText);
                return {};
            }
        });
        const app = createApp({
            bootStartedAt: "2026-03-21T00:00:00.000Z",
            envValidated: true,
            dbConnected: true,
            stopsLoaded: true,
            lastBootError: null
        });

        const response = await supertest(app)
            .post("/api/query/search")
            .send({ queryText: " a " })
            .expect(400)
            .expect("Content-Type", /application\/json/);

        assert.deepEqual(getRagResultsCalls, []);
        assert.equal(typeof response.body.requestId, "string");
        assert.deepEqual(response.body, {
            code: "QUERY_TEXT_TOO_SHORT",
            message: "Invalid query text.",
            requestId: response.body.requestId,
            details: "queryText must be at least 2 characters."
        });
    });

    test("returns 400 when queryText is too long", async () => {
        const getRagResultsCalls = [];
        const { createApp } = loadServerWithStubs({
            getRagResults: async(queryText) => {
                getRagResultsCalls.push(queryText);
                return {};
            }
        });
        const app = createApp({
            bootStartedAt: "2026-03-21T00:00:00.000Z",
            envValidated: true,
            dbConnected: true,
            stopsLoaded: true,
            lastBootError: null
        });
        const longQuery = "a".repeat(501);

        const response = await supertest(app)
            .post("/api/query/search")
            .send({ queryText: longQuery })
            .expect(400)
            .expect("Content-Type", /application\/json/);

        assert.deepEqual(getRagResultsCalls, []);
        assert.equal(typeof response.body.requestId, "string");
        assert.deepEqual(response.body, {
            code: "QUERY_TEXT_TOO_LONG",
            message: "Invalid query text.",
            requestId: response.body.requestId,
            details: "queryText must be at most 500 characters."
        });
    });

    test("returns 400 when queryText is not a string", async () => {
        const getRagResultsCalls = [];
        const { createApp } = loadServerWithStubs({
            getRagResults: async(queryText) => {
                getRagResultsCalls.push(queryText);
                return {};
            }
        });
        const app = createApp({
            bootStartedAt: "2026-03-21T00:00:00.000Z",
            envValidated: true,
            dbConnected: true,
            stopsLoaded: true,
            lastBootError: null
        });

        const response = await supertest(app)
            .post("/api/query/search")
            .send({ queryText: 12345 })
            .expect(400)
            .expect("Content-Type", /application\/json/);

        assert.deepEqual(getRagResultsCalls, []);
        assert.equal(typeof response.body.requestId, "string");
        assert.deepEqual(response.body, {
            code: "INVALID_QUERY_BODY",
            message: "Invalid request body.",
            requestId: response.body.requestId,
            details: "queryText must be a string."
        });
    });

    test("returns 504 when the request times out and does not send a duplicate response after the RAG promise resolves", async () => {
        let resolveRagResults;
        const getRagResultsCalls = [];
        const originalSetTimeout = global.setTimeout;
        const originalClearTimeout = global.clearTimeout;

        global.setTimeout = (callback) => {
            process.nextTick(callback);
            return { immediate: true };
        };
        global.clearTimeout = () => {};

        try {
            const { createApp } = loadServerWithStubs({
                getRagResults: (queryText) => {
                    getRagResultsCalls.push(queryText);
                    return new Promise((resolve) => {
                        resolveRagResults = resolve;
                    });
                }
            });
            const app = createApp({
                bootStartedAt: "2026-03-21T00:00:00.000Z",
                envValidated: true,
                dbConnected: true,
                stopsLoaded: true,
                lastBootError: null
            });

            const response = await supertest(app)
                .post("/api/query/search")
                .send({ queryText: "Route from Pasila to Oulu" })
                .expect(504)
                .expect("Content-Type", /application\/json/);

            assert.deepEqual(getRagResultsCalls, ["Route from Pasila to Oulu"]);
            assert.equal(typeof response.body.requestId, "string");
            assert.deepEqual(response.body, {
                code: "REQUEST_TIMEOUT",
                message: "Request timed out.",
                requestId: response.body.requestId,
                timeoutMs: 35000
            });

            resolveRagResults({
                intent: "route",
                answer: {
                    answer: "Late result"
                }
            });
            await new Promise((resolve) => setImmediate(resolve));
        } finally {
            global.setTimeout = originalSetTimeout;
            global.clearTimeout = originalClearTimeout;
        }
    });

    test("returns 500 with a stable error envelope for an internal query-processing error", async () => {
        const getRagResultsCalls = [];
        const { createApp } = loadServerWithStubs({
            getRagResults: async(queryText) => {
                getRagResultsCalls.push(queryText);
                throw new Error("Unexpected downstream failure.");
            }
        });
        const app = createApp({
            bootStartedAt: "2026-03-21T00:00:00.000Z",
            envValidated: true,
            dbConnected: true,
            stopsLoaded: true,
            lastBootError: null
        });

        const response = await supertest(app)
            .post("/api/query/search")
            .send({ queryText: "Route from Pasila to Oulu" })
            .expect(500)
            .expect("Content-Type", /application\/json/);

        assert.deepEqual(getRagResultsCalls, ["Route from Pasila to Oulu"]);
        assert.equal(typeof response.body.requestId, "string");
        assert.deepEqual(response.body, {
            code: "QUERY_PROCESSING_FAILED",
            message: "Query processing failed.",
            requestId: response.body.requestId,
            details: {
                stage: "query_route",
                code: "QUERY_PROCESSING_FAILED"
            }
        });
    });
});
