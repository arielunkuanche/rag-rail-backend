const { MongoClient } = require("mongodb");
const { dbName } = require("./config")

let mongoClient;
let db;

const connectDB = async () => {
    if (db) return db;

    const uri = process.env.MONGODB_URI;
    mongoClient = new MongoClient(uri);

    await mongoClient.connect();
    db = mongoClient.db(dbName);

    console.log("DB connected.")
    return db;
}

module.exports = { connectDB };