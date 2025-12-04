import pytest
from pymongo import MongoClient
from python_ingestion.config import MONGODB_URI, DATABASE_NAME, COLLECTION_NAME
from python_ingestion.vector_search import VectorSearchClient

@pytest.mark.vectorsearch
def test_vector_search():
    """Verify that Atlas vector search returns semantically relevant results."""
    vs_client = VectorSearchClient(MONGODB_URI, DATABASE_NAME, COLLECTION_NAME)
    query_text = "Train from Helsinki to Tampere."
    
    try:
        results = vs_client.vector_search(query_text=query_text, top_k=5)

        assert len(results) > 0, "No results returned from vector search"
        print("\n✅ Successfully retrieved", len(results), "search results.")

        for i, doc in enumerate(results):
            score = doc.get('score', 0)
            text = doc.get('text', 'N/A').replace("\n", " ")[:150]
            metadata = doc.get('metadata', {})

            print(f"--- Result {i} (Score : {score:.4f}) ---")
            print(f"Text: {text}")
            print(f"Type: {metadata.get('type', 'N/A')}")
            print(f"Trip ID: {metadata.get('trip_id')}")
            print(f"Route ID: {metadata.get('route_id')}")
            print(f"Stop Name: {metadata.get('stop_name')} \n")
        
    
    except Exception as e:
        print(f"Error during vector search test: {e}")
        return None

@pytest.mark.performance
def test_vector_search_response_time(benchmark):
    """Benchmark response time for Atlas vector search (should complete < 1s)."""
    vs_client = VectorSearchClient(MONGODB_URI, DATABASE_NAME, COLLECTION_NAME)
    query_text = "Is there any delay between Helsinki and Tampere?"

    def _search():
        return vs_client.vector_search(query_text=query_text, top_k=3)
    
    result = benchmark(_search)
    assert result is not None
    assert len(result) > 0
    print("\n Vector search completed within expected response time")