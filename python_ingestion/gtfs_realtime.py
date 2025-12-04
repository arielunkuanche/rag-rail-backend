import requests
from google.transit import gtfs_realtime_pb2
from typing import List, Dict
import time

class GTFSRealtimeClient:
    def __init__(self, gtfs_rt_url: str):
        self.gtfs_rt_url = gtfs_rt_url
    
    def fetch_feed(self) -> gtfs_realtime_pb2.FeedMessage:
        """Fetch GTFS Realtime feed buffer"""
        print(f"1. Fetching GTFS-RT updates feed from ${self.gtfs_rt_url}")
    
        response = requests.get(self.gtfs_rt_url)
        response.raise_for_status()

        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(response.content)

        print("2. Completed fetching feed and parsing")
        return feed
    
    def get_trip_updates(self) -> List[Dict]:
        """Extract trip updates from RT feed"""
        feed = self.fetch_feed()
        trip_updates = []

        for entity in feed.entity:
            if entity.HasField('trip_update'):
                tu = entity.trip_update
                trip_update = {
                    'id': entity.id,
                    'trip_id': tu.trip.trip_id,
                    'route_id': tu.trip.route_id,
                    'start_time': tu.trip.start_time if tu.trip.HasField('start_time') else None,
                    'start_date': tu.trip.start_date if tu.trip.HasField('start_date') else None,
                    'time_stamp': tu.timestamp if tu.HasField('timestamp') else None,
                    'delay': tu.delay if tu.HasField('delay') else None,
                    'stop_time_updates': []
                }

                for stu in tu.stop_time_update:
                    stop_time_update = {
                        'stop_sequence': stu.stop_sequence,
                        'stop_id': stu.stop_id,
                        'arrival_delay': stu.arrival.delay if stu.HasField('arrival') else None,
                        'arrival_time': stu.arrival.time  if stu.HasField('arrival') else None,
                        'departure_delay': stu.departure.delay if stu.HasField('departure') else None,
                        'departure_time': stu.departure.time  if stu.HasField('departure') else None,
                    }
                    trip_update['stop_time_updates'].append(stop_time_update)
                
                trip_updates.append(trip_update)
                
        print(f"3. All trip_updates feed fetched ${trip_updates[0]}")
        return trip_updates
    
    def get_vehicle_positions(self) -> List[Dict]:
        """Extract vehicle positions from RT feed"""
        feed = self.fetch_feed()
        vehicle_positions = []

        for entity in feed.entity:
            if entity.HasField('vehicle'):
                vp = entity.vehicle
                position = {
                    'id': entity.id,
                    'trip_id': vp.trip.trip_id if vp.HasField('trip') else None,
                    'route_id': vp.trip.route_id if vp.HasField('route') else None,
                    'latitude': vp.position.latitude if vp.HasField('position') else None,
                    'longitude': vp.position.longitude if vp.HasField('position') else None,
                    'bearing': vp.position.bearing if vp.HasField('bearing') else None,
                    'speed': vp.position.speed if vp.HasField('speed') else None,
                    'current_stop_sequence': vp.current_stop_sequence if vp.HasField('current_stop_sequence') else None,
                    'current_status': vp.current_status if vp.HasField('current_status') else None,
                    'timestamp': vp.timestamp if vp.HasField('timestamp') else None,
                    'stop_id': vp.stop_id if vp.HasField('stop_id') else None,
                }
                vehicle_positions.append(position)
        
        print(f"4. vehicle position fetched {vehicle_positions}")
        return vehicle_positions
    
    def get_alerts(self) -> List[Dict]:
        """Extract alerts RT feed"""
        feed = self.fetch_feed()
        alerts = []

        for entity in feed.entity:
            if entity.HasField('alert'):
                alert = entity.alert
                alert_data = {
                    'id': entity.id,
                    'active_period': [],
                    'informed_entity': [],
                    'cause': alert.cause if alert.HasField('cause') else None,
                    'effect': alert.effect  if alert.HasField('effect') else None,
                    'header_text': None,
                    'description_text': None
                }

                # Get Active period data
                for period in alert.active_period:
                    alert_data['active_period'].append({
                        'start': period.start if period.HasField('start') else None,
                        'end': period.end if period.HasField('end') else None
                    })

                # Get Informed entity data
                for entity_selector in alert.informed_entity:
                    informed = {}
                    if entity_selector.HasField('route_id'):
                        informed['route_id'] = entity_selector.route_id
                    if entity_selector.HasField('trip'):
                        informed['trip_id'] = entity_selector.trip.trip_id
                    if entity_selector.HasField('stop_id'):
                        informed['stop_id'] = entity_selector.stop_id

                    alert_data['informed_entity'].append(informed)

                # Get the first translation from the header text
                if alert.HasField('header_text') and len(alert.header_text.translation) > 0:
                    print(f" ->>  5. Print the complete alert header_text ${alert.header_text}")
                    alert_data['header_text'] = alert.header_text.translation[0].text

                if alert.HasField('description_text') and len(alert.description_text.translation) > 0:
                    print(f" ->>  6. Print the complete alert description_text ${alert.description_text}")
                    alert_data['description_text'] = alert.description_text.translation[0].text
                
                alerts.append(alert_data)
        
        return alerts
    
    def get_all_updates(self) -> Dict:
        """Get all RT feed updates"""
        feed = self.fetch_feed()

        return {
            'timestamp': feed.header.timestamp,
            'trip_updates': self.get_trip_updates(),
            'vehicle_positions': self.get_vehicle_positions(),
            'alerts': self.get_alerts()
        }
