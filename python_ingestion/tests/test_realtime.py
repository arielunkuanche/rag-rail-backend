import pytest
from python_ingestion.gtfs_realtime import GTFSRealtimeClient
from python_ingestion.config import GTFS_RT_URL

@pytest.mark.gtfsRealtime
def test_gtfs_realtime():
    """Test live GTFS-RT data retrieval and parsing."""
    client = GTFSRealtimeClient(GTFS_RT_URL)
    feed = client.get_all_updates()

    assert feed and "timestamp" in feed, "No valid GTFS-RT feed returned"
    assert isinstance(feed['timestamp'], int), "Timestamp must be integer"

    print(f"Fetched GTFS-RT data. Timestamp: {feed['timestamp']}")
    print(f"Trip Updates: {len(feed['trip_updates'])}, Alerts: {len(feed['alerts'])}, Vehicles: {len(feed['vehicle_positions'])}")
