import requests
import zipfile
import io
import pandas as pd
from typing import Dict, List, Set, Tuple
from datetime import datetime, timezone
import re
import time

class GTFSProcessor:
    ROUTE_TYPE_MAPPING = {
        102: "Long Distance Trains",
        103: "Inter Regional Rail Service",
        109: "Suburban Railway",
    }
    GTFS_DOWNLOAD_TIMEOUT_SEC = 30
    GTFS_DOWNLOAD_MAX_ATTEMPTS = 3
    GTFS_DOWNLOAD_BACKOFF_SEC = 5

    def __init__(self, gtfs_url: str):
        """Initialize GTFS processor with data source URL"""
        self.gtfs_url = gtfs_url
        self.data = {}

    def download_and_extract(self) -> Dict[str, pd.DataFrame]:
        """Download and extract GTFS data"""
        print(f"--- 1. Downloading GTFS data from {self.gtfs_url} ---")
        download_start = time.time()
        response = None

        for attempt in range(1, self.GTFS_DOWNLOAD_MAX_ATTEMPTS + 1):
            try:
                print(
                    f"--- GTFS download attempt {attempt}/{self.GTFS_DOWNLOAD_MAX_ATTEMPTS} "
                    f"(timeout={self.GTFS_DOWNLOAD_TIMEOUT_SEC}s) ---"
                )
                response = requests.get(self.gtfs_url, timeout=self.GTFS_DOWNLOAD_TIMEOUT_SEC)
                response.raise_for_status()
                break
            except requests.RequestException as err:
                print(f"--- GTFS download attempt {attempt} failed: {err} ---")
                if attempt == self.GTFS_DOWNLOAD_MAX_ATTEMPTS:
                    raise RuntimeError(
                        f"Failed to download GTFS data after {self.GTFS_DOWNLOAD_MAX_ATTEMPTS} attempts."
                    ) from err

                print(f"--- Retrying GTFS download in {self.GTFS_DOWNLOAD_BACKOFF_SEC} seconds ---")
                time.sleep(self.GTFS_DOWNLOAD_BACKOFF_SEC)

        print(f"\n--- Response status {response} ---")

        print(f"--- 2. Extracting files... ---")
        with zipfile.ZipFile(io.BytesIO(response.content)) as zip_ref:
            # Read all text files from the zip
            for file_name in zip_ref.namelist():
                if file_name.endswith('.txt'):
                    table_name = file_name.replace('.txt', '')
                    with zip_ref.open(file_name) as file:
                        self.data[table_name] = pd.read_csv(file)
                        print(f"--- Loaded {table_name}: {len(self.data[table_name])} rows ---")
        
        print(f" \n-> Successfully extract all zip files ---")
        print(f"-> ✅ GTFS download + extract completed in {time.time() - download_start:.2f} s")
        return self.data

    def _get_stop_name(self, stop_id: str) -> str:
        """Helper function to get stop name from stop_id"""
        if 'stops' not in self.data:
            raise ValueError("Stops data not found in GTFS")
        
        stops_df =self.data['stops']
        if stops_df is not None:
            # Ensure stop_id is treated as string for comparison
            stop = stops_df[stops_df['stop_id'].astype(str) == str(stop_id)]
            if not stop.empty:
                return str(stop.iloc[0].get('stop_name', f"Stop ID {stop_id}"))

        return f"Unknown Stop ({stop_id})"

    def _get_agency_name(self, agency_id: str) -> str:
        """Helper function to get full agency name from agency.txt"""
        if 'agency' not in self.data:
            raise ValueError("Agency data not found in GTFS")
        
        agency_df = self.data['agency']
        if agency_df is not None and 'agency_id' in agency_df.columns and 'agency_name' in agency_df.columns:
            agency_row = agency_df[agency_df['agency_id'].astype(str) == str(agency_id)]
            if not agency_row.empty:
                return str(agency_row.iloc[0].get('agency_name', f"Agency ID {agency_id}"))

        return f"Unknown Agency ({agency_id})"

    def _get_route_type_description(self, route_type: str) -> str:
        """Helper function to extract route type description from routes.txt"""
        if pd.isna(route_type):
            return "unknown"
        
        try:
            code = int(route_type)
            return self.ROUTE_TYPE_MAPPING.get(code, f"Unlisted service type ({route_type})")
        except ValueError as e:
            return f"Error in get route type {e} and invalid Service type ({route_type})"

    def _extract_train_family(self, route_short_name: str) -> str:
        """Extract normalized train family from routes.txt route_short_name (e.g. IC 45 -> IC, R -> R)."""
        if pd.isna(route_short_name):
            return ""

        text = str(route_short_name).strip()
        if not text:
            return ""

        match = re.match(r'^([A-Za-zÅÄÖåäö]+)', text)
        return match.group(1).strip().upper() if match else ""

    def _normalize_train_number(self, train_number: str) -> str:
        """Normalize trip_pattern train number text for stable backend filtering."""
        if pd.isna(train_number):
            return ""

        text = str(train_number).strip().upper()
        if not text:
            return ""

        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"\b(IC|S|HDM|PYO|HL)\s*(\d+)\b", r"\1 \2", text)
        text = re.sub(r"\b([A-Z])\s*\(\s*HL\s*(\d+)\s*\)", r"\1 (HL \2)", text)
        return text.strip()

    def _extract_origin_destination(self, route_long_name: str) -> Tuple[str, str]:
        """Extract origin/destination from routes.txt route_long_name in format 'Origin - Destination'."""
        if pd.isna(route_long_name):
            return "", ""

        text = str(route_long_name).strip()
        if not text:
            return "", ""

        parts = re.split(r"\s*[-–—]\s*", text, maxsplit=1)
        if len(parts) < 2:
            return "", ""

        origin = parts[0].strip()
        destination = parts[1].strip()
        return origin, destination

    def _build_route_pattern_id(self, route_id: str, origin: str, destination: str) -> str:
        """Build stable route-pattern identifier with routeID + origin and destination."""
        def normalize_part(value: str) -> str:
            return re.sub(r"\s+", "", str(value or "").strip())

        route_part = normalize_part(route_id)
        origin_part = normalize_part(origin)
        destination_part = normalize_part(destination)

        if origin_part and destination_part:
            return f"{route_part}_{origin_part}_{destination_part}"
        return route_part

    def _print_train_number_coverage_summary(self, unique_trips: List[Dict]) -> None:
        """Print ingestion audit metrics for raw and normalized train-number coverage."""
        total_trips = len(unique_trips)
        if total_trips == 0:
            print("[INGEST AUDIT][TrainNumberCoverage] No trip patterns were generated.")
            return

        raw_present = 0
        raw_missing = 0
        normalized_present = 0
        normalized_missing = 0
        family_present = 0
        family_missing = 0
        placeholder_count = 0

        for trip in unique_trips:
            train_number = str(trip.get('train_number', '')).strip()
            train_number_normalized = str(trip.get('train_number_normalized', '')).strip()
            train_family_normalized = str(trip.get('train_family_normalized', '')).strip()

            is_placeholder = train_number == 'Unknown Train Number'
            if is_placeholder:
                placeholder_count += 1

            if train_number and not is_placeholder:
                raw_present += 1
            else:
                raw_missing += 1

            if train_number_normalized:
                normalized_present += 1
            else:
                normalized_missing += 1

            if train_family_normalized:
                family_present += 1
            else:
                family_missing += 1

        print(
            "[INGEST AUDIT][TrainNumberCoverage]",
            {
                'trip_patterns_total': total_trips,
                'raw_train_number_present': raw_present,
                'raw_train_number_missing': raw_missing,
                'raw_train_number_placeholder': placeholder_count,
                'train_number_normalized_present': normalized_present,
                'train_number_normalized_missing': normalized_missing,
                'train_family_normalized_present': family_present,
                'train_family_normalized_missing': family_missing
            }
        )

    def process_stops(self) -> List[Dict]:
        """Process stops data into structured document"""
        if 'stops' not in self.data:
            raise ValueError("Stops data not found in GTFS")
        
        stops_df =self.data['stops']
        documents = []

        print(f"--- 3. Processing stops... ---")
        for _, row in stops_df.iterrows():
            text = (
                f"Stop: {row.get('stop_name', 'Unknown')} (ID: {row['stop_id']}). "
                f"This document is purely descriptive of the station/stop info."
            )
            if pd.notna(row.get('stop_desc')):
                text += f"Description: {row['stop_desc']}."
            text += f" Location: {row.get('stop_lat', 'N/A')}, {row.get('stop_lon', 'N/A')}. "

            documents.append({
                'text': text,
                'metadata': {
                    'type': 'stop',
                    'stop_id': str(row.get('stop_id', '')),
                    'stop_name': str(row.get('stop_name', '')),
                    'stop_lat': float(row.get('stop_lat', 0)) if pd.notna(row.get('stop_lat')) else None,
                    'stop_lon': float(row.get('stop_lon', 0)) if pd.notna(row.get('stop_lon')) else None,
                    'updated_at': datetime.now(timezone.utc).isoformat()
                }
            })

        print(f" -> Successfully processing stops file with {len(documents)} stops. ---")
        return documents

    def process_routes(self) -> List[Dict]:
        """Process routes data into structured documents"""
        if 'routes' not in self.data:
            raise ValueError("Routes data not in GTFS data")
        
        routes_df = self.data['routes']
        documents = []

        print(f"--- 4. Processing routes... ---")
        for _, row in routes_df.iterrows():
            route_type_code = row.get('route_type', 'Unknown route type code')
            route_type_description = self._get_route_type_description(route_type=route_type_code)
            route_short_name = str(row.get('route_short_name', '')).strip()
            route_long_name = str(row.get('route_long_name', '')).strip()
            route_id = str(row.get('route_id'))
            origin, destination = self._extract_origin_destination(route_long_name)
            train_family_normalized = self._extract_train_family(route_short_name)
            route_pattern_id = self._build_route_pattern_id(route_id, origin, destination)

            agency_id = row.get('agency_id', "Unknown agency")
            agency_name = self._get_agency_name(agency_id)

            text = (
                f"Route {route_id}: {route_long_name} ({route_short_name}). "
                f"The route is operated by agency {agency_name} (ID: {agency_id}), "
                f"and provides a {route_type_description} service. "
                f"This document describes the general characteristics of the route from {origin} to {destination}."
            )
            if pd.notna(row.get('route_desc')):
                text += f"Description: {row['route_desc']}"
            
            documents.append({
                'text': text,
                'metadata': {
                    'type': 'route',
                    'route_id': route_id,
                    'route_short_name': route_short_name,
                    'route_long_name': route_long_name,
                    'origin': origin,
                    'destination': destination,
                    'route_pattern_id': route_pattern_id,
                    'train_family_normalized': train_family_normalized,
                    'agency_id': str(agency_id),
                    'route_type': route_type_code,
                    'updated_at': datetime.now(timezone.utc).isoformat()
                }
            })
        
        print(f" -> Successfully processing routes file with {len(documents)} routes---")
        return documents
    
    def process_stop_times(self) -> List[Dict]:
        """
        Process stop_times.txt to create ONE canonical document per unique trip pattern
        (route_id, train_number, origin, destination).
        These patterns are used for semantic search and RAG retrieval.
        This document represents the route sequence.
        """

        if 'stop_times' not in self.data or 'trips' not in self.data:
            raise ValueError("Stop times data or trips data not found in GTFS")
        
        print(f"\n--- Processing stop_times DF (Canonical Trip Patterns) ---")
        stop_times_df = self.data['stop_times']
        #print(f"stop_times_df table head {stop_times_df.head()}")

        # Merge with trips for more context
        if 'trips' in self.data:
            stop_times_df = stop_times_df.merge(
                #self.data['trips'][['trip_id', 'route_id', 'service_id', 'trip_headsign']],
                self.data['trips'],
                on='trip_id',
                how='left'
            )
            print(f"Stop_times merged trips file rows: {len(stop_times_df)}")
            print(f"stop_times_df table head after merged with 'trips':\n {stop_times_df.head()}")

        # Enrich with route_short_name so train family can be normalized from routes metadata.
        if 'routes' in self.data and 'route_id' in self.data['routes'].columns:
            route_projection = self.data['routes'][['route_id', 'route_short_name']].drop_duplicates(subset=['route_id'])
            stop_times_df = stop_times_df.merge(
                route_projection,
                on='route_id',
                how='left'
            )
            print(f"Stop_times merged routes file rows: {len(stop_times_df)}")
        
        # Get all stop names based on stop_id
        stop_times_df['stop_name'] = stop_times_df['stop_id'].apply(self._get_stop_name)

        # Train number extracted from trip_short_name
        stop_times_df['train_number'] = stop_times_df['trip_short_name'].fillna('Unknown Train Number')

        # Sort trip before grouping
        stop_times_df = stop_times_df.sort_values(['trip_id', 'stop_sequence'])
        print(f"\n--- DEMO: stop_times_df First Row after sort (iloc[0]) ---")
        print(stop_times_df.iloc[0].to_string())

        # Compute the unique route pattern based on trip_id
        unique_trips = []

        # Group by trip_id and create basic trip summaries first
        print(f"\n--- 5. Processing stop_times_df group with trip_id ... ---")
        for trip_id, group in stop_times_df.groupby('trip_id'):
            group_sorted = group.sort_values('stop_sequence')

            route_id = str(group_sorted.iloc[0]['route_id'])
            train_number = str(group_sorted.iloc[0]['train_number'])
            route_short_name = group_sorted.iloc[0].get('route_short_name', '')
            route_short_name = "" if pd.isna(route_short_name) else str(route_short_name)
            train_number_normalized = self._normalize_train_number(train_number)
            train_family_normalized = (
                self._extract_train_family(route_short_name)
                or self._extract_train_family(train_number_normalized)
            )

            origin_stop = str(group_sorted.iloc[0]['stop_name'])
            destination_stop = str(
                group_sorted.iloc[0]['trip_headsign']
                if pd.notna(group_sorted.iloc[0]['trip_headsign'])
                else group_sorted.iloc[-1].get('stop_name', 'Unknown')
            )
            route_pattern_id = self._build_route_pattern_id(route_id, origin_stop, destination_stop)

            # Collect formatted stops for each trip
            formatted_stops = []
            stop_names = []
            for _, row in group_sorted.iterrows():
                stop_name = row['stop_name']
                stop_names.append(stop_name)

                time = row.get('departure_time') or row.get('arrival_time') or ''
                # Normalize time format HH:MM:SS -> HH:MM
                if isinstance(time, str) and re.match(r'\d{2}:\d{2}:\d{2}', time):
                    h, m, _ = time.split(':')
                    time = f"{h}:{m}"
                formatted_stops.append(f"{row['stop_name']} at {time}")

            unique_trips.append({
                'trip_id': trip_id,
                'route_id': route_id,
                'train_number': train_number,
                'train_number_normalized': train_number_normalized,
                'train_family_normalized': train_family_normalized,
                'origin': origin_stop,
                'destination': destination_stop,
                'route_pattern_id': route_pattern_id,
                'formatted_stops': formatted_stops,
                'stops': stop_names
            })
        self._print_train_number_coverage_summary(unique_trips)
        print(f"\n unique_trips array first element: \n {unique_trips[0]}")
        # Dedupe patterns by semantic key
        documents = []
        seen = set()

        for trip in unique_trips:
            key = (
                trip['route_id'],
                trip['train_number'],
                trip['origin'],
                trip['destination']
            )
            
            if key in seen:
                continue
            seen.add(key)
            #print(f"Formatted seen set object as {seen}")

            # Build stable canonical id
            canonical_id = (
                f"{trip['route_id']}_"
                f"{trip['train_number'].replace(' ', '')}_"
                f"{trip['origin'].replace(' ', '')}_"
                f"{trip['destination'].replace(' ', '')}"
            )

            # Build clean semantic embedding
            text = (
                f"TRAIN PATTERN: Train {trip['train_number']} on Route {trip['route_id']}. "
                f"Traveling from {trip['origin']} to {trip['destination']}. "
                f"Key stops includes: {', '.join(trip['formatted_stops'][:20])}."
            )
            
            documents.append({
                'text': text,
                'metadata': {
                    'type': 'trip_pattern',
                    'canonical_id': canonical_id,
                    'trip_id': trip['trip_id'],
                    'route_id': trip['route_id'],
                    'train_number': trip['train_number'],
                    'train_number_normalized': trip['train_number_normalized'],
                    'train_family_normalized': trip['train_family_normalized'],
                    'origin': trip['origin'],
                    'destination': trip['destination'],
                    'route_pattern_id': trip['route_pattern_id'],
                    'stop_count': len(trip['formatted_stops']),
                    'stops':trip['stops'],
                    'formatted_stops': trip['formatted_stops'],
                    'updated_at': datetime.now(timezone.utc).isoformat()
                }
            })
        
        print(f" \nFinal stop_times DF size: {stop_times_df.groupby('trip_id').size()})")
        print(f" \n✅ Successfully processing stop_times canonical patterns with {len(documents)} files---")
        return documents
    
    def process_all(self) -> List[Dict]:
        """Process all GTFS data into documents."""
        self.download_and_extract()
        
        all_documents = []
        
        all_documents.extend(self.process_stops())
        
        all_documents.extend(self.process_routes())
        
        all_documents.extend(self.process_stop_times())
        
        print(f"Total documents created: {len(all_documents)}")
        #print(f"Stops: {len(self.process_stops())}, Routes: {len(self.process_routes())}, Trips: {len(self.process_stop_times())}")
        
        return all_documents
