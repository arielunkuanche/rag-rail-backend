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
        const entityShapeStats = {
            total: 0,
            tripUpdate: 0,
            vehiclePosition: 0,
            vehicle: 0,
            alert: 0
        };
        let firstVehicleEntityKeys = null;
        let firstAlertEntityKeys = null;

        feed.entity.forEach(entity => {
            entityShapeStats.total++;
            if (entity.tripUpdate) entityShapeStats.tripUpdate++;
            if (entity.vehiclePosition) entityShapeStats.vehiclePosition++;
            if (entity.vehicle) entityShapeStats.vehicle++;
            if (entity.alert) entityShapeStats.alert++;

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
            // 2. Process vehicle entity (binding may expose as vehicle or vehiclePosition)
            const vehicleEntity = entity.vehicle || entity.vehiclePosition || null;
            if (vehicleEntity) {
                if (!firstVehicleEntityKeys) firstVehicleEntityKeys = Object.keys(entity);
                vehicleUpdates.push({
                    id: entity.id,
                    tripId: vehicleEntity.trip?.tripId,
                    routeId: vehicleEntity.trip?.routeId,
                    vehicleId: vehicleEntity.vehicle?.id || vehicleEntity.vehicle?.vehicle?.id,
                    vehicleLabel: vehicleEntity.vehicle?.label || vehicleEntity.vehicle?.vehicle?.label,
                    position: vehicleEntity.position
                        ? (`latitude: ${vehicleEntity.position.latitude} longitude: ${vehicleEntity.position.longitude}`)
                        : null,
                    currentStatus: vehicleEntity.currentStatus,
                    timestamp: vehicleEntity?.timestamp ?? null,
                    raw: vehicleEntity
                });
            };
            // 3. Process Alert entity
            if (entity.alert) {
                if (!firstAlertEntityKeys) firstAlertEntityKeys = Object.keys(entity);
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
        console.log("[RT GTFS Service] Feed entity shape stats:", entityShapeStats);
        if (firstVehicleEntityKeys) {
            console.log("[RT GTFS Service] First vehicle entity keys:", firstVehicleEntityKeys);
        }
        if (firstAlertEntityKeys) {
            console.log("[RT GTFS Service] First alert entity keys:", firstAlertEntityKeys);
        }
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

const getRealtimeDiagnostic = async () => {
    try {
        const realtimeResult = await fetchRealTimeUpdates(false);
        const payload = realtimeResult.data || {};

        return {
            status: "ok",
            reachable: true,
            source: realtimeResult.source,
            fetchedAt: realtimeResult.timestamp ? new Date(realtimeResult.timestamp).toISOString() : null,
            cacheAgeMs: realtimeResult.timestamp ? Math.max(0, Date.now() - realtimeResult.timestamp) : null,
            counts: {
                tripUpdates: Array.isArray(payload.tripUpdates) ? payload.tripUpdates.length : 0,
                vehicleUpdates: Array.isArray(payload.vehicleUpdates) ? payload.vehicleUpdates.length : 0,
                alertUpdates: Array.isArray(payload.alertUpdates) ? payload.alertUpdates.length : 0
            }
        };
    } catch (err) {
        return {
            status: "unavailable",
            reachable: false,
            source: "error",
            fetchedAt: null,
            cacheAgeMs: null,
            counts: {
                tripUpdates: 0,
                vehicleUpdates: 0,
                alertUpdates: 0
            },
            error: "GTFS-RT diagnostic fetch failed."
        };
    }
};

module.exports = { fetchRealTimeUpdates, getRealtimeDiagnostic }
