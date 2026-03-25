from datetime import datetime
import numpy as np
import pytest

from python_ingestion.mongodb_client import MongoDBClient


def build_mongodb_client_without_init():
    return MongoDBClient.__new__(MongoDBClient)


@pytest.mark.dbConnection
def test_convert_to_bson_safe_handles_nested_dicts_lists_numpy_arrays_and_scalars():
    mongo_client = build_mongodb_client_without_init()
    payload = {
        'embedding': np.array([1.5, 2.5], dtype=np.float32),
        'metadata': {
            'count': np.int64(3),
            'score': np.float64(9.25),
            'flags': [np.int32(1), np.float32(2.5)]
        }
    }

    converted = mongo_client._convert_to_bson_safe(payload)

    assert converted == {
        'embedding': [1.5, 2.5],
        'metadata': {
            'count': 3,
            'score': 9.25,
            'flags': [1, 2.5]
        }
    }


@pytest.mark.dbConnection
def test_convert_to_bson_safe_preserves_datetime_and_tuple_structure_as_bson_safe_values():
    mongo_client = build_mongodb_client_without_init()
    timestamp = datetime(2026, 3, 21, 5, 0, 0)

    converted = mongo_client._convert_to_bson_safe({
        'updated_at': timestamp,
        'stops': ('Helsinki', 'Pasila'),
        'nested': [np.array([1, 2]), {'delay_minutes': np.int64(4)}]
    })

    assert converted['updated_at'] is timestamp
    assert converted['stops'] == ['Helsinki', 'Pasila']
    assert converted['nested'] == [[1, 2], {'delay_minutes': 4}]


@pytest.mark.dbConnection
def test_insert_documents_batches_documents_and_injects_ingestion_version():
    class FakeCollection:
        def __init__(self):
            self.inserted_batches = []

        def insert_many(self, documents):
            self.inserted_batches.append(documents)

    fake_collection = FakeCollection()
    mongo_client = build_mongodb_client_without_init()
    mongo_client.collection_name = 'live_collection'
    mongo_client.get_collection = lambda collection_name=None: fake_collection

    documents = [
        {
            'text': 'doc-1',
            'metadata': {'type': 'stop'}
        },
        {
            'text': 'doc-2',
            'metadata': {'type': 'route'}
        },
        {
            'text': 'doc-3'
        }
    ]

    mongo_client.insert_documents(
        documents,
        batch_size=2,
        ingestion_version='20260321050000'
    )

    assert len(fake_collection.inserted_batches) == 2
    assert [len(batch) for batch in fake_collection.inserted_batches] == [2, 1]

    inserted_documents = fake_collection.inserted_batches[0] + fake_collection.inserted_batches[1]
    assert inserted_documents[0]['metadata']['ingestion_version'] == '20260321050000'
    assert inserted_documents[1]['metadata']['ingestion_version'] == '20260321050000'
    assert inserted_documents[2]['metadata']['ingestion_version'] == '20260321050000'
    assert inserted_documents[2]['metadata'] == {'ingestion_version': '20260321050000'}

    assert documents[0]['metadata']['ingestion_version'] == '20260321050000'
    assert documents[1]['metadata']['ingestion_version'] == '20260321050000'
    assert documents[2]['metadata']['ingestion_version'] == '20260321050000'


@pytest.mark.dbConnection
def test_insert_documents_raises_runtime_error_when_collection_insert_fails():
    class FakeCollection:
        def insert_many(self, documents):
            raise Exception('insert failed')

    mongo_client = build_mongodb_client_without_init()
    mongo_client.collection_name = 'live_collection'
    mongo_client.get_collection = lambda collection_name=None: FakeCollection()

    with pytest.raises(
        RuntimeError,
        match='Error storing data in MongoDB Atlas collection live_collection: insert failed'
    ):
        mongo_client.insert_documents(
            [{'text': 'doc-1', 'metadata': {'type': 'stop'}}],
            ingestion_version='20260321050000'
        )


