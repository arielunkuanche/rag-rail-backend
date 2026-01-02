/**
 * Cleans and extracts valid JSON from an LLM output string.
 *
 * Handles:
 * - ```json fenced blocks
 * - ``` fenced code blocks
 * - Surrounding non-JSON text
 * - Multiple JSON blocks (keeps the first)
 * - Whitespace and formatting noise
 *
 * Returns a clean JSON string ready for JSON.parse().
 */
const sanitizeLLMOutput = (text) => {
    if(!text || typeof text !== "string") return text;

    let sanitized = text;
    //1. Remove markdown fenced code blocks
    sanitized = sanitized.replace(/```json/gi, "");
    sanitized = sanitized.replace(/```/g, "");

    //2. Trim whitespace
    sanitized = sanitized.trim();
    console.log(`Helper function sanitizeLLMOutput sanitized object before jsonMatch: \n ${sanitized}`);
    //3. Extract first JSON object using regex to prevent extra text before JSON format object
    const jsonMatch = sanitized.match(/\{[\s\S]*?\}/);
    //console.log(`Helper function sanitizeLLMOutput jsonMatch object ${jsonMatch}`);
    
    if(jsonMatch) {
        return jsonMatch[0].trim()
    };

    //4. Else return sanitized JSON
    return sanitized;
}

module.exports = { sanitizeLLMOutput };