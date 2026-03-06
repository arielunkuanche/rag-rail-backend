import os
from pymongo import MongoClient, UpdateOne
from typing import List, Dict
from datetime import datetime
from bson.son import SON
import numpy as np

class MongoDBClient: 
    def __init__(self, uri: str, database_name: str, collection_name: str):
        """Initialize MongoDB Client"""
        if not uri:
            print("Error: MONGODB URI is not set, failed to connect to DB ...")
            return False
        
        print(f"Connecting to DB ... ")
        self.client = MongoClient(
                uri,
                connectTimeoutMS=120000,
                socketTimeoutMS=120000,
                maxPoolSize=5,
        )
        self.db = self.client[database_name]
        self.collection = self.db[collection_name]
        print(f" -> ✅ Connected to database: {database_name}, collection: {collection_name}")
    
    def _convert_to_bson_safe(self, item):
        """
        Recursively converts NumPy, Pandas, and other non-serializable types into BSON-safe native Python types.
        Prevents recursion depth or serialization errors when insert to Atlas.
        """
        # Handle dictionaries
        if isinstance(item, dict):
            return {str(k): self._convert_to_bson_safe(v) for k, v in item.items()}

        # Handle lists or tuples
        elif isinstance(item, (list, tuple)):
            return [self._convert_to_bson_safe(v) for v in item]

        # Handle NumPy arrays or tensors
        elif isinstance(item, np.ndarray):
            return [self._convert_to_bson_safe(v) for v in item.tolist()]

        # Handle NumPy scalar types
        elif isinstance(item, (np.integer, np.floating)):
            return item.item()

        # Handle datetime objects (BSON supports them natively)
        elif hasattr(item, "isoformat") and callable(item.isoformat):
            return item

        # Handle all other simple types
        return item
    

    def insert_documents(self, documents: List[Dict], batch_size: int = 5000):
        """Insert documents with embeddings in batches."""
        total = len(documents)
        print(f"7. Store in Atlas: Inserting {total} documents in baches of {batch_size} size each... ")
        
        try:
            for i in range(0, total, batch_size):
                    # Apply the safety conversion before inserting the batch
                    batch = documents[i:i + batch_size]
                    sanitized_batch = [self._convert_to_bson_safe(doc) for doc in batch]
                    # batch = documents[i:i + batch_size]
                    print(f"   -> Inserting batch {i//batch_size + 1} of documents {i} to {i + len(batch)}...")
                    
                    self.collection.insert_many(sanitized_batch) 
                    
                    print(f"   -> Batch {i//batch_size + 1} inserted successfully.")
                    
            print(f"✅ Store in Atlas: Successfully inserted {total} documents.")
        
        except Exception as e: 
            print(f"Error storing data in MongoDB Atlas: {e}")
            return False

    def upsert_documents(self, documents: List[Dict], id_field: str = 'metadata.stop_id'):
        """Upsert documents to avoid duplicates."""
        operations = []

        for doc in documents:
            # Extract id from metadata
            id_parts = id_field.split('.')
            filter_value = doc
            for part in id_parts:
                filter_value = filter_value.get(part, '')

            filter_dict = {id_field: filter_value}
            operations.append(
                UpdateOne(
                    filter_dict,
                    {'$set': doc},
                    upsert=True
                )
            )
        
        if operations:
            result = self.collection.bulk_write(operations)
            print(f" -> ✅ Upserted {result.upserted_count} documents, modified {result.modified_count}")
        
    
    def clear_collection(self):
        """Clear all documents from collection."""
        result = self.collection.delete_many({})
        print(f"-> ✅ Deleted {result.deleted_count} documents")

    def create_indexes(self):
        """Create indexes for better query performance."""
        self.collection.create_index([('metadata.type', 1)])
        self.collection.create_index([('metadata.stop_id', 1)])
        self.collection.create_index([('metadata.route_id', 1)])
        self.collection.create_index([('metadata.trip_id', 1)])
        print("\n-> ✅ 8. Indexes created successfully")

    def get_stats(self) -> Dict:
        """Get collection statistics."""
        stats = {
            'total_documents': self.collection.count_documents({}),
            'stops': self.collection.count_documents({'metadata.type': 'stop'}),
            'routes': self.collection.count_documents({'metadata.type': 'route'}),
            'trips': self.collection.count_documents({'metadata.type': 'trip_pattern'})
        }

        return stats
    
    def close(self):
        """Close MongoDB connection."""
        self.client.close()
        print("-> ✅ MongoDB connection closed")