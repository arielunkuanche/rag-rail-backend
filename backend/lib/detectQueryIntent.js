/** 
 * Detects:
 *   - Exact train numbers (IC 917, Z (HL 9804), PYO 263)
 *   - Train families (A, Z, U, P, S…)
 *   - Stop-level queries
 *   - Route-level queries
 *   - Ambiguous cases
 */

const { getStopByQuery } = require("../services/stopService");

const EXACT_TRAIN_PATTERNS = [
    /\bIC\s?\d+\b/i,
    /\bS\s?\d+\b/i,
    /\bHDM\s?\d+\b/i,
    /\bPYO\s?\d+\b/i,
    /\bHL\s?\d+\b/i,
    /\b[A-Z]\s?\(HL\s*\d+\)\b/i,
];

// Single-letter commuter trains
const TRAIN_FAMILY_PATTERN = /\b([A-Z])\b/;

// words that point to a train being referenced
const TRAIN_KEYWORDS = [ "train", "line", "service", "juna"];

/**
 * Normalize exacted train number formats
 */
const normalizeTrain = (token) => {
    if (!token) return null;
    console.log("token received in normalizeTrain: ", token)

    const normalized = token[0]
        .replace(/\s+/g, " ")
        .replace(/\bIC\s*(\d+)/i, "IC $1")
        .replace(/\bPYO\s*(\d+)/i, "PYO $1")
        .replace(/\bS\s*(\d+)/i, "S $1")
        .replace(/\bHL\s*(\d+)/i, "HL $1")
        .replace(/([A-Z])\s*\(\s*HL\s*(\d+)\s*\)/i, "$1 (HL $2)")
        .trim()
        .toUpperCase();

    return normalized;
}

// Normalize function used for stop detection 
const normalizeWord = (token) => {
    return token.toLowerCase()
        .replace(/[.,?!:;()]/g, "")
        .replace(/\b(station|asema|stop|platform)\b/g, "")
};

const ROUTE_PATTERNS = [
    /from\s+(.+?)\s+to\s+(.+)/i,
    /between\s+(.+?)\s+and\s+(.+)/i,
    /(.+?)\s*→\s*(.+)/,
    /route\s/i
];

/**
 * Attempts to detect exact train identifier
 */
const detectExactTrain = (query) => {
    for (const pattern of EXACT_TRAIN_PATTERNS) {
        const match = query.match(pattern);
        if (match) {
            console.log("Exact train number match object: ", match);
            return normalizeTrain(match);
        }
    }
    return null;
}

/**
 * Detects train family (A, Z, U etc.)
 */
const detectTrainFamily = (query) => {
    const loweredMatch = query.toLowerCase();
    if (!TRAIN_KEYWORDS.some(keyword => loweredMatch.includes(keyword))) {
        return null;
    };

    const match = query.toUpperCase().match(TRAIN_FAMILY_PATTERN);
    if (match) {
        console.log("Train family match found: ", match);
        const family = (match[1] || match[0]).toUpperCase();

        // Reject letter that collide with other words, like A in AT, A BIKE
        if (family.length === 1) return family;
    }
    return null;
}

/**
 * Detect stop intent
 */
const detectStopIntent = (query) => {
    console.log("[Detect query intent] user query falls in detectStopIntent? ", query);
    const wordsArray = query
        .split(/\s+/)
        .map(word => normalizeWord(word))
        .filter(Boolean);

    console.log("[Detect stop intent] words: ", wordsArray);

    // Directly use extracted meaningful stop name to match with DB stops data instead of guessing stop name position in query
    const stop = getStopByQuery(wordsArray);
    if (stop) return stop;

    return null;
}

/**
 * Detect route intent, from X to Y, between A and B
 */
const detectRouteIntent = (query) => {
    for (const pattern of ROUTE_PATTERNS) {
        const match = query.match(pattern);

        if (match) {
            console.log("Route detected intent match found: ", match);
            return {
                origin: match[1].trim(),
                destination: match[2].trim()
            };
        };
        return null;
    }
};

const detectQueryIntent = (queryText) => {
    if (!queryText) return { intent: "general" };

    const query = queryText.trim();

    // 1. Exact train number
    const exact = detectExactTrain(query);
    if (exact) {
        return {
            intent: "train-exact",
            trainNumber: exact
        }
    };

    // 2. Train family
    const family = detectTrainFamily(query);
    if (family) {
        return {
            intent: "train-group",
            trainFamily: family
        }
    };

    // 3. Stop intent goes before route detection
    const stop = detectStopIntent(query);
    if (stop) {
        return {
            intent: "stop",
            stop: stop,
            routeContext: {
                origin: "",
                destination: ""
            } | null
        }
    }

    // 4. Route intent
    const route = detectRouteIntent(query);
    if (route) {
        return {
            intent: "route",
            direction: route
        }
    };

    // 5. Ambiguous train intent 
    if (TRAIN_KEYWORDS.some(keyword => query.toLowerCase().includes(keyword))) {
        return {
            intent: "train-ambiguous"
        }
    };

    // 6. Final fallback
    return {
        intent: "general"
    };

}

module.exports = { detectQueryIntent }
