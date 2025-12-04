import os
import requests
import zipfile
import io
import pandas as pd
from typing import Dict, List
from datetime import datetime, timezone

class GTFSProcessor:
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

    def process_stops(self) -> List[Dict]:
        """Process stops data into structured document"""
        if 'stops' not in self.data:
            raise ValueError("Stops data not found in GTFS")
        
        stops_df =self.data['stops']
        documents = []

        print(f"--- 3. Processing stops... ---")
        for _, row in stops_df.iterrows():
            text = f"Stop:  {row.get('stop_name', 'Unknown')}. "
            if pd.notna(row.get('stop_desc')):
                text += f"Description: {row['stop_desc']}. "
            text += f"Location: {row.get('stop_lat', 'N/A')}, {row.get('stop_lon', 'N/A')}. "

            documents.append({
                'text': text,
                'metadata': {
                    'type': 'stop',
                    'stop_id': str(row.get('stop_id', '')),
                    'stop_name': str(row.get('stop_name', '')),
                    'stop_lat': float(row.get('stop_lat', 0)) if pd.notna(row.get('stop_lat')) else None,
                    'stop_lon': float(row.get('stop_log', 0)) if pd.notna(row.get('stop_lon')) else None,
                    'updated_at': datetime.now(timezone.utc).isoformat()
                }
            })

        print(f" -> Successfully processing stops file ---")
        return documents

    def process_routes(self) -> List[Dict]:
        """Process routes data into structured documents"""
        if 'routes' not in self.data:
            raise ValueError("Routes data not in GTFS data")
        
        routes_df = self.data['routes']
        documents = []

        print(f"--- 4. Processing routes... ---")
        for _, row in routes_df.iterrows():
            text = f"Route: {row.get('route_long_name', '')} ({row.get('route_short_name', '')}). "
            text += f"Type: {row.get('route_type', 'N/A')}. "
            if pd.notna(row.get('route_desc')):
                text += f"Description: {row['route_desc']}"
            
            documents.append({
                'text': text,
                'metadata': {
                    'type': 'route',
                    'route_id': str(row.get('route_id')),
                    'route_short_name': str(row.get('route_short_name', '')),
                    'route_long_name': str(row.get('route_long_name', '')),
                    'route_type': str(row.get('route_type', '')),
                    'updated_at': datetime.now(timezone.utc).isoformat()
                }
            })
        
        print(f" -> Successfully processing routes file ---")
        return documents
    
    def process_stop_times(self) -> List[Dict]:
        """Process stop times data into structured documents."""
        if 'stop_times' not in self.data:
            raise ValueError("Stop times data not found in GTFS")
        
        stop_times_df = self.data['stop_times']
        print(f"stop_times_df table head {stop_times_df.head()}")

        # Merge with trips and stops for more context
        if 'trips' in self.data:
            stop_times_df = stop_times_df.merge(
                self.data['trips'][['trip_id', 'route_id', 'service_id', 'trip_headsign']],
                on='trip_id',
                how='left'
            )
            print(f"Stop_times merged trips file rows: {len(stop_times_df)}")
            print(f"stop_times_df table head merge with 'trips': {stop_times_df.head()}")
            print(f"\n--- DEMO: First Row (iloc[0]) ---")
            print(stop_times_df.iloc[0].to_string())
        
        if 'stops' in self.data:
            stop_times_df = stop_times_df.merge(
                self.data['stops'][['stop_id', 'stop_name']],
                on='stop_id',
                how='left'
            )
            print(f"Stop_times merged stops file rows: {len(stop_times_df)}")
            print(f"\n--- DEMO: First Row (iloc[0]) ---")
            print(stop_times_df.iloc[0].to_string())

        print(f" -> stop_times_df table head merge with 'stops': {stop_times_df.head()}")
        print(f" -> stop_times_df rows after merged before clean up: {len(stop_times_df)}")
        
        documents = []

        # Group by trip for better context
        print(f"--- 5. Processing stop_times_df group with trip_id ... ---")


        trip_id_sample = stop_times_df['trip_id'].iloc[0]
        print(f" -> Example first row data from stop_times_df : {stop_times_df.groupby('trip_id').get_group(trip_id_sample)}")

        for trip_id, group in stop_times_df.groupby('trip_id'):
            trip_stops = []
            for _, row in group.sort_values('stop_sequence').iterrows():
                stop_info = f"{row.get('stop_name', 'Unknown')} at {row.get('arrival_time', 'N/A')}"
                trip_stops.append(stop_info)
            
            text = f"Trip {trip_id} "
            if 'trip_headsign' in group.columns and pd.notna(group.iloc[0].get('trip_headsign')):
                text += f"to {group.iloc[0]['trip_headsign']}"
            text += f". Stops include: {', '.join(trip_stops[:12])}" # Limit to first 12 stops
            
            documents.append({
                'text': text,
                'metadata': {
                    'type': 'trip',
                    'trip_id': str(trip_id),
                    'route_id': str(group.iloc[0].get('route_id', '')),
                    'service_id': str(group.iloc[0].get('service_id', '')),
                    'stop_count': len(group),
                    'updated_at': datetime.now(timezone.utc).isoformat()
                }
            })
        print(f"{stop_times_df.groupby('trip_id').size()})")
        print(f" \n✅ Successfully processing stop_times merged ---")
        return documents
    
    def process_all(self) -> List[Dict]:
        """Process all GTFS data into documents."""
        self.download_and_extract()
        
        all_documents = []
        
        all_documents.extend(self.process_stops())
        
        all_documents.extend(self.process_routes())
        
        all_documents.extend(self.process_stop_times())
        
        print(f"Total documents created: {len(all_documents)}")
        print(f"Stops: {len(self.process_stops())}, Routes: {len(self.process_routes())}, Trips: {len(self.process_stop_times())}")
        
        return all_documents