import pytest
from python_ingestion.gtfs_processor import GTFSProcessor
from python_ingestion.mongodb_client import MongoDBClient
import python_ingestion.config as config

@pytest.mark.gtfsDownloadAndExtract
def test_gtfs_download_and_extract():
    """Verify GTFS zip download and extraction."""
    processor = GTFSProcessor(config.GTFS_STATIC_URL)
    data = processor.download_and_extract()

    assert data, "No data returned from extraction"

    assert "stops" in data and len(data["stops"]) > 0, "Stops table missing or empty"
    assert "routes" in data and len(data["routes"]) > 0, "Routes table missing or empty"
    print("GTFS data extracted successfully.")

@pytest.mark.gtfsProcess
def test_process_documents():
    """Validate GTFS document generation."""
    processor = GTFSProcessor(config.GTFS_STATIC_URL)
    processor.download_and_extract()
    docs = processor.process_all()

    assert isinstance(docs, list) and len(docs) > 0, "No processed documents generated"
    print(f"✓ Processed {len(docs)} GTFS documents successfully.")

@pytest.mark.dbConnection
def test_mongodb_connection():
    """Ensure MongoDB connection and collection stats retrieval."""
    mongo_client = MongoDBClient(config.MONGODB_URI, config.DATABASE_NAME, config.COLLECTION_NAME)
    stats = mongo_client.get_stats()

    assert isinstance(stats, dict) and "total_documents" in stats, "Invalid MongoDB stats format"
    print(f"MongoDB connection successful. Collection counts: {stats}")
