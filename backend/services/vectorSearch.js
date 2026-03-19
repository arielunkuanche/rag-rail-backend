const { connectDB } = require("../config/db");
const { collectionName, vectorIndex } = require("../config/config");
//const { pipeline } = require("@huggingface/transformers");

const parseMinScore = (optionsMinScore) => {
    const optionScore = Number(optionsMinScore);
    const envScore = Number(process.env.VECTOR_MIN_SCORE);
    const candidate = Number.isFinite(optionScore)
        ? optionScore
        : (Number.isFinite(envScore) ? envScore : 0.7);

    return Math.max(0, Math.min(1, candidate));
};

const buildDedupeKey = (doc, keyFields = []) => {
    const metadata = doc?.metadata || {};
    if (keyFields.length > 0) {
        const values = keyFields.map(field => String(metadata[field] || "").trim());
        const hasAllValues = values.every(Boolean);
        if (hasAllValues) return values.join("||");
    }

    return String(metadata.canonical_id || doc?._id || "");
};

const applyDedupe = (docs, dedupe = {}) => {
    if (!dedupe?.enabled) return docs;

    const keyFields = Array.isArray(dedupe.keyFields) ? dedupe.keyFields : [];
    const typeSet = Array.isArray(dedupe.applyTypes) && dedupe.applyTypes.length > 0
        ? new Set(dedupe.applyTypes)
        : null;

    const keptByKey = new Map();
    const passThrough = [];

    for (const doc of docs) {
        const docType = doc?.metadata?.type;

        // Keep non-target types untouched when type scoping is enabled.
        if (typeSet && !typeSet.has(docType)) {
            passThrough.push(doc);
            console.log("[Vector Search] passThrough typeSet: ", passThrough);
            continue;
        }

        const dedupeKey = buildDedupeKey(doc, keyFields);
        console.log("[Vector Search] built dedupe keys: ", dedupeKey);
        if (!dedupeKey) {
            passThrough.push(doc);
            continue;
        }

        const current = keptByKey.get(dedupeKey);
        console.log("[Vector Search] keptByKey values: ", current);
        if (!current || doc.score > current.score) {
            keptByKey.set(dedupeKey, doc);
        }
    }

    console.log("[Vector Search] post-dedupe results: ", passThrough, keptByKey.values());
    return [...passThrough, ...keptByKey.values()].sort((a, b) => b.score - a.score);
};

const vectorSearch = async (queryEmbedding, options ={}) => {
    if(!queryEmbedding || queryEmbedding.length === 0) throw new Error("User query embedding is empty or invalid.");
    
    //console.log("Vector search get filter: ", options);
    try {
        
        // Set up filter and search limits
        const { limit = 5, filter = {}, dedupe = {} } = options;
        const minScore = parseMinScore(options.minScore);

        const db = await connectDB();
        const dbCollection = db.collection(collectionName);

        // Retrieve a higher number of candidates to ensure enough diversity across all documents
        const searchCandidatesLimit = limit * 3;

        let pipeline = [];
        
        pipeline.push(
            {
                '$vectorSearch': {
                    'queryVector': queryEmbedding,
                    'path': 'embedding',
                    'numCandidates': 4000,
                    'limit': searchCandidatesLimit,
                    'index': vectorIndex,
                    'filter': filter,
                    minScore
                }
            },
            {
                '$project': {
                    // Include the source text and metadata fields
                    'text': 1,
                    "metadata": 1,
                    'score': { '$meta': 'vectorSearchScore' }
                }
            }
        );

        console.log("Vector search pipeline assembled: ", pipeline);

        const rawResults = await dbCollection.aggregate(pipeline).toArray();

        console.log("[Vector Search] raw candidates: ", rawResults);

        // Defensive threshold and shape enforcement before returning to retrievers.
        const filteredResults = rawResults
            .map(doc => ({ ...doc, score: Number(doc?.score) }))
            .filter(doc => Number.isFinite(doc.score) && doc.score >= minScore)
            .sort((a, b) => b.score - a.score);

        //console.log("[Vector Search] filter candidates: ", filteredResults);

        const dedupedResults = applyDedupe(filteredResults, dedupe);
        const finalResults = dedupedResults.slice(0, limit);

        console.log(
            `[Vector Search] candidates raw=${rawResults.length}, passedMinScore=${filteredResults.length}, deduped=${dedupedResults.length}, minScore=${minScore}, limit=${limit}`
        );

        return finalResults;
    } catch (err) {
        console.error(err?.message || err );
        throw new Error(`Vector search failed: ${err.message || "Unknown DB error"}`);
    }
}

module.exports = { vectorSearch };