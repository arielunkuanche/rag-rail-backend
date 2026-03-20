import os
from dotenv import load_dotenv

load_dotenv()

# MongoDB Configuration
MONGODB_URI = os.getenv('MONGODB_URI')
DATABASE_NAME = os.getenv('DB_NAME')
COLLECTION_NAME = os.getenv('COLLECTION_NAME')
VECTOR_INDEX_NAME = os.getenv('VECTOR_INDEX_NAME')

# GTFS Data Sources
GTFS_STATIC_URL = os.getenv('GTFS_STATIC_URL')

# Embedding Model
EMBEDDING_MODEL = os.getenv('EMBEDDING_MODEL')
# EMBEDDING_MODEL = 'intfloat/multilingual-e5-small'
# EMBEDDING_MODEL = 'all-MiniLM-L6-v2'
# EMBEDDING_MODEL = 'multi-qa-MiniLM-L6-cos-v1'
EMBEDDING_DIMENSION = int(os.getenv('EMBEDDING_DIMENSION'))

# Chunking Configuration
CHUNK_SIZE = int(os.getenv('CHUNK_SIZE'))
CHUNK_OVERLAP = int(os.getenv('CHUNK_OVERLAP'))