from pymongo import MongoClient
from sentence_transformers import SentenceTransformer
from python_ingestion.config import MONGODB_URI, DATABASE_NAME, COLLECTION_NAME, EMBEDDING_MODEL, VECTOR_INDEX_NAME

class VectorSearchClient:
    def __init__(self, uri=MONGODB_URI, db_name=DATABASE_NAME, collection_name=COLLECTION_NAME, embedding_model=EMBEDDING_MODEL):
        """Initialize MongoDB connection and embedding model once."""
        self.client = MongoClient(uri)
        self.db = self.client[db_name]
        self.collection = self.db[collection_name]
        self.model = SentenceTransformer(embedding_model)

    def vector_search(self, query_text: str, top_k=5):
        """Performs a vector search test for MongoDB Atlas Vector Search Index"""

        #1. Generate query vector
        model = SentenceTransformer(EMBEDDING_MODEL)
        query_vector = self.model.encode(query_text, convert_to_tensor=False).tolist()

        #2. Define Vector Search Pipeline
        pipeline = [
            {
                '$vectorSearch': {
                    'queryVector': query_vector,
                    'path': 'embedding',
                    'numCandidates': top_k * 20,
                    'limit': top_k,
                    'index': VECTOR_INDEX_NAME,
                }
            },
            {
                '$project': {
                    'text': 1,
                    "metadata": 1,
                    'score': { '$meta': 'vectorSearchScore' }
                }
            }
        ]
        
        try:
            #3. Execute the query
            results = list(self.collection.aggregate(pipeline))
            print(f"\n✅ Successfully retrieved {len(results)} documents for '{query_text}'.\n")

            return results
        
        except Exception as e:
            print(f"Error during vector search test: {e}")
            return None

    def close(self):
        """Close MongoDB collection"""
        self.client.close()