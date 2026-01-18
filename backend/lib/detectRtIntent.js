/**
 * Utility to detect if a user query requires real-time data integration.
 */

const rt_keywords = [
    "on time", "delay", "late", "now", "where", "status", "update", "track", "live", "right now", "tonight", "next",
    "current", "currently", "position", "cancel", "disruption", "platform", "broken", "running"
];

const detectRtIntent = (queryText) => {
    if (!queryText || typeof queryText !== "string") return false;

    const sanitizedQuery = queryText.toLowerCase().trim();
    const reason = rt_keywords.find(keyword => sanitizedQuery.includes(keyword));
    console.log("Sanitized query in detect rt intent: ", sanitizedQuery, reason);

    const activated = {
        needsRt: Boolean(reason),
        matchedKeyword: reason || null
    }    
    return activated;
}

module.exports = { detectRtIntent }