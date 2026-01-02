/**
 * Shared utility for processing GTFS-RT entities fetched from gtfsRtService.
 * Designed to be used within retrievers to extract specific insights from raw data..
 * Converts raw GTFS-RT TripUpdate objects into clean structured form.
 */
const { getStopInfo } = require("../services/stopService");

// Extracts all stop_time_update for relevant tripUpdates
const extractStopTimeUpdates = (matchedUpdates) => {
    if (!matchedUpdates) return [];

    const results = [];

    if (matchedUpdates.length > 0) {
        matchedUpdates
            .filter(m => m.raw && Array.isArray(m.raw.stopTimeUpdate))
            .forEach(m => {
                const tripId = m.tripId;
                const routeId = m.routeId;

                m.raw.stopTimeUpdate.forEach(stu => {
                    const stopId = stu.stopId || "";
                    const stopInfo = getStopInfo(stopId);
                    
                    // Extract stop info based on RT feed tripUpdates each stopId
                    const stopName = stopInfo?.stop_name || stopId || "(Unknown stop)";
                    const stopLat = stopInfo?.stop_lat || null;
                    const stopLon = stopInfo?.stop_lon || null;

                    const arrival = stu.arrival || null;
                    const departure = stu.departure || null;
                    // Calculate primary delay ?? is safer 
                    const delaySeconds =
                        arrival?.delay ??
                        departure?.delay ??
                        0;

                    // Build a human-readable status for LLM consumption
                    let statusSummary = `Route: ${routeId}, Stop: ${stopName} (sequence is ${stu.stopSequence}): `;
                    if (stu.scheduleRelationship === 'SKIPPED') {
                        statusSummary += "SKIPPED";
                    } else if (delaySeconds > 0) {
                        statusSummary += `Delayed by ${Math.round(delaySeconds / 60)} min (${delaySeconds}s)`;
                    } else if (delaySeconds < 0) {
                        statusSummary += `Early by ${Math.round(Math.abs(delaySeconds) / 60)} min`;
                    } else {
                        statusSummary += "Running on time";
                    }

                    results.push({
                        tripId,
                        routeId,
                        stopId,
                        stopName,
                        stopLat,
                        stopLon,
                        summary: statusSummary,
                        stopSequence: stu.stopSequence,
                        raw: {
                            delay: delaySeconds,
                            arrival: arrival ? {
                                time: arrival.time, // Unix timestamp
                                delay: arrival.delay,
                                uncertainty: arrival.uncertainty
                            } : null,
                            departure: departure ? {
                                time: departure.time,
                                delay: departure.delay,
                                uncertainty: departure.uncertainty
                            } : null,
                            scheduleRelationship: stu.scheduleRelationship,
                        }
                    });
                });
        });
    };

    return results;
};

/**
 * Filters and extracts live updates specifically relevant to a list of Stop IDs.
 * Useful for the routeRetriever when looking for specific station status.
 * * @param {Array} allTripUpdates - The tripUpdates array from gtfsRtService
 * @param {Array<string>} stopIds - Array of stop IDs to match
 * @returns {Array} List of matched updates with extracted stop details
 */
const getUpdatesForStops = (allTripUpdates, stopIds) => {
    if (!allTripUpdates || !stopIds || stopIds.length === 0) return [];

    return allTripUpdates
        .filter(update => 
            update.stopTimeUpdates?.some(stu => stopIds.includes(stu.stopId))
        )
        .map(update => ({
            tripId: update.tripId,
            routeId: update.routeId,
            matchedStops: extractStopTimeUpdates(update)
                .filter(processedStu => stopIds.includes(processedStu.stopId))
        }));
};

/**
 * Formats a list of trip updates into a clean block of text for LLM prompts.
 */
const formatRtAsContext = (processedUpdates) => {
    if (!processedUpdates || processedUpdates.length === 0) return "No real-time delays or updates reported.";
    
    return processedUpdates.map(update => {
        const stopInfo = update.matchedStops.map(s => s.summary).join(", ");
        return `Trip ${update.tripId} (Route ${update.routeId}): ${stopInfo}`;
    }).join("\n");
};

module.exports = {
    extractStopTimeUpdates,
    getUpdatesForStops,
    formatRtAsContext
};