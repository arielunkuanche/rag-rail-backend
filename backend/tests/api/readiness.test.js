const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const supertest = require("supertest");
const { createApp } = require("../../server");

describe("GET /ready", () => {
    test("returns 200 when all readiness checks pass", async () => {
        const app = createApp({
            bootStartedAt: "2026-03-21T00:00:00.000Z",
            envValidated: true,
            dbConnected: true,
            stopsLoaded: true,
            lastBootError: null
        });

        const response = await supertest(app)
            .get("/ready")
            .expect(200)
            .expect("Content-Type", /application\/json/);

        assert.deepEqual(response.body, {
            status: "ready",
            checks: {
                envValidated: true,
                dbConnected: true,
                stopsLoaded: true
            },
            lastBootError: null
        });
    });

    test("returns 503 when any readiness check is not ready", async () => {
        const app = createApp({
            bootStartedAt: "2026-03-21T00:00:00.000Z",
            envValidated: true,
            dbConnected: true,
            stopsLoaded: false,
            lastBootError: "Database connection failed."
        });

        const response = await supertest(app)
            .get("/ready")
            .expect(503)
            .expect("Content-Type", /application\/json/);

        assert.deepEqual(response.body, {
            status: "not_ready",
            checks: {
                envValidated: true,
                dbConnected: true,
                stopsLoaded: false
            },
            lastBootError: "Database connection failed."
        });
    });
});
