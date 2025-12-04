import os
from datetime import datetime
from config import EMBEDDING_MODEL, MONGODB_URI, DATABASE_NAME, COLLECTION_NAME, GTFS_STATIC_URL, GTFS_RT_URL
from gtfs_processor import GTFSProcessor
from gtfs_embedding import EmbeddingGenerator
from mongodb_client import MongoDBClient
from gtfs_realtime import GTFSRealtimeClient
import traceback


class main():
    print("=" * 60)
    print("Python Data Ingestion Pipeline")
    print("=" * 60)
    print(f"Started at: {datetime.now().isoformat()}")
    print()
    
    try:
        # Initialize components
        print("Step 1: Initializing components...")
        gtfs_processor = GTFSProcessor(GTFS_STATIC_URL)
        embedding_generator = EmbeddingGenerator(EMBEDDING_MODEL)
        mongo_client = MongoDBClient(
            MONGODB_URI,
            DATABASE_NAME,
            COLLECTION_NAME
        )
        
        print()
        
        # Process GTFS data
        print("Step 2: Processing GTFS data...")
        documents = gtfs_processor.process_all()
        print(f"Processed {len(documents)} documents")
        print()
        
        # Generate embeddings
        print("Step 3: Generating embeddings...")
        # texts = [doc['text'] for doc in documents]
        embeddings = embedding_generator.generate_embedding_batch(documents)

        print(f"Generated {len(embeddings)} embeddings")
        print()
        
        # Store in MongoDB
        print("Step 4: Storing in MongoDB...")
        mongo_client.clear_collection()
        
        mongo_client.insert_documents(documents)
        mongo_client.create_indexes()
        
        print()
        
        # Print statistics
        print("Step 5: Collection statistics")
        stats = mongo_client.get_stats()
        for key, value in stats.items():
            print(f"  {key}: {value}")
        
        print()
        print("=" * 60)
        print("Data ingestion completed successfully!")
        print(f"Finished at: {datetime.now().isoformat()}")
        print("=" * 60)
        print()
        print("Next step:")
        print("Test and Create a Vector Search index in MongoDB Atlas")
        
        # Close connections
        mongo_client.close()

        print("Step 6: Fetch GTFS Realtime feeds")
        rt_client = GTFSRealtimeClient(GTFS_RT_URL)
        rt_updates = rt_client.get_all_updates()

        print(f"Timestamp: {rt_updates['timestamp']}")
        print(f"Trip updates: {len(rt_updates['trip_updates'])}")
        print(f"Vehicle positions: {len(rt_updates['vehicle_positions'])}")
        print(f"Alerts: {len(rt_updates['alerts'])}")

    except Exception as e:
        print("Ingestion pipeline failed due to: ", e)
        traceback.print_exc()

if __name__ == "__main__":
    main()