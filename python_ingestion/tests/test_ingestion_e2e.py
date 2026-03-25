import copy
import importlib.util
import sys
from pathlib import Path
from types import ModuleType
import pytest


MAIN_MODULE_PATH = Path(__file__).resolve().parents[1] / 'main.py'


def load_main_module_for_ingestion_e2e():
    module_name = 'test_python_ingestion_main_e2e'
    original_modules = {
        name: sys.modules.get(name)
        for name in ('config', 'gtfs_processor', 'gtfs_embedding', 'mongodb_client')
    }

    source_documents = [
        {
            'text': 'Stop: Helsinki',
            'metadata': {'type': 'stop', 'stop_id': '100'}
        },
        {
            'text': 'Route R1: Helsinki - Oulu',
            'metadata': {'type': 'route', 'route_id': 'R1'}
        },
        {
            'text': 'TRAIN PATTERN: Train IC265 on Route R1.',
            'metadata': {'type': 'trip_pattern', 'trip_id': 'TRIP-1'}
        }
    ]

    class FakeGTFSProcessor:
        def __init__(self, gtfs_url):
            self.gtfs_url = gtfs_url

        def process_all(self):
            return copy.deepcopy(source_documents)

    class FakeEmbeddingGenerator:
        def __init__(self, model_name):
            self.model_name = model_name

        def generate_embedding_batch(self, documents):
            return [[0.1, 0.2, 0.3] for _ in documents]

    class FakeMongoDBClient:
        last_instance = None

        def __init__(self, uri, database_name, collection_name):
            self.uri = uri
            self.database_name = database_name
            self.collection_name = collection_name
            self.closed = False
            self.indexes_created = 0
            self.dropped_collections = []
            self.cleared_collections = []
            self.insert_calls = []
            self.deleted_filters = []
            self.collections = {
                collection_name: [
                    {
                        'text': 'Old stop doc',
                        'metadata': {
                            'type': 'stop',
                            'stop_id': 'OLD-1',
                            'ingestion_version': '20260320050000'
                        }
                    },
                    {
                        'text': 'Older route doc',
                        'metadata': {
                            'type': 'route',
                            'route_id': 'OLD-R1',
                            'ingestion_version': '20260319050000'
                        }
                    }
                ],
                f'{collection_name}_backup': [
                    {
                        'text': 'Previous backup doc',
                        'metadata': {'type': 'stop', 'ingestion_version': '20260318050000'}
                    }
                ]
            }
            FakeMongoDBClient.last_instance = self

        def _matches_filter(self, document, filter_query):
            if not filter_query:
                return True

            for key, expected in filter_query.items():
                current_value = document
                for part in key.split('.'):
                    current_value = current_value.get(part)

                if isinstance(expected, dict) and '$ne' in expected:
                    if current_value == expected['$ne']:
                        return False
                elif current_value != expected:
                    return False

            return True

        def insert_documents(self, documents, batch_size=5000, collection_name=None, ingestion_version=None):
            target_name = collection_name or self.collection_name
            stored_documents = copy.deepcopy(documents)

            if ingestion_version:
                for document in stored_documents:
                    metadata = document.setdefault('metadata', {})
                    metadata['ingestion_version'] = ingestion_version

            self.collections.setdefault(target_name, []).extend(stored_documents)
            self.insert_calls.append({
                'collection_name': target_name,
                'ingestion_version': ingestion_version,
                'count': len(stored_documents)
            })

        def create_indexes(self):
            self.indexes_created += 1

        def get_stats(self, collection_name=None, filter_query=None):
            target_name = collection_name or self.collection_name
            documents = [
                document
                for document in self.collections.get(target_name, [])
                if self._matches_filter(document, filter_query or {})
            ]

            return {
                'total_documents': len(documents),
                'stops': sum(document['metadata'].get('type') == 'stop' for document in documents),
                'routes': sum(document['metadata'].get('type') == 'route' for document in documents),
                'trips': sum(document['metadata'].get('type') == 'trip_pattern' for document in documents)
            }

        def list_collections(self, prefix=None):
            collection_names = sorted(self.collections.keys())
            if prefix:
                return [name for name in collection_names if name.startswith(prefix)]
            return collection_names

        def drop_collection(self, collection_name):
            self.collections.pop(collection_name, None)
            self.dropped_collections.append(collection_name)

        def find_documents(self, filter_query, collection_name=None):
            target_name = collection_name or self.collection_name
            return [
                copy.deepcopy(document)
                for document in self.collections.get(target_name, [])
                if self._matches_filter(document, filter_query)
            ]

        def clear_collection(self, collection_name=None):
            target_name = collection_name or self.collection_name
            self.collections[target_name] = []
            self.cleared_collections.append(target_name)

        def delete_documents(self, filter_query, collection_name=None):
            target_name = collection_name or self.collection_name
            documents = self.collections.get(target_name, [])
            kept_documents = [
                document for document in documents
                if not self._matches_filter(document, filter_query)
            ]
            deleted_count = len(documents) - len(kept_documents)
            self.collections[target_name] = kept_documents
            self.deleted_filters.append({
                'collection_name': target_name,
                'filter_query': filter_query,
                'deleted_count': deleted_count
            })
            return deleted_count

        def close(self):
            self.closed = True

    config_module = ModuleType('config')
    config_module.EMBEDDING_MODEL = 'test-model'
    config_module.MONGODB_URI = 'mongodb://example.test'
    config_module.DATABASE_NAME = 'test-db'
    config_module.COLLECTION_NAME = 'test-collection'
    config_module.GTFS_STATIC_URL = 'https://example.test/gtfs.zip'

    gtfs_processor_module = ModuleType('gtfs_processor')
    gtfs_processor_module.GTFSProcessor = FakeGTFSProcessor

    gtfs_embedding_module = ModuleType('gtfs_embedding')
    gtfs_embedding_module.EmbeddingGenerator = FakeEmbeddingGenerator

    mongodb_client_module = ModuleType('mongodb_client')
    mongodb_client_module.MongoDBClient = FakeMongoDBClient

    sys.modules['config'] = config_module
    sys.modules['gtfs_processor'] = gtfs_processor_module
    sys.modules['gtfs_embedding'] = gtfs_embedding_module
    sys.modules['mongodb_client'] = mongodb_client_module

    spec = importlib.util.spec_from_file_location(module_name, MAIN_MODULE_PATH)
    module = importlib.util.module_from_spec(spec)

    try:
        spec.loader.exec_module(module)
        return module, FakeMongoDBClient
    finally:
        sys.modules.pop(module_name, None)

        for name, original_module in original_modules.items():
            if original_module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original_module


