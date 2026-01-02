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
                stop_name: stop.metadata.stop_name,
                stop_lat: stop.metadata.lat,
                stop_lon: stop.metadata.lon
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

const getStopInfo = (stopId) => {
    if (!stopsData[stopId]) return `Can't find stop info in database for stop Id ${stopId}.`;

    return stopsData[stopId];
};

module.exports = { loadStops, getStopInfo }