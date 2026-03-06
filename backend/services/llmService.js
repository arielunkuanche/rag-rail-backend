const dotenv = require("dotenv");
const { GoogleGenAI } = require("@google/genai");
const { genAiModel } = require("../config/config");
const { sanitizeLLMOutput } = require("../lib/sanitizeLLMOutput");
dotenv.config();

const key = process.env.GEMINI_API_KEY;
const aiClient = key ? new GoogleGenAI({ apiKey: key }) : null;

const buildFallbackResponse = (notes) => ({
    answer: "I encountered a technical error while processing the data.",
    static_context_used: [],
    realtime_context_used: [],
    related_routes: [],
    related_train_numbers_or_groups: [],
    confidence: "low",
    notes: String(notes || "Unknown LLM response error")
});

const normalizeLLMResponse = (parsed) => {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return buildFallbackResponse("LLM output was not a JSON object.");
    }

    const trainRefs =
        parsed.related_train_numbers_or_groups ??
        parsed.related_train_number_or_group ??
        parsed["related_train_number/group"] ??
        [];

    const normalized = {
        answer: typeof parsed.answer === "string" ? parsed.answer : "",
        static_context_used: Array.isArray(parsed.static_context_used) ? parsed.static_context_used : [],
        realtime_context_used: Array.isArray(parsed.realtime_context_used) ? parsed.realtime_context_used : [],
        related_routes: Array.isArray(parsed.related_routes) ? parsed.related_routes : [],
        related_train_numbers_or_groups: Array.isArray(trainRefs) ? trainRefs : [],
        confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
        notes: typeof parsed.notes === "string" ? parsed.notes : ""
    };

    if (!normalized.answer) {
        normalized.answer = "I could not generate a reliable answer from the available context.";
        normalized.confidence = "low";
    }

    return normalized;
};

/**
 * 
 * @param {string} queryText  -  User original query question
 * @param {Array} staticDocs - Array of MongoDB stored GTFS documents
 * @param {Object} realtime - Interpreted realtime object package
 * @returns 
 */
const generateResponse = async(queryText, staticDocs = [], realtime = {}) => {
    if (!aiClient) {
        return buildFallbackResponse("LLM API Key is required.");
    }

    console.log("[LLM Service] received static and RT context:\n ", staticDocs, realtime);

    // 1. Set up time awareness for questions on "next", "now"
    const now = new Date();
    const currentTimeStr = now.toLocaleTimeString("fi-Fi", {
        timeZone: "Europe/Helsinki",
        hour: "2-digit", minute: "2-digit"
    });
    console.log(`[LLM Service] Generating response at ${currentTimeStr}. Static Docs: ${staticDocs.length}, RT Available: ${realtime.hasRealtime}`);

    // 2. Format static documents
    const staticBlock = staticDocs.length > 0 
                    ? staticDocs.map(doc => {
                        const meta = doc.metadata || {};
                        return `[DOC] Type: ${meta?.type}, Info: ${doc.text}`
                    }).join("\n")
                    : "No specific static schedules found."
                        
    // 3. Format Realtime context
    let realtimeBlock = "";
    if (realtime && realtime.hasRealtime) {
        // CASE A: have valid RT data (either delays OR normal service)
        realtimeBlock += `Realtime status: ACTIVE (System online)\n`;
        realtimeBlock += `Realtime summary: ${realtime.summary}\n`;
        realtimeBlock += `Statistics: ${JSON.stringify(realtime.stats)}\n`;

        // If specific facts exist (e.g. specific delayed trains), list them
        if (realtime.facts && realtime.facts.length > 0) {
            realtimeBlock += "Realtime details: \n";
            realtime.facts.forEach(fact => {
                realtimeBlock += `-Route: ${fact.routeId}, Stop: ${fact.stopName}: ${fact.status}`;
                if (fact.delay !== null) {
                    realtimeBlock += ` (${Math.round(fact.delay / 60)} min)`
                }
                realtimeBlock += "\n";
            })
        };
    } else {
        // CASE B: The RT system failed or wasn't requested
        realtimeBlock += `Realtime status: UNAVAILABLE\n`;
        realtimeBlock += `Realtime summary: No active realtime updates available. Assume usage of static schedule only.\n`;
    }

    // 4. Construct system instruction
    const systemInstruction = `
        You are an intelligent railway assistant for Finland (VR/HSL).
        CURRENT TIME ${currentTimeStr} (Helsinki Time).
        Answer user question ONLY using the context provided.

        INSTRUCTIONS:
        1. Answer the user's question using the provided context.
        2. IF Realtime Context says "All trains running on schedule", treat this as a FACT. Do not apologize for lack of data.
        3. IF Realtime Context is "UNAVAILABLE", explicitly state: "Real-time tracking is currently unavailable."
        4. Always cite the Static Context used in the "static_context_used" array. 
        5. Do NOT include markdown or \`\`\` characters.
        
        Use this schema format exactly (JSON ONLY):

        {
            "answer": "string",
            "static_context_used": ["string"],
            "realtime_context_used": ["string"],
            "related_routes": "[string or null]",
            "related_train_numbers_or_groups": ["string"],
            "confidence": "high | medium | low",
            "notes": "string"
        }
    `;

    const userMessage = `
        ==== STATIC CONTEXT ====
        ${staticBlock}

        ==== REALTIME CONTEXT ====
        ${realtimeBlock}

        ==== USER QUERY QUESTION ====
        ${queryText}
    `;

    try {
        console.log("Full prompt structure created. Generating chat response started...\n");
        const chat = aiClient.chats.create({
            model: genAiModel,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json"
            }
        });
        const res = await chat.sendMessage({
            message: userMessage,
        })

        const rawText = res.text|| "";
        console.log("LLM response generated:\n", rawText);

        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (parseErr) {
            const sanitizedResult = sanitizeLLMOutput(rawText);
            console.warn("[LLM Service] raw JSON parse failed, retrying with sanitized output.");
            parsed = JSON.parse(sanitizedResult);
        }

        const finalAnswer = normalizeLLMResponse(parsed);
        console.log("[LLM Service] parse text to final JSON answer object:\n", finalAnswer);
        return finalAnswer;
    } catch (err) {
        console.error(`Error in LLM service while generating response: ${err}` );
        return buildFallbackResponse(err);
    }
}

module.exports = { generateResponse }
