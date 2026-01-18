const { connectDB } = require("../config/db");
const { collectionName } = require("../config/config");

let stopsData = {};
let stopsLoaded = false;

const loadStops = async () => {
    if(stopsLoaded) return stopsData;

    const db = await connectDB();
    const dbCollection = db.collection(collectionName);

    try {
        console.log("[stopService] Loading stop metadata from MongoDB...");
        const stops = await dbCollection.find(
            { "metadata.type": "stop" }, 
            { projection: {_id: 0, embedding: 0} }
        ).toArray();
        console.log("Stops array retrieved from db.");

        stops.forEach(stop => {
            stopsData[stop.metadata.stop_id] = {
                stop_id: stop.metadata.stop_id,
                stop_name: stop.metadata.stop_name,
                stop_lat: stop.metadata.stop_lat,
                stop_lon: stop.metadata.stop_lon
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

const getStopByQuery = (textArray) => {
    console.log("[getStopByQuery] get textArray: ", textArray);
    if (!textArray || textArray.length === 0) return null;

    for (const stopId in stopsData) {
        const stop = stopsData[stopId];
        for (let i = 0; i < textArray.length; i++) {
            if (textArray[i].includes(stop.stop_name.toLowerCase())) {
                console.log("[getStopByQuery] match stop from query: ", stop.stop_name);
                return stop;
            }
        }
    };
    return null;
}

module.exports = { loadStops, getStopById, getStopByName, getStopByQuery }