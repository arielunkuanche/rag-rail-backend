import os
import requests
import zipfile
import io
import pandas as pd
from typing import Dict, List, Set
from datetime import datetime, timezone
import re

class GTFSProcessor:
    ROUTE_TYPE_MAPPING = {
        102: "Long Distance Trains",
        103: "Inter Regional Rail Service",
        109: "Suburban Railway",
    }

    def __init__(self, gtfs_url: str):
        """Initialize GTFS processor with data source URL"""
        self.gtfs_url = gtfs_url
        self.data = {}

    def download_and_extract(self) -> Dict[str, pd.DataFrame]:
        """Download and extract GTFS data"""
        print(f"--- 1. Downloading GTFS data from {self.gtfs_url} ---")
        response = requests.get(self.gtfs_url)
        response.raise_for_status()
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

            agency_id = row.get('agency_id', "Unknown agency")
            agency_name = self._get_agency_name(agency_id)

            # text = f"Route: {row.get('route_long_name', '')} ({row.get('route_short_name', '')}). "
            # text += f"Type: {row.get('route_type', 'N/A')}. "
            text = (
                f"Route {row['route_id']}: {row.get('route_long_name', '')} ({row.get('route_short_name', '')}). "
                f"The route is operated by agency {agency_name} (ID: {agency_id}), "
                f"and provides a {route_type_description} service. "
                f"This document describes the general, date-agnostic characteristics of the route."
            )
            if pd.notna(row.get('route_desc')):
                text += f"Description: {row['route_desc']}"
            
            documents.append({
                'text': text,
                'metadata': {
                    'type': 'route',
                    'route_id': str(row.get('route_id')),
                    'route_short_name': str(row.get('route_short_name', '')),
                    'route_long_name': str(row.get('route_long_name', '')),
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

            origin_stop = str(group_sorted.iloc[0]['stop_name'])
            destination_stop = str(
                group_sorted.iloc[0]['trip_headsign']
                if pd.notna(group_sorted.iloc[0]['trip_headsign'])
                else group_sorted.iloc[-1].get('stop_name', 'Unknown')
            )

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
                'origin': origin_stop,
                'destination': destination_stop,
                'formatted_stops': formatted_stops,
                'stops': stop_names
            })
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
                    'origin': trip['origin'],
                    'destination': trip['destination'],
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