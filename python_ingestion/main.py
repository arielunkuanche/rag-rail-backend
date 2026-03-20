import sys
from datetime import datetime
import time
from config import EMBEDDING_MODEL, MONGODB_URI, DATABASE_NAME, COLLECTION_NAME, GTFS_STATIC_URL
from gtfs_processor import GTFSProcessor
from gtfs_embedding import EmbeddingGenerator
from mongodb_client import MongoDBClient
import traceback

def validate_staging_stats(stats):
    """Validate that staging collection has the expected document categories before promotion."""
    required_positive_counts = ("total_documents", "stops", "routes", "trips")
    missing_counts = [key for key in required_positive_counts if stats.get(key, 0) <= 0]
    if missing_counts:
        raise ValueError(f"Staging validation failed. Missing positive counts for: {', '.join(missing_counts)}")

def cleanup_old_backups(mongo_client, current_backup_collection_name):
    """Clear any backup collections except the stable current backup collection."""
    backup_prefix = f"{COLLECTION_NAME}_backup"
    backup_collections = mongo_client.list_collections(prefix=backup_prefix)
    removed_backups = []

    for collection_name in backup_collections:
        if collection_name != current_backup_collection_name:
            mongo_client.drop_collection(collection_name)
            removed_backups.append(collection_name)

    return removed_backups

def print_step_duration(label, step_started_at):
    """Print a stable step duration log line in seconds."""
    print(f"-> ✅ {label} completed in {time.time() - step_started_at:.2f} s")

def main():
    mongo_client = None
    started_at = datetime.now()
    print("=" * 60)
    print("Python Data Ingestion Pipeline")
    print("=" * 60)
    print(f"Started at: {started_at.isoformat()}")
    print()
    
    try:
        # Initialize components
        print("Step 1: Initializing components...")
        init_started_at = time.time()
        gtfs_processor = GTFSProcessor(GTFS_STATIC_URL)
        embedding_generator = EmbeddingGenerator(EMBEDDING_MODEL)
        mongo_client = MongoDBClient(
            MONGODB_URI,
            DATABASE_NAME,
            COLLECTION_NAME
        )
        ingestion_version = datetime.now().strftime("%Y%m%d%H%M%S")
        backup_collection_name = f"{COLLECTION_NAME}_backup"
        print_step_duration("Initialization", init_started_at)
        
        print()
        
        # Process GTFS data
        print("Step 2: Processing GTFS data...")
        processing_started_at = time.time()
        documents = gtfs_processor.process_all()
        print(f"Processed {len(documents)} documents")
        print_step_duration("GTFS data processing", processing_started_at)
        print()
        
        # Generate embeddings
        print("Step 3: Generating embeddings...")
        # texts = [doc['text'] for doc in documents]
        embedding_started_at = time.time()
        embeddings = embedding_generator.generate_embedding_batch(documents)

        print(f"Generated {len(embeddings)} embeddings")
        print_step_duration("Embedding pipeline", embedding_started_at)
        print()
        
        # Store in MongoDB
        print("Step 4: Storing in MongoDB...")
        storage_started_at = time.time()
        mongo_client.insert_documents(documents, ingestion_version=ingestion_version)
        mongo_client.create_indexes()
        print_step_duration("Mongo live storage", storage_started_at)
        
        print()
        
        # Print statistics
        print("Step 5: Current ingestion version statistics")
        stats_started_at = time.time()
        current_version_filter = {'metadata.ingestion_version': ingestion_version}
        stats = mongo_client.get_stats(filter_query=current_version_filter)
        validate_staging_stats(stats)
        for key, value in stats.items():
            print(f" -> {key}: {value}")
        print_step_duration("Current version validation", stats_started_at)

        print()
        print("Step 6: Refresh live collection to replace outdated data")
        promotion_started_at = time.time()
        removed_backups = []
        deleted_old_documents = 0
        old_version_filter = {'metadata.ingestion_version': {'$ne': ingestion_version}}
        try:
            removed_backups = cleanup_old_backups(mongo_client, backup_collection_name)
            previous_live_docs = mongo_client.find_documents(old_version_filter)
            if previous_live_docs:
                mongo_client.clear_collection(collection_name=backup_collection_name)
                mongo_client.insert_documents(previous_live_docs, collection_name=backup_collection_name)
                print(f"-> ℹ Previous live documents preserved in {backup_collection_name}")

            deleted_old_documents = mongo_client.delete_documents(old_version_filter)
            print(f"-> ✅ Live collection refreshed in place for ingestion version {ingestion_version}")
        except Exception:
            mongo_client.delete_documents({'metadata.ingestion_version': ingestion_version})
            raise
        print_step_duration("Collection promotion", promotion_started_at)
        
        print()
        print("=" * 60)
        print("Data ingestion completed successfully!")
        finished_at = datetime.now()
        print(f"Finished at: {finished_at.isoformat()}")
        print(f"Duration sec: {(finished_at - started_at).total_seconds():.2f}")
        print(f"Live collection: {COLLECTION_NAME}")
        print(f"Ingestion version: {ingestion_version}")
        print(f"Backup collection kept: {backup_collection_name}")
        print(f"Old live documents removed: {deleted_old_documents}")
        print(f"Older backups removed: {removed_backups if removed_backups else []}")
        print("=" * 60)
        print()
        print("Next step:")
        print("Test and Create a Vector Search index in MongoDB Atlas")
        return 0

    except Exception as e:
        print("Ingestion pipeline failed due to: ", e)
        traceback.print_exc()
        return 1
    finally:
        if mongo_client:
            mongo_client.close()

if __name__ == "__main__":
    sys.exit(main())