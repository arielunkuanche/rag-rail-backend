/**
 * Global Realtime Schema
 * This is the shape that ALL raw GTFS-RT data must be converted into
 * before being passed to any interpreter
 */
const realtimeFactSchema = {
    tripId: null,      // string
    routeId: null,     // string
    //trainNumber: null, // further implementation for trainRetriever
    stopId: null,      // string
    stopName: null,    // string 
    stopSequence: 0,   // number
    delay: null,          // number (positive = late, negative = early)
    status: "on_time", // "early" | "on_time" | "delayed" | "cancelled"
    arrivalDelay: 0,
    departureDelay: 0,
    timestamp: 0,
};

module.exports = { realtimeFactSchema }