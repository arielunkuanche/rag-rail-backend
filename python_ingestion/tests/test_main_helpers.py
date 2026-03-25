import importlib.util
import sys
from pathlib import Path
from types import ModuleType
import pytest


MAIN_MODULE_PATH = Path(__file__).resolve().parents[1] / 'main.py'


def load_main_module_with_stubs():
    module_name = 'test_python_ingestion_main'
    original_modules = {
        name: sys.modules.get(name)
        for name in ('config', 'gtfs_processor', 'gtfs_embedding', 'mongodb_client')
    }

    config_module = ModuleType('config')
    config_module.EMBEDDING_MODEL = 'test-model'
    config_module.MONGODB_URI = 'mongodb://example.test'
    config_module.DATABASE_NAME = 'test-db'
    config_module.COLLECTION_NAME = 'test-collection'
    config_module.GTFS_STATIC_URL = 'https://example.test/gtfs.zip'

    gtfs_processor_module = ModuleType('gtfs_processor')
    gtfs_processor_module.GTFSProcessor = type('GTFSProcessor', (), {})

    gtfs_embedding_module = ModuleType('gtfs_embedding')
    gtfs_embedding_module.EmbeddingGenerator = type('EmbeddingGenerator', (), {})

    mongodb_client_module = ModuleType('mongodb_client')
    mongodb_client_module.MongoDBClient = type('MongoDBClient', (), {})

    sys.modules['config'] = config_module
    sys.modules['gtfs_processor'] = gtfs_processor_module
    sys.modules['gtfs_embedding'] = gtfs_embedding_module
    sys.modules['mongodb_client'] = mongodb_client_module

    spec = importlib.util.spec_from_file_location(module_name, MAIN_MODULE_PATH)
    module = importlib.util.module_from_spec(spec)

    try:
        spec.loader.exec_module(module)
        return module
    finally:
        sys.modules.pop(module_name, None)

        for name, original_module in original_modules.items():
            if original_module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original_module


@pytest.mark.gtfsProcess
def test_validate_staging_stats_accepts_positive_required_counts():
    main_module = load_main_module_with_stubs()

    stats = {
        'total_documents': 10,
        'stops': 3,
        'routes': 2,
        'trips': 5
    }

    assert main_module.validate_staging_stats(stats) is None


@pytest.mark.gtfsProcess
def test_validate_staging_stats_raises_when_required_counts_are_missing_or_zero():
    main_module = load_main_module_with_stubs()

    with pytest.raises(
        ValueError,
        match='Staging validation failed. Missing positive counts for: routes, trips'
    ):
        main_module.validate_staging_stats({
            'total_documents': 10,
            'stops': 3,
            'routes': 0,
            'trips': -1
        })


@pytest.mark.gtfsProcess
def test_cleanup_old_backups_drops_only_outdated_backup_collections():
    main_module = load_main_module_with_stubs()

    class FakeMongoClient:
        def __init__(self):
            self.dropped = []

        def list_collections(self, prefix=None):
            assert prefix == 'test-collection_backup'
            return [
                'test-collection_backup_20260319',
                'test-collection_backup_20260320',
                'test-collection_backup'
            ]

        def drop_collection(self, collection_name):
            self.dropped.append(collection_name)

    fake_client = FakeMongoClient()

    removed_backups = main_module.cleanup_old_backups(
        fake_client,
        'test-collection_backup'
    )

    assert removed_backups == [
        'test-collection_backup_20260319',
        'test-collection_backup_20260320'
    ]
    assert fake_client.dropped == removed_backups


@pytest.mark.gtfsProcess
def test_cleanup_old_backups_preserves_current_backup_when_no_outdated_collections_exist():
    main_module = load_main_module_with_stubs()

    class FakeMongoClient:
        def __init__(self):
            self.dropped = []

        def list_collections(self, prefix=None):
            assert prefix == 'test-collection_backup'
            return ['test-collection_backup']

        def drop_collection(self, collection_name):
            self.dropped.append(collection_name)

    fake_client = FakeMongoClient()

    removed_backups = main_module.cleanup_old_backups(
        fake_client,
        'test-collection_backup'
    )

    assert removed_backups == []
    assert fake_client.dropped == []
