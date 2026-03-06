const { connectDB } = require("../config/db");
const { collectionName } = require("../config/config");

let stopsData = {};
let stopsLoaded = false;
let stopNameIndex = new Map();
let maxStopNameTokens = 1;

const loadStops = async () => {
    if(stopsLoaded) return stopsData;

    const db = await connectDB();
    const dbCollection = db.collection(collectionName);

    try {
        console.log("[stopService] Loading stop metadata from MongoDB...");
        stopsData = {};
        stopNameIndex = new Map();
        maxStopNameTokens = 1;

        const stops = await dbCollection.find(
            { "metadata.type": "stop" }, 
            { projection: {_id: 0, embedding: 0} }
        ).toArray();
        console.log("Stops array retrieved from db.");

        stops.forEach(stop => {
            const stopObject = {
                stop_id: stop.metadata.stop_id,
                stop_name: stop.metadata.stop_name,
                stop_lat: stop.metadata.stop_lat,
                stop_lon: stop.metadata.stop_lon
            };
            stopsData[stop.metadata.stop_id] = stopObject;

            const normalizedStopName = normalizeStopText(stopObject.stop_name);
            if (normalizedStopName && !stopNameIndex.has(normalizedStopName)) {
                stopNameIndex.set(normalizedStopName, stopObject);
                // Get characters each stop name has
                const tokenCount = normalizedStopName.split(" ").length;
                if (tokenCount > maxStopNameTokens) maxStopNameTokens = tokenCount;
            }
        });

        stopsLoaded = true;
        console.log(`[stopService] Loaded ${Object.keys(stopsData).length} stops.`);
        return stopsData;
    } catch (err) {
        console.error(`Error in loading stops data: ${err}` );
        throw new Error(`Stop service failed to load GTFS stops data: ${err}`);
    }
};

const getStopById = (stopId) => {
    if (!stopsData[stopId]) return null;

    return stopsData[stopId];
};

const getStopByName = (stopName) => {
    if (!stopName) return null;

    for (const stopId in stopsData) {
        const stop = stopsData[stopId];
        if (stop.stop_name && stop.stop_name.toLowerCase().includes(stopName.toLowerCase())) {
            console.log("[getStopByName] found stop object from DB: ", stop);
            return stop;
        };
        
    };
    return null;
};

const normalizeStopText = (text) => {
    if (!text || typeof text !== "string") return "";

    return text
        .toLowerCase()
        .replace(/[.,?!:;()]/g, "")
        .replace(/\b(station|asema|stop|platform)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
};

const getStopByQuery = (queryText) => {
    console.log("[getStopByQuery] get queryText: ", queryText);
    // normalize again to ensure the query text format
    const normalizedQuery = normalizeStopText(queryText);
    if (!normalizedQuery) return null;

    // Only having stop's name from query text as completely matched after normalization, like jyväskylä 
    if (stopNameIndex.has(normalizedQuery)) {
        const exactStop = stopNameIndex.get(normalizedQuery);
        console.log("[getStopByQuery] exact stop match from query: ", exactStop.stop_name);
        return exactStop;
    }

    // Cases when normalized query text has other character tokens
    const tokens = normalizedQuery.split(" ").filter(Boolean);
    const maxN = Math.min(maxStopNameTokens, tokens.length);

    // Longest-phrase-first lookup to prefer specific stop names over short overlaps.
    for (let n = maxN; n >= 1; n--) {
        for (let i = 0; i <= tokens.length - n; i++) {
            const phrase = tokens.slice(i, i + n).join(" ");
            if (stopNameIndex.has(phrase)) {
                const matchedStop = stopNameIndex.get(phrase);
                console.log("[getStopByQuery] phrase stop match from query: ", matchedStop.stop_name);
                return matchedStop;
            }
        }
    }

    return null;
}

module.exports = { loadStops, getStopById, getStopByName, getStopByQuery }
