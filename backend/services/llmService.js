const dotenv = require("dotenv");
const { GoogleGenAI } = require("@google/genai");
const { genAiModel } = require("../config/config");
const { sanitizeLLMOutput } = require("../lib/sanitizeLLMOutput");
dotenv.config();

const key = process.env.GEMINI_API_KEY;
if(!key) throw new Error("LLM API Key is required.")

const aiClient = new GoogleGenAI({ apiKey: key });

const generateResponse = async(queryText, staticDocs = [], realtime = {}) => {
    console.log("[LLM Service] received static and RT context:\n ", staticDocs, realtime);
    const systemInstruction = `
        You are an expert AI assistant for Finnish railway information.
        Answer user question ONLY using the context provided.

        You MUST return ONLY valid JSON. 
        Do NOT include markdown or \`\`\` characters.
        Use this schema exactly:

        {
            "answer": "string",
            "static_context_used": ["string"],
            "realtime_context_used": ["string"],
            "related_routes": "[string or null]",
            "related_train_number/group": ["string"],
            "confidence": "high | medium | low",
            "notes": "string"
        }

        If the realtime context is empty:
        - DO NOT say you cannot determine the current situation of user question.
        - Firstly explain clearly that no active real-time data updated for this train/route at the moment.
        - Then provide a fallback answer using static context.
    `;

    const staticBlock = staticDocs
                        .map(doc => `[${doc.metadata.type}] -> ${doc.text}`)
                        .join("\n---\n");
    const realtimeBlock = realtime && realtime.summary
                        ? JSON.stringify(realtime.summary)
                        : "No realtime data available";

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
            }
        });
        const res = await chat.sendMessage({
            message: userMessage,
        })

        const rawText = res.text|| "";
        console.log("LLM response generated:\n", rawText);

        //const sanitizedResult = sanitizeLLMOutput(rawText);
        //console.log("Sanitized LLM JSON string:\n", sanitizedResult);
        //const finalAnswer = JSON.parse(sanitizedResult);

        const finalAnswer = JSON.parse(rawText);
        return finalAnswer;
    } catch (err) {
        console.error(`Error in LLM service while generating response: ${err}` );
        return {
            answer: "I could not generate a reliable answer from the context.",
            static_context_used: [],
            realtime_context_used: [],
            related_routes: [],
            related_train_number_or_group: [],
            confidence: "low",
            notes: String(err)
        };
    }
}

module.exports = { generateResponse }