const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const supertest = require('supertest');

const { loadServerWithRagDependencyStubs } = require('../helpers/loadServerWithRagDependencyStubs');

describe('route query request flow integration', () => {
    test('routes a representative route query through intent detection, retrieval, and response assembly', async () => {
        const detectQueryIntentCalls = [];
        const routeRetrieverCalls = [];
        const generateResponseCalls = [];

        const retrievalPackage = {
            staticDocs: [
                {
                    text: 'Route R1: Helsinki - Oulu',
                    metadata: {
                        type: 'route',
                        route_id: 'R1',
                        origin: 'Helsinki',
                        destination: 'Oulu'
                    }
                }
            ],
            realtime: {},
            retrievalStatus: {
                code: 'OK',
                message: ''
            }
        };
        const llmResponse = {
            answer: 'Take route R1 from Helsinki to Oulu.',
            static_context_used: ['Route R1: Helsinki - Oulu'],
            realtime_context_used: [],
            related_routes: ['R1'],
            related_train_numbers_or_groups: ['IC 265'],
            confidence: 'high',
            notes: 'Mocked integration response.'
        };
        const { createApp } = loadServerWithRagDependencyStubs({
            detectQueryIntent: (queryText) => {
                detectQueryIntentCalls.push(queryText);
                return {
                    intent: 'route',
                    direction: {
                        origin: 'Helsinki',
                        destination: 'Oulu'
                    }
                };
            },
            routeRetriever: async(queryText, intent) => {
                routeRetrieverCalls.push({ queryText, intent });
                return retrievalPackage;
            },
            generateResponse: async(queryText, staticDocs, realtime, retrievalStatus) => {
                generateResponseCalls.push({ queryText, staticDocs, realtime, retrievalStatus });
                return llmResponse;
            }
        });
        const app = createApp({
            bootStartedAt: '2026-03-21T00:00:00.000Z',
            envValidated: true,
            dbConnected: true,
            stopsLoaded: true,
            lastBootError: null
        });

        const response = await supertest(app)
            .post('/api/query/search')
            .send({ queryText: '  How do I get from Helsinki to Oulu?  ' })
            .expect(200)
            .expect('Content-Type', /application\/json/);

        assert.deepEqual(detectQueryIntentCalls, ['How do I get from Helsinki to Oulu?']);
        assert.deepEqual(routeRetrieverCalls, [
            {
                queryText: 'How do I get from Helsinki to Oulu?',
                intent: {
                    intent: 'route',
                    direction: {
                        origin: 'Helsinki',
                        destination: 'Oulu'
                    }
                }
            }
        ]);
        assert.deepEqual(generateResponseCalls, [
            {
                queryText: 'How do I get from Helsinki to Oulu?',
                staticDocs: retrievalPackage.staticDocs,
                realtime: {},
                retrievalStatus: {
                    code: 'OK',
                    message: ''
                }
            }
        ]);
        assert.deepEqual(response.body, {
            query: 'How do I get from Helsinki to Oulu?',
            intent: 'route',
            answer: llmResponse
        });
    });
});
