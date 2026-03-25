import io
import zipfile
from unittest.mock import Mock, patch

import pandas as pd
import pytest
import requests

from python_ingestion.gtfs_processor import GTFSProcessor


def build_gtfs_zip_bytes():
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, 'w') as zip_file:
        zip_file.writestr(
            'stops.txt',
            'stop_id,stop_name,stop_lat,stop_lon\n'
            '1,Helsinki,60.1719,24.9414\n'
            '2,Pasila,60.1989,24.9341\n'
        )
        zip_file.writestr(
            'routes.txt',
            'route_id,agency_id,route_short_name,route_long_name,route_type\n'
            'R1,VR,IC 265,Helsinki - Rovaniemi,102\n'
        )
        zip_file.writestr(
            'agency.txt',
            'agency_id,agency_name\n'
            'VR,VR Group\n'
        )

    return zip_buffer.getvalue()


@pytest.mark.gtfsDownloadAndExtract
def test_download_and_extract_loads_expected_gtfs_tables():
    processor = GTFSProcessor('https://example.test/gtfs.zip')
    response = Mock()
    response.content = build_gtfs_zip_bytes()
    response.raise_for_status = Mock()

    with patch('python_ingestion.gtfs_processor.requests.get', return_value=response) as mock_get:
        extracted = processor.download_and_extract()

    mock_get.assert_called_once_with(
        'https://example.test/gtfs.zip',
        timeout=GTFSProcessor.GTFS_DOWNLOAD_TIMEOUT_SEC
    )
    response.raise_for_status.assert_called_once_with()

    assert extracted is processor.data
    assert set(extracted.keys()) == {'stops', 'routes', 'agency'}

    stops_df = extracted['stops']
    routes_df = extracted['routes']
    agency_df = extracted['agency']

    assert list(stops_df['stop_name']) == ['Helsinki', 'Pasila']
    assert routes_df.iloc[0]['route_long_name'] == 'Helsinki - Rovaniemi'
    assert agency_df.iloc[0]['agency_name'] == 'VR Group'


@pytest.mark.gtfsDownloadAndExtract
def test_download_and_extract_retries_after_transient_failure_and_then_succeeds():
    processor = GTFSProcessor('https://example.test/gtfs.zip')
    response = Mock()
    response.content = build_gtfs_zip_bytes()
    response.raise_for_status = Mock()

    with patch(
        'python_ingestion.gtfs_processor.requests.get',
        side_effect=[requests.RequestException('temporary network issue'), response]
    ) as mock_get, patch('python_ingestion.gtfs_processor.time.sleep') as mock_sleep:
        extracted = processor.download_and_extract()

    assert set(extracted.keys()) == {'stops', 'routes', 'agency'}
    assert mock_get.call_count == 2
    mock_sleep.assert_called_once_with(GTFSProcessor.GTFS_DOWNLOAD_BACKOFF_SEC)
    response.raise_for_status.assert_called_once_with()


@pytest.mark.gtfsDownloadAndExtract
def test_download_and_extract_raises_runtime_error_after_max_attempts():
    processor = GTFSProcessor('https://example.test/gtfs.zip')

    with patch(
        'python_ingestion.gtfs_processor.requests.get',
        side_effect=requests.RequestException('service unavailable')
    ) as mock_get, patch('python_ingestion.gtfs_processor.time.sleep') as mock_sleep:
        with pytest.raises(
            RuntimeError,
            match='Failed to download GTFS data after 3 attempts.'
        ):
            processor.download_and_extract()

    assert mock_get.call_count == GTFSProcessor.GTFS_DOWNLOAD_MAX_ATTEMPTS
    assert mock_sleep.call_count == GTFSProcessor.GTFS_DOWNLOAD_MAX_ATTEMPTS - 1


@pytest.mark.gtfsProcess
def test_extract_origin_destination_handles_hyphen_and_dash_variants():
    processor = GTFSProcessor('https://example.test/gtfs.zip')

    assert processor._extract_origin_destination('Helsinki - Rovaniemi') == ('Helsinki', 'Rovaniemi')
    assert processor._extract_origin_destination('Pasila – Oulu') == ('Pasila', 'Oulu')
    assert processor._extract_origin_destination('Kerava—Lahti') == ('Kerava', 'Lahti')
    assert processor._extract_origin_destination('SingleStopName') == ('', '')
    assert processor._extract_origin_destination('') == ('', '')


