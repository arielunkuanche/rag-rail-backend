from pymongo import MongoClient
from typing import List, Dict
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
        self.collection_name = collection_name
        print(f" -> ✅ Connected to database: {database_name}, collection: {collection_name}")

    def get_collection(self, collection_name: str = None):
        """Return a Mongo collection handle for the active or provided collection name."""
        target_name = collection_name or self.collection_name
        return self.db[target_name]
    
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
    

    def insert_documents(
        self,
        documents: List[Dict],
        batch_size: int = 5000,
        collection_name: str = None,
        ingestion_version: str = None
    ):
        """Insert documents with embeddings in batches adding a new metadata.ingestion_version."""
        collection = self.get_collection(collection_name)
        target_name = collection_name or self.collection_name
        total = len(documents)
        print(f"7. Store in Atlas: Inserting {total} documents into {target_name} in baches of {batch_size} size each... ")
        
        try:
            for i in range(0, total, batch_size):
                    # Apply the safety conversion before inserting the batch
                    batch = documents[i:i + batch_size]
                    if ingestion_version:
                        for doc in batch:
                            metadata = doc.setdefault('metadata', {})
                            metadata['ingestion_version'] = ingestion_version
                    sanitized_batch = [self._convert_to_bson_safe(doc) for doc in batch]
                    # batch = documents[i:i + batch_size]
                    print(f"   -> Inserting batch {i//batch_size + 1} of documents {i} to {i + len(batch)}...")
                    
                    collection.insert_many(sanitized_batch) 
                    
                    print(f"   -> Batch {i//batch_size + 1} inserted successfully.")
                    
            print(f"✅ Store in Atlas: Successfully inserted {total} documents.")
        
        except Exception as e: 
            error_message = f"Error storing data in MongoDB Atlas collection {target_name}: {e}"
            print(error_message)
            raise RuntimeError(error_message) from e

    def clear_collection(self, collection_name: str = None):
        """Clear all documents from collection."""
        collection = self.get_collection(collection_name)
        target_name = collection_name or self.collection_name
        result = collection.delete_many({})
        print(f"-> ✅ Deleted {result.deleted_count} documents from {target_name}")

    def create_indexes(self, collection_name: str = None):
        """Create indexes for better query performance."""
        collection = self.get_collection(collection_name)
        target_name = collection_name or self.collection_name
        collection.create_index([('metadata.type', 1)])
        collection.create_index([('metadata.stop_id', 1)])
        collection.create_index([('metadata.route_id', 1)])
        collection.create_index([('metadata.trip_id', 1)])
        print(f"\n8. Indexes created successfully on {target_name}")

    def get_stats(self, collection_name: str = None, filter_query: Dict = None) -> Dict:
        """Get collection statistics."""
        collection = self.get_collection(collection_name)
        base_filter = filter_query or {}
        stats = {
            'total_documents': collection.count_documents(base_filter),
            'stops': collection.count_documents({**base_filter, 'metadata.type': 'stop'}),
            'routes': collection.count_documents({**base_filter, 'metadata.type': 'route'}),
            'trips': collection.count_documents({**base_filter, 'metadata.type': 'trip_pattern'})
        }

        return stats

    def find_documents(self, filter_query: Dict, collection_name: str = None) -> List[Dict]:
        """Find documents matching a filter."""
        collection = self.get_collection(collection_name)
        return list(collection.find(filter_query))

    def delete_documents(self, filter_query: Dict, collection_name: str = None):
        """Delete documents matching a filter."""
        collection = self.get_collection(collection_name)
        result = collection.delete_many(filter_query)
        print(f"-> ✅ Deleted {result.deleted_count} documents matching filter from {collection.name}")
        return result.deleted_count

    def collection_exists(self, collection_name: str) -> bool:
        """Check whether a collection exists in the target database."""
        return collection_name in self.db.list_collection_names()

    def list_collections(self, prefix: str = None) -> List[str]:
        """List collections in the database, optionally filtered by prefix."""
        collection_names = self.db.list_collection_names()
        if prefix:
            return sorted([name for name in collection_names if name.startswith(prefix)])
        return sorted(collection_names)

    def drop_collection(self, collection_name: str):
        """Drop a collection if it exists."""
        if self.collection_exists(collection_name):
            self.db.drop_collection(collection_name)
            print(f"-> ✅ Dropped collection {collection_name}")

    def rename_collection(self, from_collection_name: str, to_collection_name: str, drop_target: bool = False):
        """Rename a collection inside the same database."""
        source_collection = self.get_collection(from_collection_name)
        source_collection.rename(to_collection_name, dropTarget=drop_target)
        print(f"-> ✅ Renamed collection {from_collection_name} to {to_collection_name}")
    
    def close(self):
        """Close MongoDB connection."""
        self.client.close()
        print("-> ✅ MongoDB connection closed")
