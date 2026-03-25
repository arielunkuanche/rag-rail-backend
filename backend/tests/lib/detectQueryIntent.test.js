const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { detectQueryIntent } = require("../../lib/detectQueryIntent");
const { loadDetectQueryIntentWithStopStub } = require("../helpers/loadDetectQueryIntentWithStopStub");

describe("detectQueryIntent exact train detection", () => {
    test("detects IC 45 as an exact train", async () => {
        const result = detectQueryIntent("Is train IC 45 delayed?");

        assert.equal(result.intent, "train-exact");
        assert.equal(result.trainNumber, "IC 45");
    });

    test("detects IC45 and normalizes it to IC 45", async () => {
        const result = detectQueryIntent("What time does IC45 depart from Helsinki?");

        assert.equal(result.intent, "train-exact");
        assert.equal(result.trainNumber, "IC 45");
    });

    test("detects S 2 as an exact train", async () => {
        const result = detectQueryIntent("What is the scheduled arrival time of train S 2 in Tampere?");

        assert.equal(result.intent, "train-exact");
        assert.equal(result.trainNumber, "S 2");
    });

    test("detects PYO 263 as an exact train", async () => {
        const result = detectQueryIntent("Is PYO 263 running tonight?");

        assert.equal(result.intent, "train-exact");
        assert.equal(result.trainNumber, "PYO 263");
    });

    test("detects Z (HL 9804) as an exact train", async () => {
        const result = detectQueryIntent("Where is Z (HL 9804) right now?");

        assert.equal(result.intent, "train-exact");
        assert.equal(result.trainNumber, "Z (HL 9804)");
    });
});

describe("detectQueryIntent route intent detection", () => {
    test("detects route intent for from X to Y phrasing", async () => {
        const result = detectQueryIntent("What is the route from Helsinki to Rovaniemi?");

        assert.equal(result.intent, "route");
        assert.equal(result.direction.origin, "Helsinki");
        assert.equal(result.direction.destination, "Rovaniemi?");
    });

    test("detects route intent for between X and Y phrasing", async () => {
        const result = detectQueryIntent("Which trains operate between Pasila and Kerava?");

        assert.equal(result.intent, "route");
        assert.equal(result.direction.origin, "Pasila");
        assert.equal(result.direction.destination, "Kerava?");
    });

    test("detects route intent for arrow syntax", async () => {
        const result = detectQueryIntent("Show me the Helsinki → Tampere railway route.");

        assert.equal(result.intent, "route");
        assert.equal(result.direction.origin, "Show me the Helsinki");
        assert.equal(result.direction.destination, "Tampere railway route.");
    });

    test("detects route intent for hyphen syntax when route keywords are present", async () => {
        const result = detectQueryIntent("Show me the Helsinki - Tampere railway route.");

        assert.equal(result.intent, "route");
        assert.equal(result.direction.origin, "Helsinki");
        assert.equal(result.direction.destination, "Tampere");
    });
});

describe("detectQueryIntent stop intent detection", () => {
    test("detects stop intent for a multi-word station query", async () => {
        const matchedStop = {
            stop_id: "HKI",
            stop_name: "Helsinki Central"
        };
        const detectQueryIntentWithStub = loadDetectQueryIntentWithStopStub((queryText) => {
            assert.equal(queryText, "what routes go through helsinki central");
            return matchedStop;
        });

        const result = detectQueryIntentWithStub("What routes go through Helsinki Central?");

        assert.equal(result.intent, "stop");
        assert.deepEqual(result.stop, matchedStop);
    });

    test("detects stop intent when station keyword is present in the query", async () => {
        const matchedStop = {
            stop_id: "TKU",
            stop_name: "Turku"
        };
        const detectQueryIntentWithStub = loadDetectQueryIntentWithStopStub((queryText) => {
            assert.equal(queryText, "what routes serve turku");
            return matchedStop;
        });

        const result = detectQueryIntentWithStub("What routes serve Turku station?");

        assert.equal(result.intent, "stop");
        assert.deepEqual(result.stop, matchedStop);
    });

    test("returns the mocked stop object unchanged for natural-language stop phrasing", async () => {
        const matchedStop = {
            stop_id: "PSL",
            stop_name: "Pasila"
        };
        const detectQueryIntentWithStub = loadDetectQueryIntentWithStopStub((queryText) => {
            assert.equal(queryText, "which trains at pasila");
            return matchedStop;
        });

        const result = detectQueryIntentWithStub("Which trains stop at Pasila?");

        assert.equal(result.intent, "stop");
        assert.deepEqual(result.stop, matchedStop);
    });
});

describe("detectQueryIntent stop route-context extraction", () => {
    test("extracts route context destination from stop queries", async () => {
        const matchedStop = {
            stop_id: "PSL",
            stop_name: "Pasila"
        };
        const detectQueryIntentWithStub = loadDetectQueryIntentWithStopStub((queryText) => {
            assert.equal(queryText, "i am at pasila how to get to oulu");
            return matchedStop;
        });

        const result = detectQueryIntentWithStub("I am at Pasila how to get to Oulu");

        assert.equal(result.intent, "stop");
        assert.deepEqual(result.stop, matchedStop);
        assert.deepEqual(result.routeContext, { destination: "Oulu" });
    });

    test("strips trailing fillers from extracted stop route-context destination", async () => {
        const matchedStop = {
            stop_id: "PSL",
            stop_name: "Pasila"
        };
        const detectQueryIntentWithStub = loadDetectQueryIntentWithStopStub((queryText) => {
            assert.equal(queryText, "i am at pasila how to get to oulu right now please");
            return matchedStop;
        });

        const result = detectQueryIntentWithStub("I am at Pasila how to get to Oulu right now please");

        assert.equal(result.intent, "stop");
        assert.deepEqual(result.stop, matchedStop);
        assert.deepEqual(result.routeContext, { destination: "Oulu" });
    });
});

describe("detectQueryIntent train-family detection", () => {
    test("detects train-group intent for high-confidence family phrasing", async () => {
        const result = detectQueryIntent("What trains run on the Z train?");

        assert.equal(result.intent, "train-group");
        assert.equal(result.trainFamily, "Z");
    });

    test("does not misclassify incidental leading I as a train family", async () => {
        const result = detectQueryIntent("I am now at Jyväskylä, what is the next train to Tampere now?");

        assert.notEqual(result.intent, "train-group");
    });
});

describe("detectQueryIntent arbitration and fallback behavior", () => {
    test("prefers route intent over stop intent when explicit route syntax exists", async () => {
        const matchedStop = {
            stop_id: "HKI",
            stop_name: "Helsinki"
        };
        const detectQueryIntentWithStub = loadDetectQueryIntentWithStopStub(() => matchedStop);

        const result = detectQueryIntentWithStub("What is the route from Helsinki to Rovaniemi?");

        assert.equal(result.intent, "route");
        assert.equal(result.direction.origin, "Helsinki");
        assert.equal(result.direction.destination, "Rovaniemi?");
        assert.deepEqual(result.stopContext, matchedStop);
    });

    test("falls back to train-ambiguous when train keywords exist without exact or group resolution", async () => {
        const result = detectQueryIntent("What train should I take tonight?");

        assert.equal(result.intent, "train-ambiguous");
    });

    test("falls back to general when no route stop or train intent is detected", async () => {
        const result = detectQueryIntent("Tell me about Finnish railways.");

        assert.equal(result.intent, "general");
    });
});
