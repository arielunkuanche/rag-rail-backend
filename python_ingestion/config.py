import os
from dotenv import load_dotenv

load_dotenv()

# MongoDB Configuration
MONGODB_URI = os.getenv('MONGODB_URI')
DATABASE_NAME = 'finnish_railway_rag'
COLLECTION_NAME = 'testing'
VECTOR_INDEX_NAME = 'gtfs_testSearch'

# GTFS Data Sources
GTFS_STATIC_URL = 'https://rata.digitraffic.fi/api/v1/trains/gtfs-passenger-stops.zip'
GTFS_RT_URL = 'https://rata.digitraffic.fi/api/v1/trains/gtfs-rt-updates'

# Embedding Model
EMBEDDING_MODEL = 'paraphrase-multilingual-MiniLM-L12-v2'
# EMBEDDING_MODEL = 'all-MiniLM-L6-v2'
# EMBEDDING_MODEL = 'multi-qa-MiniLM-L6-cos-v1'
EMBEDDING_DIMENSION = 384

# Chunking Configuration
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50