@pytest.mark.dbConnection
def test_get_stats_returns_count_summary_for_collection_and_filter():
    class FakeCollection:
        def __init__(self):
            self.count_queries = []

        def count_documents(self, filter_query):
            self.count_queries.append(filter_query)
            if filter_query == {'metadata.ingestion_version': '20260321050000'}:
                return 10
            if filter_query == {
                'metadata.ingestion_version': '20260321050000',
                'metadata.type': 'stop'
            }:
                return 3
            if filter_query == {
                'metadata.ingestion_version': '20260321050000',
                'metadata.type': 'route'
            }:
                return 2
            if filter_query == {
                'metadata.ingestion_version': '20260321050000',
                'metadata.type': 'trip_pattern'
            }:
                return 5
            raise AssertionError(f'Unexpected filter query: {filter_query}')

    fake_collection = FakeCollection()
    mongo_client = build_mongodb_client_without_init()
    mongo_client.get_collection = lambda collection_name=None: fake_collection

    stats = mongo_client.get_stats(filter_query={'metadata.ingestion_version': '20260321050000'})

    assert stats == {
        'total_documents': 10,
        'stops': 3,
        'routes': 2,
        'trips': 5
    }


@pytest.mark.dbConnection
def test_find_and_delete_documents_delegate_to_collection_methods():
    class FakeDeleteResult:
        def __init__(self, deleted_count):
            self.deleted_count = deleted_count

    class FakeCollection:
        name = 'live_collection'

        def __init__(self):
            self.find_queries = []
            self.delete_queries = []

        def find(self, filter_query):
            self.find_queries.append(filter_query)
            return iter([
                {'_id': '1', 'metadata': {'type': 'stop'}},
                {'_id': '2', 'metadata': {'type': 'route'}}
            ])

        def delete_many(self, filter_query):
            self.delete_queries.append(filter_query)
            return FakeDeleteResult(2)

    fake_collection = FakeCollection()
    mongo_client = build_mongodb_client_without_init()
    mongo_client.get_collection = lambda collection_name=None: fake_collection

    found_documents = mongo_client.find_documents({'metadata.type': 'stop'})
    deleted_count = mongo_client.delete_documents({'metadata.ingestion_version': 'old'})

    assert found_documents == [
        {'_id': '1', 'metadata': {'type': 'stop'}},
        {'_id': '2', 'metadata': {'type': 'route'}}
    ]
    assert fake_collection.find_queries == [{'metadata.type': 'stop'}]
    assert deleted_count == 2
    assert fake_collection.delete_queries == [{'metadata.ingestion_version': 'old'}]


@pytest.mark.dbConnection
def test_list_collections_drop_collection_and_create_indexes_use_db_and_collection_handles():
    class FakeCollection:
        def __init__(self):
            self.created_indexes = []

        def create_index(self, index_spec):
            self.created_indexes.append(index_spec)

    class FakeDb:
        def __init__(self):
            self.dropped_collections = []

        def list_collection_names(self):
            return [
                'rail_live',
                'rail_live_backup',
                'misc'
            ]

        def drop_collection(self, collection_name):
            self.dropped_collections.append(collection_name)

    fake_collection = FakeCollection()
    fake_db = FakeDb()
    mongo_client = build_mongodb_client_without_init()
    mongo_client.db = fake_db
    mongo_client.collection_name = 'rail_live'
    mongo_client.get_collection = lambda collection_name=None: fake_collection

    prefixed_collections = mongo_client.list_collections(prefix='rail_live_backup')
    all_collections = mongo_client.list_collections()
    mongo_client.drop_collection('rail_live_backup')
    mongo_client.create_indexes()

    assert prefixed_collections == ['rail_live_backup']
    assert all_collections == ['misc', 'rail_live', 'rail_live_backup']
    assert fake_db.dropped_collections == ['rail_live_backup']
    assert fake_collection.created_indexes == [
        [('metadata.type', 1)],
        [('metadata.stop_id', 1)],
        [('metadata.route_id', 1)],
        [('metadata.trip_id', 1)]
    ]
