/**
 * RAG service centrally handle fetched retrieval package and pass to LLM
→ detect intent
→ pick the correct retriever  
→ retriever returns results  
→ ragService feeds combined context to LLM  
→ ragService returns final JSON to the client
 */

const { detectQueryIntent } = require("../lib/detectQueryIntent");
const { generateResponse } = require("./llmService");
const { handleTrainExact, handleTrainGroup } = require("./retrievers/trainRetriever");
const { routeRetriever } = require("./retrievers/routeRetriever");
const { stopRetriever } = require("./retrievers/stopRetriever");

const getRagResults =  async(queryText) => {
    const startTime = Date.now().toString();
    console.log("[RAG SERVICE] started and received user query at: ", queryText, startTime);

    try {
        const intent = detectQueryIntent(queryText);
        console.log("[RAG SERVICE] Detected intent: ", intent);

        let retrieval;
        switch (intent.intent) {
            case "train-exact":
                retrieval = await handleTrainExact(queryText, intent);
                //console.log("[RAG SERVICE] received exact retrieval: ", retrieval);
                break;
            case "train-group":
                retrieval = await handleTrainGroup(queryText, intent);
                //console.log("[RAG SERVICE] received group retrieval: ", retrieval);
                break;
            case "train-ambiguous":
                return {
                    query: queryText,
                    answer:
                        "I found multiple possible trains. Please specify the full train number, such as IC 917 or Z (HL 9804).",
                    type: "clarification"
                };
            case "route":
                retrieval = await routeRetriever(queryText, intent);
                //console.log("[RAG SERVICE] received route retrieval: ", retrieval);
                break;
            case "stop":
                retrieval = await stopRetriever(queryText, intent);
                //console.log("[RAG SERVICE] received stop retrieval: ", retrieval);
                break;
            default: 
                return {
                    query: queryText,
                    answer: "I could't determine what you are asking. Try mention specific train number, route or stop.",
                    type: "error"
                }
        };

        // Pass retrieval object to LLM to generate augmented response
        const llmResponse = await generateResponse(
            queryText,
            retrieval.staticDocs,
            retrieval.realtime || {},
            retrieval.retrievalStatus || { code: "OK", message: "" }
        );
        const data = {
            intent: intent.intent,
            answer: llmResponse
        };
        console.log("[RAG SERVICE] returned LLM response data: \n", data.answer);

        return data;
    } catch (err) {
        console.error(`Error in RAG service: ${err}` );
        throw new Error(`Failed to augment answer: ${err || "Unknown RAG process error"}`);
    }

}

module.exports = { getRagResults }
