const { connectDB } = require("../config/db");
const { collectionName, vectorIndex } = require("../config/config");
//const { pipeline } = require("@huggingface/transformers");

const vectorSearch = async (queryEmbedding, options ={}) => {
    if(!queryEmbedding || queryEmbedding.length === 0) throw new Error("User query embedding is empty or invalid.");
    
    //console.log("Vector search get filter: ", options);
    try {
        
        // Set up filter and search limits
        const { limit = 5, filter = {}, minScore = 0.7 } = options;

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
                    'filter': filter
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
        console.log(`Vector search return ${rawResults.length} candidates for re-ranking.\n`);
        //console.log(`\nExample rawResults from vectorSearch before re-ranking:\n`, JSON.stringify(rawResults).join("\n"));
        return rawResults;
        // const finalResults = [];

        // // Track unique canonical IDs to prevent duplicated patterns
        // const uniquePatternIds = new Set();
        // // Define target counts for diversity 
        // const targetTypeCounts = {
        //     'stop': Math.floor(limit * 0.2),
        //     'route': Math.floor(limit * 0.2),
        //     'trip_pattern': limit,
        // };
        // const currentTypeCounts = { 'stop': 0, 'route': 0, 'trip_pattern': 0 };
        
        // for (const doc of rawResults) {
        //     const docType = doc.metadata?.type;
        //     const canonicalId = doc.metadata?.canonical_id || doc._id.toString();

        //     if (finalResults.length >= limit) break;
        //     if(uniquePatternIds.has(canonicalId)) continue;
        //     uniquePatternIds.add(canonicalId)
        //     console.log(`vectorSearch uniquePatternIds:\n ${uniquePatternIds}`);

        //     // Diversity check
        //     if (docType && currentTypeCounts[docType] !== undefined) {
        //         if (currentTypeCounts[docType] < targetTypeCounts[docType] || docType === 'trip_pattern') {
        //             finalResults.push(doc);
        //             currentTypeCounts[docType]++;
        //         }
        //     } else {
        //         finalResults.push(doc);
        //     }
        // };
        // console.log(`Vector search final results after re-ranking:`, JSON.stringify(finalResults));
        // console.log(`Diversity re-ranking complete, returning ${finalResults.length} documents. Final composition: `, currentTypeCounts);
        // return finalResults;
    } catch (err) {
        console.error(err?.message || err );
        throw new Error(`Vector search failed: ${err.message || "Unknown DB error"}`);
    }
}

module.exports = { vectorSearch };