@pytest.mark.gtfsProcess
def test_normalize_train_number_handles_supported_formats_and_empty_values():
    processor = GTFSProcessor('https://example.test/gtfs.zip')

    assert processor._normalize_train_number('IC45') == 'IC 45'
    assert processor._normalize_train_number('  s2  ') == 'S 2'
    assert processor._normalize_train_number('PYO263') == 'PYO 263'
    assert processor._normalize_train_number('z (hl9804)') == 'Z (HL 9804)'
    assert processor._normalize_train_number('') == ''


@pytest.mark.gtfsProcess
def test_extract_train_family_returns_uppercase_letter_prefix_only():
    processor = GTFSProcessor('https://example.test/gtfs.zip')

    assert processor._extract_train_family('IC 265') == 'IC'
    assert processor._extract_train_family('r') == 'R'
    assert processor._extract_train_family('  z (HL 9804)') == 'Z'
    assert processor._extract_train_family('12345') == ''
    assert processor._extract_train_family('') == ''


@pytest.mark.gtfsProcess
def test_build_route_pattern_id_removes_spaces_and_omits_empty_direction_parts():
    processor = GTFSProcessor('https://example.test/gtfs.zip')

    assert (
        processor._build_route_pattern_id('R1', 'Helsinki Central', 'Rovaniemi')
        == 'R1_HelsinkiCentral_Rovaniemi'
    )
    assert processor._build_route_pattern_id(' R 2 ', '', '') == 'R2'


@pytest.mark.gtfsProcess
def test_process_stops_returns_expected_stop_documents():
    processor = GTFSProcessor('https://example.test/gtfs.zip')
    processor.data = {
        'stops': pd.DataFrame([
            {
                'stop_id': '1',
                'stop_name': 'Helsinki Central',
                'stop_desc': 'Main railway station',
                'stop_lat': 60.1719,
                'stop_lon': 24.9414
            },
            {
                'stop_id': '2',
                'stop_name': 'Pasila',
                'stop_desc': None,
                'stop_lat': 60.1989,
                'stop_lon': 24.9341
            }
        ])
    }

    documents = processor.process_stops()

    assert len(documents) == 2
    assert documents[0]['metadata']['type'] == 'stop'
    assert documents[0]['metadata']['stop_id'] == '1'
    assert documents[0]['metadata']['stop_name'] == 'Helsinki Central'
    assert documents[0]['metadata']['stop_lat'] == 60.1719
    assert documents[0]['metadata']['stop_lon'] == 24.9414
    assert 'Description: Main railway station.' in documents[0]['text']
    assert 'Location: 60.1719, 24.9414.' in documents[0]['text']
    assert documents[1]['metadata']['stop_name'] == 'Pasila'
    assert 'Description:' not in documents[1]['text']


@pytest.mark.gtfsProcess
def test_process_routes_returns_expected_route_documents_with_metadata():
    processor = GTFSProcessor('https://example.test/gtfs.zip')
    processor.data = {
        'agency': pd.DataFrame([
            {
                'agency_id': '10',
                'agency_name': 'VR Group'
            }
        ]),
        'routes': pd.DataFrame([
            {
                'route_id': 'R1',
                'agency_id': '10',
                'route_short_name': 'IC 265',
                'route_long_name': 'Helsinki - Rovaniemi',
                'route_type': 102,
                'route_desc': 'Night route'
            },
            {
                'route_id': 'R2',
                'agency_id': '10',
                'route_short_name': 'Z',
                'route_long_name': 'Helsinki - Lahti',
                'route_type': 109,
                'route_desc': None
            }
        ])
    }

    documents = processor.process_routes()

    assert len(documents) == 2
    assert documents[0]['metadata']['type'] == 'route'
    assert documents[0]['metadata']['route_id'] == 'R1'
    assert documents[0]['metadata']['origin'] == 'Helsinki'
    assert documents[0]['metadata']['destination'] == 'Rovaniemi'
    assert documents[0]['metadata']['route_pattern_id'] == 'R1_Helsinki_Rovaniemi'
    assert documents[0]['metadata']['train_family_normalized'] == 'IC'
    assert documents[0]['metadata']['agency_id'] == '10'
    assert 'VR Group' in documents[0]['text']
    assert 'Long Distance Trains' in documents[0]['text']
    assert 'Description: Night route' in documents[0]['text']

    assert documents[1]['metadata']['route_id'] == 'R2'
    assert documents[1]['metadata']['origin'] == 'Helsinki'
    assert documents[1]['metadata']['destination'] == 'Lahti'
    assert documents[1]['metadata']['route_pattern_id'] == 'R2_Helsinki_Lahti'
    assert documents[1]['metadata']['train_family_normalized'] == 'Z'
    assert 'Suburban Railway' in documents[1]['text']
    assert 'Description:' not in documents[1]['text']


