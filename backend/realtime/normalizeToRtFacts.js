/**
 * Shared RT fact schema after fetching GTFS RT feeds from gtfsRtService.
 * Designed to extract specific data facts from RT feeds trip updates
 * Converts raw GTFS-RT TripUpdate objects into clean shared structured schema.
 */
const { getStopById } = require("../services/stopService");

const SCHEDULE_RELATIONSHIP_ENUM = {
    0: "SCHEDULED",
    1: "SKIPPED",
    2: "NO_DATA",
    3: "UNSCHEDULED"
};

const mapScheduleRelationship = (value) => {
    if (typeof value === "number") {
        return SCHEDULE_RELATIONSHIP_ENUM[value] || `UNKNOWN_${value}`;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toUpperCase();
        return normalized || "UNKNOWN";
    }
    return "UNKNOWN";
};

// Extracts all stop_time_update for relevant tripUpdates
const normalizeToRtFacts = (tripUpdates) => {
    if (!tripUpdates || !Array.isArray(tripUpdates)) return [];

    const facts = [];

    tripUpdates.forEach(update => {
        if (!update.raw || !update.raw.stopTimeUpdate) return;

        const tripId = update.tripId;
        const routeId = update.routeId;

        update.raw.stopTimeUpdate.forEach(stu => {
            // RT trip Updates either has stopId or the assigned stopId
            const rawStopId = stu.stopId || stu.stopTimeProperties?.assignedStopId || "";
            if (!rawStopId) return;

            const stopId = rawStopId.split("_")[0];
            const stopInfo = getStopById(stopId);
            
            // Extract stop info based on RT feed tripUpdates each stopId
            const stopName = stopInfo?.stop_name || stopId || "(Unknown stop)";

            const arrival = stu.arrival || null;
            const departure = stu.departure || null;
            // Calculate primary delay ?? is safer 
            const delaySeconds =
                typeof arrival?.delay === "number"
                ? arrival.delay 
                : typeof departure?.delay === "number"
                ? departure.delay
                : null;
            // if (delaySeconds) {
            //     console.log("[normalizeToRtFacts] delay seconds found: ", routeId, stopName, delaySeconds);
            // };
            
            const scheduleRelationshipRaw = stu.scheduleRelationship;
            const scheduleRelationshipLabel = mapScheduleRelationship(scheduleRelationshipRaw);

            let delayCategory = "on_time";
            if (scheduleRelationshipLabel === "SKIPPED") delayCategory = "cancelled";
            else if (scheduleRelationshipLabel === "NO_DATA") delayCategory = "no_data";
            else if (scheduleRelationshipLabel === "UNSCHEDULED") delayCategory = "unscheduled";
            else if (delaySeconds > 60) delayCategory = "delayed";
            else if (delaySeconds < -60) delayCategory = "early";

            facts.push({
                tripId,
                routeId,
                //trainNumber: update.trainNumber, // to get the trainNumber use tripId 
                stopId,
                stopName,
                stopSequence: stu.stopSequence,
                delay: delaySeconds,
                status: delayCategory,
                scheduleRelationshipRaw,
                scheduleRelationshipLabel,
                arrivalDelay: stu.arrival?.delay || null,
                departureDelay: stu.departure?.delay || null,
                timestamp: Date.now()
            });
        });
    });

    return facts;
};

module.exports = { normalizeToRtFacts };
