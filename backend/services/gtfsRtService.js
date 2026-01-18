const axios = require("axios");
const GtfsRealtimeBindings = require("gtfs-realtime-bindings");
const { gtfsRtUrl, digiTrafficUserHeader } = require("../config/config");

const cache = {
    data: null,
    timestamp: 0
};
const cacheDuration = 30000;

const parseRTData = async () => {
    if(!gtfsRtUrl || !digiTrafficUserHeader) throw new Error("Fetch GTFS-RT data config is missing.");

    try {
        const res = await axios.get(gtfsRtUrl, {
            headers: {
                "Digitraffic-User": digiTrafficUserHeader,
                "Accept": "application/x-protobuf"
            },
            responseType: "arraybuffer"
        });
        //console.log("GTFS-RT API call response: ", res);
        const buffer = await res.data;
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

        // Filter each RT updates entities
        const tripUpdates = [];
        const vehicleUpdates = [];
        const alertUpdates = [];

        feed.entity.forEach(entity => {
            // 1. Process tripUpdate feed entity (delays and stop changes)
            if (entity.tripUpdate) {
                tripUpdates.push({
                    id: entity.id,
                    routeId: entity.tripUpdate.trip?.routeId,
                    tripId: entity.tripUpdate.trip?.tripId,
                    startDate: entity.tripUpdate.trip?.startDate,
                    // Add more specific parsing logic here later (e.g., stopTimeUpdate details)
                    scheduleRelationship: entity.tripUpdate.trip?.scheduleRelationship,
                    raw: entity.tripUpdate
                });
            };
            // 2. Process vehiclePosition entity
            if (entity.vehiclePosition) {
                vehicleUpdates.push({
                    id: entity.id,
                    tripId: entity.vehiclePosition.trip?.tripId,
                    routeId: entity.vehiclePosition.trip?.routeId,
                    vehicleId: entity.vehiclePosition.vehicle?.vehicle?.id,
                    vehicleLabel:entity.vehiclePosition.vehicle?.vehicle?.label,
                    position: entity.vehiclePosition.position?(`latitude: ${latitude} longitude: ${longitude}`):(null),
                    currentStatus: entity.vehiclePosition.currentStatus,
                    timestamp: entity.vehiclePosition?.timestamp ?? null,
                    raw: entity.vehiclePosition
                });
            };
            // 3. Process Alert entity
            if (entity.alert) {
                alertUpdates.push({
                    id: entity.id,
                    routeId: entity.alert?.informedEntity?.routeId,
                    cause: entity.alert?.cause,
                    effect: entity.alert?.effect,
                    description: entity.alert?.descriptionText?.translation?.[0]?.text?? "",
                    url: entity.alert?.url?.translation?.[0]?.text ?? "",
                    raw: entity.alert
                });
            };
        });
        console.log("[RT GTFS Service] completed with first item of each rtUpdate feed object: ", 
            tripUpdates[0], vehicleUpdates[0], alertUpdates[0]);
        return { tripUpdates, vehicleUpdates, alertUpdates };
    } catch (err) {
        const errorMessage = err.response
            ? `HTTP Error ${err.response.status} ${err.response.statusText} on GTFS-RT updates fetch`
            : `Network error during GTFS-RT fetch: ${err.message}`
        console.log("[RT GTFS Service] error: ", errorMessage);
        throw new Error(errorMessage);
    }
};

const fetchRealTimeUpdates = async(forceRefresh = false) => {
    const now = Date.now();
    console.log("Timestamp before activating RT fetch: ", now);

    //1. Check cache first
    if(!forceRefresh && cache.data && now - cache.timestamp < cacheDuration ) {
        console.log("[RT GTFS Service] Returning cached RT data (test first item): ", cache.data[0]);
        return {
            data: cache.data,
            timestamp: cache.timestamp,
            source: "cache"
        }
    };

    //2. Fetch RT updates
    try {
        console.log("Fetching new GTFS-RT data due to cache miss or refresh.");
        const updates = await parseRTData();
        // Update cache
        cache.data = updates;
        cache.timestamp = now;

        return {
            data: updates,
            timestamp: now,
            source: "api"
        }
    } catch (err) {
        if (cache.data) {
            console.warn("API fetch failed, returning cache data: ", err);
            return {
                data: cache.data,
                timestamp: cache.timestamp,
                source: "stale_cache"
            };
        };
        console.log("Failed to fetch updated RT-GTFS and no cache is available: ", err)
        throw err;
    }

}

module.exports = { fetchRealTimeUpdates }