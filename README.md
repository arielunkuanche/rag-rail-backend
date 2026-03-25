# RAG Rail System

A retrieval-augmented generation (RAG) system for Finnish railway queries.

This project combines:

- a Node.js backend API for query handling, retrieval, realtime enrichment, and LLM response generation
- a Python ingestion pipeline for processing GTFS static railway data, generating embeddings, and storing them in MongoDB Atlas

The system is designed to answer questions such as:

- Which trains stop at Pasila?
- What is the route from Helsinki to Rovaniemi?
- Is train IC 45 delayed?
- What is the next available train from Kerava to Lahti?

---

## Overview

The system uses static GTFS schedule data as the main knowledge base and optionally enriches answers with GTFS Realtime data.

High-level flow:

1. Python ingestion downloads GTFS static data from Digitraffic.
2. The ingestion pipeline processes stops, routes, and trip patterns into documents.
3. Embeddings are generated with `sentence-transformers`.
4. Documents and embeddings are stored in MongoDB.
5. The backend receives a user query through the API.
6. The backend detects intent: train, route, or stop.
7. The backend generates a query embedding and performs MongoDB Atlas vector search.
8. If the query needs realtime status, GTFS-RT data is fetched and normalized.
9. Static and realtime context are sent to Gemini.
10. The backend returns a structured JSON answer.

---

## Architecture

### Backend

Location: `backend/`

Main responsibilities:

- start and expose the API
- validate environment and readiness
- detect user query intent
- generate user query embeddings
- retrieve relevant GTFS documents from MongoDB Atlas
- fetch and interpret GTFS Realtime updates
- call Gemini to synthesize the final response

Important modules:

- `server.js`
  - backend entrypoint
  - startup sequence
  - route registration
  - health and readiness endpoints
- `routes/queryRoutes.js`
  - main query endpoint: `POST /api/query/search`
- `services/ragService.js`
  - central orchestration for retrieval and LLM handoff
- `services/retrievers/`
  - retrieval logic by intent:
    - `trainRetriever.js`
    - `routeRetriever.js`
    - `stopRetriever.js`
- `services/queryEmbedding.js`
  - remote embedding generation via Hugging Face inference
- `services/vectorSearch.js`
  - MongoDB Atlas vector search wrapper
- `services/gtfsRtService.js`
  - GTFS realtime fetch and caching
- `services/llmService.js`
  - Gemini prompt construction and JSON response normalization
- `lib/detectQueryIntent.js`
  - train / route / stop intent detection
- `middleware/`
  - validation, timeout, request context, readiness, and error formatting

### Python Ingestion

Location: `python_ingestion/`

Main responsibilities:

- download GTFS static data
- parse GTFS tables into structured text documents
- generate embeddings
- insert a new ingestion version into the live MongoDB collection
- validate the new ingestion version before promotion
- preserve a backup of the previous live documents
- remove outdated live documents without replacing the collection itself
- create indexes for retrieval

Important modules:

- `main.py`
  - ingestion entrypoint
- `gtfs_processor.py`
  - downloads and processes GTFS data
- `gtfs_embedding.py`
  - embedding generation using `sentence-transformers`
- `mongodb_client.py`
  - MongoDB insert, versioned refresh, backup, index, and stats utilities

---

## Repository Structure

```text
rag-rail-system/
├─ backend/
├─ python_ingestion/
├─ docs/
├─ notebooks/
├─ pytest.ini
```

More detailed structure:

```text
backend/
├─ config/
├─ lib/
├─ middleware/
├─ realtime/
├─ routes/
├─ services/
└─ server.js

python_ingestion/
├─ tests/
├─ config.py
├─ gtfs_embedding.py
├─ gtfs_processor.py
├─ main.py
├─ mongodb_client.py
├─ requirements.txt
```

---

## Data Sources

### Static GTFS

Used by the ingestion pipeline.

Configured in `python_ingestion/config.py`:

- `GTFS_STATIC_URL`

### GTFS Realtime

Used by the backend for live train updates.

Configured in `backend/config/config.js`:

- `GTFS_RT_URL`

---

## Tech Stack

### Backend

- Node.js
- Express
- MongoDB Atlas
- Axios
- GTFS Realtime bindings
- Google Gemini (`@google/genai`)

### Ingestion

- Python 3
- pandas
- requests
- pymongo
- sentence-transformers
- torch

---

## Prerequisites

Install and configure:

- Node.js
- npm
- Python 3
- pip
- MongoDB Atlas with vector search enabled
- API keys for:
  - Hugging Face inference
  - Google Gemini

---

## Environment Variables

### Backend

The backend validates these main variables at startup:

- `MONGODB_URI`
- `DB_NAME`
- `COLLECTION_NAME`
- `VECTOR_INDEX_NAME`
- `GTFS_RT_URL`
- `HUGGINGFACE_API_KEY`
- `GEMINI_API_KEY`

