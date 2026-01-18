/**
 * Shared RT fact schema after fetching GTFS RT feeds from gtfsRtService.
 * Designed to extract specific data facts from RT feeds trip updates
 * Converts raw GTFS-RT TripUpdate objects into clean shared structured schema.
 */
const { getStopById } = require("../services/stopService");

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
            
            let delayCategory = "on_time";
            // console.log("[normalizeToRtFacts] stopTimeUpdate schedule relationship: ", stu.scheduleRelationship); // stu.scheduleRelationship is 0 or 1
            if (stu.scheduleRelationship === 'SKIPPED') delayCategory = "cancelled";
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
                arrivalDelay: stu.arrival?.delay || null,
                departureDelay: stu.departure?.delay || null,
                timestamp: Date.now()
            });
        });
    });

    return facts;
};

module.exports = { normalizeToRtFacts };