@pytest.mark.dbConnection
def test_main_refresh_flow_returns_zero_and_preserves_backup_while_replacing_old_live_documents():
    main_module, fake_mongo_client_class = load_main_module_for_ingestion_e2e()

    result = main_module.main()
    mongo_client = fake_mongo_client_class.last_instance

    assert result == 0
    assert mongo_client.indexes_created == 1
    assert mongo_client.closed is True

    live_documents = mongo_client.collections['test-collection']
    backup_documents = mongo_client.collections['test-collection_backup']

    assert len(live_documents) == 3
    assert {document['metadata']['type'] for document in live_documents} == {'stop', 'route', 'trip_pattern'}
    assert len({document['metadata']['ingestion_version'] for document in live_documents}) == 1

    assert len(backup_documents) == 2
    assert {
        document['metadata']['ingestion_version'] for document in backup_documents
    } == {'20260320050000', '20260319050000'}

    assert set(mongo_client.collections.keys()) == {'test-collection', 'test-collection_backup'}
    assert mongo_client.dropped_collections == []
    assert mongo_client.cleared_collections == ['test-collection_backup']
    assert mongo_client.insert_calls[0]['collection_name'] == 'test-collection'
    assert mongo_client.insert_calls[0]['count'] == 3
    assert mongo_client.insert_calls[0]['ingestion_version'] is not None
    assert mongo_client.insert_calls[1] == {
        'collection_name': 'test-collection_backup',
        'ingestion_version': None,
        'count': 2
    }
    assert mongo_client.deleted_filters == [
        {
            'collection_name': 'test-collection',
            'filter_query': {
                'metadata.ingestion_version': {
                    '$ne': mongo_client.insert_calls[0]['ingestion_version']
                }
            },
            'deleted_count': 2
        }
    ]