The backend also uses:

- `PORT` (optional)

Environment file examples:

- `backend/.env.example`

### Python Ingestion

The ingestion pipeline requires similar database and more:

- `MONGODB_URI`
- `DB_NAME`
- `COLLECTION_NAME`
- `GTFS_STATIC_URL`
- `EMBEDDING_MODEL`
- `EMBEDDING_DIMENSION`
- `CHUNK_SIZE`
- `CHUNK_OVERLAP`

Environment file examples:

- `python_ingestion/.env.example`

---

## Installation

### Backend

```bash
cd backend
npm install
```

### Python Ingestion

```bash
cd python_ingestion
pip install -r requirements.txt
```

---

## Running The System

### 1. Run ingestion

This builds the static knowledge base in MongoDB.

```bash
cd python_ingestion
python main.py
```

What it does:

- downloads GTFS static zip
- retries GTFS download on transient failures with a bounded timeout/backoff policy
- processes stops, routes, and trip patterns
- generates embeddings
- inserts documents into the stable live collection with `metadata.ingestion_version`
- creates indexes
- validates the new ingestion version counts
- copies previous live documents into a single backup collection
- removes outdated live documents from the live collection in place
- prints collection stats and step-duration logs

Operational notes:

- the script exits with code `0` on success and `1` on failure
- the live collection name stays stable so the Atlas Vector Search index remains attached
- the current backup collection is `<COLLECTION_NAME>_backup`

### 2. Start backend

```bash
cd backend
npm run dev
```

Production-style run:

```bash
cd backend
npm start
```

By default the backend uses:

- `PORT=8000` if no `PORT` is provided

---

## API Endpoints

### `GET /`

Basic root endpoint.

### `GET /health`

Liveness endpoint.

Expected response includes:

- `status`
- `service`
- `uptimeSec`
- `startedAt`

### `GET /ready`

Readiness endpoint.

Checks:

- environment validated
- MongoDB connected
- stop metadata loaded

### `GET /health/realtime`

Realtime diagnostic endpoint.

Reports whether GTFS realtime is reachable and includes simple feed counts.

### `POST /api/query/search`

Main query endpoint.

Request body:

```json
{
  "queryText": "Which trains stop at Pasila?"
}
```

Response shape includes:

```json
{
  "query": "Which trains stop at Pasila?",
  "intent": "stop",
  "answer": {
    "answer": "string",
    "static_context_used": [],
    "realtime_context_used": [],
    "related_routes": [],
    "related_train_numbers_or_groups": [],
    "confidence": "high",
    "notes": "string"
  }
}
```

---

## Query Types

The backend currently supports these main query classes:

- exact train queries
  - example: `Is train IC 45 delayed?`
- train family / group queries
  - example: `What trains run on the Z line?`
- route queries
  - example: `What is the route from Helsinki to Rovaniemi?`
- stop queries
  - example: `Which trains stop at Pasila?`

Realtime is only fetched when the query wording suggests that live status is needed, such as:

- `delay`
- `late`
- `now`
- `currently`
- `status`
- `live`
- `on time`

---

## Testing

### Backend Tests

```bash
cd backend
npm test
```

Note:

- the backend uses Node's built-in test command in `package.json`
- current implemented backend coverage is high-level but meaningful:
  - intent-detection unit tests
  - retriever, embedding, LLM, and GTFS-RT component tests
  - API tests for readiness, success, validation, timeout, and internal-error paths
  - one route-query integration slice through the request flow

### Python Tests

From the repository root:

```bash
pytest
```

Run by marker:

```bash
pytest -m gtfsDownloadAndExtract
pytest -m gtfsProcess
pytest -m dbConnection
```

Relevant test files:

- `python_ingestion/tests/test_gtfs_processor.py`
- `python_ingestion/tests/test_main_helpers.py`
- `python_ingestion/tests/test_mongodb_client.py`
- `python_ingestion/tests/test_ingestion_e2e.py`

Notes:

- current implemented Python coverage includes:
  - GTFS download and retry behavior
  - GTFS helper normalization and document generation
  - `main.py` helper logic for validation and backup cleanup
  - MongoDB client conversion and collection utility behavior
  - one full ingestion refresh workflow with stubbed dependencies
- the `python_ingestion/requirements.txt` now contains the direct runtime and remaining test dependencies only

More detail:

- `docs/current-test-coverage.md`
- `docs/test-executing-plan.md`

---

## Suggested Local Validation

After ingestion and backend startup, verify:

1. `GET /health`
2. `GET /ready`
3. `GET /health/realtime`
4. `POST /api/query/search` with:
   - `Which trains stop at Pasila?`
   - `What is the route from Helsinki to Rovaniemi?`
   - `Is train IC 45 delayed?`

Expected behavior:

- health returns `200`
- ready returns `200` only after startup completes
- query endpoint returns `200` with structured JSON
- invalid query bodies return `400`

---
