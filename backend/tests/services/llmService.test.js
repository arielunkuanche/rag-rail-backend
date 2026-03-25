const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { loadLlmServiceWithStubs } = require("../helpers/loadLlmServiceWithStubs");

describe("llmService fallback behavior when Gemini key is missing", () => {
    test("returns the stable fallback object when the Gemini API key is unavailable", async () => {
        const { generateResponse } = loadLlmServiceWithStubs({
            geminiApiKey: undefined
        });

        const result = await generateResponse(
            "What is the route from Helsinki to Rovaniemi?",
            [{ text: "Trip pattern Helsinki to Rovaniemi", metadata: { type: "trip_pattern" } }],
            { hasRealtime: false },
            { code: "OK", message: "" }
        );

        assert.deepEqual(result, {
            answer: "I encountered a technical error while processing the data.",
            static_context_used: [],
            realtime_context_used: [],
            related_routes: [],
            related_train_numbers_or_groups: [],
            confidence: "low",
            notes: "LLM API Key is required."
        });
    });
});

describe("llmService retrieval-status short-circuit responses", () => {
    test("returns the NO_DIRECTIONAL_MATCH fallback response without calling the provider", async () => {
        let googleGenAIConstructed = 0;
        const { generateResponse } = loadLlmServiceWithStubs({
            geminiApiKey: "test-gemini-key",
            GoogleGenAI: class {
                constructor() {
                    googleGenAIConstructed += 1;
                    this.chats = {
                        create: () => {
                            throw new Error("provider should not be called for NO_DIRECTIONAL_MATCH");
                        }
                    };
                }
            }
        });

        const result = await generateResponse(
            "What is the route from Helsinki to Rovaniemi?",
            [],
            {},
            {
                code: "NO_DIRECTIONAL_MATCH",
                message: "No directional route match found from Helsinki to Rovaniemi."
            }
        );

        assert.equal(googleGenAIConstructed, 1);
        assert.deepEqual(result, {
            answer: "I could not find a direct route matching your requested direction in the current static schedule data.",
            static_context_used: [],
            realtime_context_used: [],
            related_routes: [],
            related_train_numbers_or_groups: [],
            confidence: "medium",
            notes: "No directional route match found from Helsinki to Rovaniemi."
        });
    });

    test("returns the NO_STATIC_MATCH fallback response without calling the provider", async () => {
        let googleGenAIConstructed = 0;
        const { generateResponse } = loadLlmServiceWithStubs({
            geminiApiKey: "test-gemini-key",
            GoogleGenAI: class {
                constructor() {
                    googleGenAIConstructed += 1;
                    this.chats = {
                        create: () => {
                            throw new Error("provider should not be called for NO_STATIC_MATCH");
                        }
                    };
                }
            }
        });

        const result = await generateResponse(
            "Which trains stop at Pasila?",
            [],
            {},
            {
                code: "NO_STATIC_MATCH",
                message: "No static stop traveling route matches found for stop Pasila."
            }
        );

        assert.equal(googleGenAIConstructed, 1);
        assert.deepEqual(result, {
            answer: "I could not find matching static schedule information for your request.",
            static_context_used: [],
            realtime_context_used: [],
            related_routes: [],
            related_train_numbers_or_groups: [],
            confidence: "low",
            notes: "No static stop traveling route matches found for stop Pasila."
        });
    });
});

describe("llmService JSON parsing sanitization and malformed-output fallback", () => {
    test("returns a normalized response when the provider returns valid JSON", async () => {
        const rawJson = JSON.stringify({
            answer: "Train IC 45 is delayed by 5 minutes.",
            static_context_used: ["Trip pattern Helsinki to Tampere"],
            realtime_context_used: ["Delay reported for IC 45"],
            related_routes: ["Helsinki - Tampere"],
            related_train_numbers_or_groups: ["IC 45"],
            confidence: "high",
            notes: "Generated from valid JSON."
        });

        const { generateResponse } = loadLlmServiceWithStubs({
            geminiApiKey: "test-gemini-key",
            GoogleGenAI: class {
                constructor() {
                    this.chats = {
                        create: () => ({
                            sendMessage: async () => ({ text: rawJson })
                        })
                    };
                }
            }
        });

        const result = await generateResponse(
            "Is train IC 45 delayed?",
            [{ text: "Trip pattern Helsinki to Tampere", metadata: { type: "trip_pattern" } }],
            {
                hasRealtime: true,
                summary: "One delayed train found.",
                facts: [{ routeId: "IC", stopName: "Tampere", status: "delayed", delay: 300 }],
                stats: { delayed: 1 }
            },
            { code: "OK", message: "" }
        );

        assert.deepEqual(result, {
            answer: "Train IC 45 is delayed by 5 minutes.",
            static_context_used: ["Trip pattern Helsinki to Tampere"],
            realtime_context_used: ["Delay reported for IC 45"],
            related_routes: ["Helsinki - Tampere"],
            related_train_numbers_or_groups: ["IC 45"],
            confidence: "high",
            notes: "Generated from valid JSON."
        });
    });

    test("uses sanitizeLLMOutput when raw provider text is not directly parseable JSON", async () => {
        let sanitizeCalls = 0;
        const sanitizedJson = JSON.stringify({
            answer: "No direct route was found.",
            static_context_used: [],
            realtime_context_used: [],
            related_routes: [],
            related_train_numbers_or_groups: [],
            confidence: "medium",
            notes: "Recovered after sanitization."
        });

        const { generateResponse } = loadLlmServiceWithStubs({
            geminiApiKey: "test-gemini-key",
            GoogleGenAI: class {
                constructor() {
                    this.chats = {
                        create: () => ({
                            sendMessage: async () => ({ text: "```json\nnot valid raw json\n```" })
                        })
                    };
                }
            },
            sanitizeLLMOutput: (rawText) => {
                sanitizeCalls += 1;
                assert.equal(rawText, "```json\nnot valid raw json\n```");
                return sanitizedJson;
            }
        });

        const result = await generateResponse(
            "What is the route from Helsinki to Rovaniemi?",
            [],
            {},
            { code: "OK", message: "" }
        );

        assert.equal(sanitizeCalls, 1);
        assert.deepEqual(result, {
            answer: "No direct route was found.",
            static_context_used: [],
            realtime_context_used: [],
            related_routes: [],
            related_train_numbers_or_groups: [],
            confidence: "medium",
            notes: "Recovered after sanitization."
        });
    });

    test("returns the stable fallback response when provider output remains malformed after sanitization", async () => {
        let sanitizeCalls = 0;
        const { generateResponse } = loadLlmServiceWithStubs({
            geminiApiKey: "test-gemini-key",
            GoogleGenAI: class {
                constructor() {
                    this.chats = {
                        create: () => ({
                            sendMessage: async () => ({ text: "not json at all" })
                        })
                    };
                }
            },
            sanitizeLLMOutput: (rawText) => {
                sanitizeCalls += 1;
                assert.equal(rawText, "not json at all");
                return "still not valid json";
            }
        });

        const result = await generateResponse(
            "Which trains stop at Pasila?",
            [],
            {},
            { code: "OK", message: "" }
        );

        assert.equal(sanitizeCalls, 1);
        assert.deepEqual(result, {
            answer: "I encountered a technical error while processing the data.",
            static_context_used: [],
            realtime_context_used: [],
            related_routes: [],
            related_train_numbers_or_groups: [],
            confidence: "low",
            notes: "LLM response generation failed."
        });
    });
});
