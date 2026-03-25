const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { loadQueryEmbeddingWithStubs } = require("../helpers/loadQueryEmbeddingWithStubs");

const withImmediateTimeouts = async (fn) => {
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback, _delay, ...args) => {
        callback(...args);
        return 0;
    };

    try {
        await fn();
    } finally {
        global.setTimeout = originalSetTimeout;
    }
};

describe("queryEmbedding input and API key guards", () => {
    test("throws a deterministic error when query text is missing", async () => {
        const queryEmbedding = loadQueryEmbeddingWithStubs({
            config: {
                hfApiKey: "test-api-key"
            }
        });

        await assert.rejects(
            queryEmbedding(""),
            {
                message: "Query text is required."
            }
        );
    });

    test("throws a deterministic error when Hugging Face API key is missing", async () => {
        const queryEmbedding = loadQueryEmbeddingWithStubs({
            config: {
                hfApiKey: ""
            }
        });

        await assert.rejects(
            queryEmbedding("What is the route from Helsinki to Rovaniemi?"),
            {
                message: "HuggingFace API key is missing."
            }
        );
    });
});

describe("queryEmbedding successful embedding generation and cache hits", () => {
    test("returns the embedded query vector and serves repeated identical queries from cache", async () => {
        const expectedVector = [0.11, 0.22, 0.33];
        const axiosCalls = [];
        const queryEmbedding = loadQueryEmbeddingWithStubs({
            config: {
                hfApiKey: "test-api-key",
                apiUrl: "https://example.test/embeddings"
            },
            axiosPost: async (url, body, options) => {
                axiosCalls.push({ url, body, options });
                return { data: expectedVector };
            }
        });

        const firstResult = await queryEmbedding("What is the route from Helsinki to Rovaniemi?");
        const secondResult = await queryEmbedding("What is the route from Helsinki to Rovaniemi?");

        assert.deepEqual(firstResult, expectedVector);
        assert.deepEqual(secondResult, expectedVector);
        assert.equal(axiosCalls.length, 1);
        assert.deepEqual(axiosCalls[0], {
            url: "https://example.test/embeddings",
            body: {
                inputs: "What is the route from Helsinki to Rovaniemi?",
                options: {
                    wait_for_model: true
                }
            },
            options: {
                headers: {
                    Authorization: "Bearer test-api-key",
                    "Content-Type": "application/json"
                },
                timeout: 15000
            }
        });
    });
});

describe("queryEmbedding retry and mapped error paths", () => {
    test("retries on timeout and eventually returns the embedding vector", async () => {
        await withImmediateTimeouts(async () => {
            const expectedVector = [0.44, 0.55, 0.66];
            let axiosCallCount = 0;
            const queryEmbedding = loadQueryEmbeddingWithStubs({
                config: {
                    hfApiKey: "test-api-key",
                    apiUrl: "https://example.test/embeddings"
                },
                axiosPost: async () => {
                    axiosCallCount += 1;

                    if (axiosCallCount < 3) {
                        const error = new Error("timeout");
                        error.code = "ETIMEDOUT";
                        throw error;
                    }

                    return { data: expectedVector };
                }
            });

            const result = await queryEmbedding("Which trains stop at Pasila?");

            assert.deepEqual(result, expectedVector);
            assert.equal(axiosCallCount, 3);
        });
    });

    test("retries on retryable provider server errors and eventually returns the embedding vector", async () => {
        await withImmediateTimeouts(async () => {
            const expectedVector = [0.77, 0.88, 0.99];
            let axiosCallCount = 0;
            const queryEmbedding = loadQueryEmbeddingWithStubs({
                config: {
                    hfApiKey: "test-api-key",
                    apiUrl: "https://example.test/embeddings"
                },
                axiosPost: async () => {
                    axiosCallCount += 1;

                    if (axiosCallCount < 3) {
                        const error = new Error("server unavailable");
                        error.response = { status: 503 };
                        throw error;
                    }

                    return { data: expectedVector };
                }
            });

            const result = await queryEmbedding("What is the route from Helsinki to Rovaniemi?");

            assert.deepEqual(result, expectedVector);
            assert.equal(axiosCallCount, 3);
        });
    });

    test("does not retry on authentication failure and returns the mapped auth error", async () => {
        let axiosCallCount = 0;
        const queryEmbedding = loadQueryEmbeddingWithStubs({
            config: {
                hfApiKey: "test-api-key",
                apiUrl: "https://example.test/embeddings"
            },
            axiosPost: async () => {
                axiosCallCount += 1;
                const error = new Error("unauthorized");
                error.response = { status: 401 };
                throw error;
            }
        });

        await assert.rejects(
            queryEmbedding("Which trains stop at Pasila?"),
            {
                message: "[queryEmbedding] Embedding provider authentication failed."
            }
        );
        assert.equal(axiosCallCount, 1);
    });

    test("returns a mapped public error when provider response shape is invalid", async () => {
        const queryEmbedding = loadQueryEmbeddingWithStubs({
            config: {
                hfApiKey: "test-api-key",
                apiUrl: "https://example.test/embeddings"
            },
            axiosPost: async () => ({ data: { invalid: true } })
        });

        await assert.rejects(
            queryEmbedding("Which trains stop at Pasila?"),
            {
                message: "[queryEmbedding] Embedding service failed: Embedding response format was invalid."
            }
        );
    });
});