@pytest.mark.gtfsProcess
def test_process_stop_times_dedupes_semantic_trip_patterns_and_formats_stop_sequence():
    processor = GTFSProcessor('https://example.test/gtfs.zip')
    processor.data = {
        'stops': pd.DataFrame([
            {'stop_id': '100', 'stop_name': 'Helsinki'},
            {'stop_id': '200', 'stop_name': 'Pasila'},
            {'stop_id': '300', 'stop_name': 'Oulu'}
        ]),
        'routes': pd.DataFrame([
            {
                'route_id': 'R1',
                'route_short_name': 'IC 265'
            }
        ]),
        'trips': pd.DataFrame([
            {
                'trip_id': 'TRIP-1',
                'route_id': 'R1',
                'service_id': 'WKD',
                'trip_headsign': 'Oulu',
                'trip_short_name': 'IC265'
            },
            {
                'trip_id': 'TRIP-2',
                'route_id': 'R1',
                'service_id': 'WKD',
                'trip_headsign': 'Oulu',
                'trip_short_name': 'IC265'
            }
        ]),
        'stop_times': pd.DataFrame([
            {
                'trip_id': 'TRIP-1',
                'arrival_time': '08:00:00',
                'departure_time': '08:05:00',
                'stop_id': '100',
                'stop_sequence': 1
            },
            {
                'trip_id': 'TRIP-1',
                'arrival_time': '08:15:00',
                'departure_time': '08:16:00',
                'stop_id': '200',
                'stop_sequence': 2
            },
            {
                'trip_id': 'TRIP-1',
                'arrival_time': '14:20:00',
                'departure_time': '14:25:00',
                'stop_id': '300',
                'stop_sequence': 3
            },
            {
                'trip_id': 'TRIP-2',
                'arrival_time': '09:00:00',
                'departure_time': '09:05:00',
                'stop_id': '100',
                'stop_sequence': 1
            },
            {
                'trip_id': 'TRIP-2',
                'arrival_time': '09:15:00',
                'departure_time': '09:16:00',
                'stop_id': '200',
                'stop_sequence': 2
            },
            {
                'trip_id': 'TRIP-2',
                'arrival_time': '15:20:00',
                'departure_time': '15:25:00',
                'stop_id': '300',
                'stop_sequence': 3
            }
        ])
    }

    documents = processor.process_stop_times()

    assert len(documents) == 1

    trip_pattern = documents[0]

    assert trip_pattern['metadata']['type'] == 'trip_pattern'
    assert trip_pattern['metadata']['route_id'] == 'R1'
    assert trip_pattern['metadata']['trip_id'] == 'TRIP-1'
    assert trip_pattern['metadata']['train_number'] == 'IC265'
    assert trip_pattern['metadata']['train_number_normalized'] == 'IC 265'
    assert trip_pattern['metadata']['train_family_normalized'] == 'IC'
    assert trip_pattern['metadata']['origin'] == 'Helsinki'
    assert trip_pattern['metadata']['destination'] == 'Oulu'
    assert trip_pattern['metadata']['route_pattern_id'] == 'R1_Helsinki_Oulu'
    assert trip_pattern['metadata']['stop_count'] == 3
    assert trip_pattern['metadata']['stops'] == ['Helsinki', 'Pasila', 'Oulu']
    assert trip_pattern['metadata']['formatted_stops'] == [
        'Helsinki at 08:05',
        'Pasila at 08:16',
        'Oulu at 14:25'
    ]
    assert trip_pattern['metadata']['canonical_id'] == 'R1_IC265_Helsinki_Oulu'
    assert 'TRAIN PATTERN: Train IC265 on Route R1.' in trip_pattern['text']
    assert 'Key stops includes: Helsinki at 08:05, Pasila at 08:16, Oulu at 14:25.' in trip_pattern['text']
