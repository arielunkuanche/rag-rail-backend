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

/** 
 * High-confidence commuter-train family phrasing only. 
 * 
*/
const TRAIN_FAMILY_CONTEXT_PATTERNS = [
    /\bline\s+([A-Z])\b/i,
    /\b([A-Z])\s+line\b/i,
    /\b([A-Z])\s+train\b/i,
    /\bcommuter\s+([A-Z])\b/i,
    /\blocal\s+([A-Z])\b/i,
    /\btrain\s+([A-Z])\b(?:\s*(?:line|service|route))?(?:\s*[?.!,]|$)/i
];

/**
 * words that point to a train being referenced
 */
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

/**
 * Route intent patterns with require keywords define
 */
const ROUTE_CUE_PATTERN = /\b(from|between|to)\b/i;
const ROUTE_PATTERNS = [
    { pattern: /from\s+(.+?)\s+to\s+(.+)/i, requireRouteKeyword: false },
    { pattern: /between\s+(.+?)\s+and\s+(.+)/i, requireRouteKeyword: false },
    { pattern: /(.+?)\s*→\s*(.+)/, requireRouteKeyword: false },
    { pattern: /\b([A-Za-zÅÄÖåäö][A-Za-zÅÄÖåäö'-]*)\s*-\s*([A-Za-zÅÄÖåäö][A-Za-zÅÄÖåäö'-]*)\b/, requireRouteKeyword: true }
];
const ROUTE_KEYWORDS = ["route", "line", "travel", "direct"];

/**
 * Stop Intent route direction cue patterns
 */
const STOP_ROUTE_CONTEXT_CUE_PATTERNS = [
    /\b(?:travel|go|get|reach|head|move)\s+(?:to|toward|towards)\s+([A-Za-zÅÄÖåäö][A-Za-zÅÄÖåäö' -]{1,60})/i,
    /\b(?:to|toward|towards)\s+([A-Za-zÅÄÖåäö][A-Za-zÅÄÖåäö' -]{1,60})/i,
    /\b(?:how\s+to\s+get\s+to|how\s+to\s+reach)\s+([A-Za-zÅÄÖåäö][A-Za-zÅÄÖåäö' -]{1,60})/i
];
const STOP_ROUTE_CONTEXT_TRAILING_FILLER_PATTERN = /\b(now|today|tonight|please|right now|currently)\b.*$/i;
const STOP_ROUTE_CONTEXT_LEADING_NOISE_PATTERN = /^(?:to|toward|towards|travel|go|get|reach|head|move)\s+/i;

// Normalize function used for stop detection 
const normalizeWord = (token) => {
    return token.toLowerCase()
        .replace(/[.,?!:;()]/g, "")
        .replace(/\b(station|asema|stop|platform)\b/g, "")
};

/**
 * 
 * Steps to extract direction from stop intent
 */
const normalizeLocationPhrase = (value = "") => value
    .split(/\s+/)
    .map(token => normalizeWord(token))
    .filter(Boolean)
    .join(" ");

const toTitleCase = (value = "") => value.replace(/\b\w/g, char => char.toUpperCase());

const extractStopRouteContext = (query, stop) => {
    if (!stop?.stop_name) return null;

    let destinationMatch = null;
    for (const cuePattern of STOP_ROUTE_CONTEXT_CUE_PATTERNS) {
        const match = query.match(cuePattern);
        if (match && match[1]) {
            destinationMatch = match;
            break;
        }
    }
    if (!destinationMatch || !destinationMatch[1]) return null;

    console.log("[Intent:StopRouteContext] Found matched destination: ", destinationMatch);
    const rawDestination = destinationMatch[1]
        .replace(STOP_ROUTE_CONTEXT_TRAILING_FILLER_PATTERN, "")
        .replace(STOP_ROUTE_CONTEXT_LEADING_NOISE_PATTERN, "")
        .replace(STOP_ROUTE_CONTEXT_LEADING_NOISE_PATTERN, "")
        .trim();
    const normalizedDestination = normalizeLocationPhrase(rawDestination);
    const normalizedStopName = normalizeLocationPhrase(stop.stop_name);
    if (!normalizedDestination || normalizedDestination === normalizedStopName) return null;

    return {
        destination: toTitleCase(normalizedDestination)
    };
};

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
        console.log("[Intent:TrainFamilyGate] skipped: no train keyword");
        return null;
    };

    for (const pattern of TRAIN_FAMILY_CONTEXT_PATTERNS) {
        const match = query.match(pattern);
        if (!match) continue;

        console.log("[Intent:TrainFamilyMatch] Found matched pattern: ", match);
        const family = (match[1] || "").trim().toUpperCase();
        if (family.length !== 1) continue;

        console.log("[Intent:TrainFamily] accepted: family match:", { family, pattern: pattern.toString(), match });
        return family;
    };

    console.log("[Intent:TrainFamily] rejected: no high-confidence family phrasing");
    return null;
}

/**
 * Detect stop intent
 */
const detectStopIntent = (query) => {
    const normalizedQuery = query
        .split(/\s+/)
        .map(word => normalizeWord(word))
        .filter(Boolean)
        .join(" ");

    console.log("[Detect stop intent] normalized query: ", normalizedQuery);

/**
 * Directly use extracted meaningful stop name to match with DB stops data instead of guessing stop name position in query
 */
    const stop = getStopByQuery(normalizedQuery);
    if (stop) return stop;

    return null;
}

/**
 * Detect route intent, from X to/-> Y, between A and B
 */
const detectRouteIntent = (query) => {
    const lowered = query.toLowerCase();
    const hasRouteKeyword = ROUTE_KEYWORDS.some(keyword => lowered.includes(keyword));

    for (const routePattern of ROUTE_PATTERNS) {
        if (routePattern.requireRouteKeyword && !hasRouteKeyword) continue;
        const match = query.match(routePattern.pattern);

        if (match && match[1] && match[2]) {
            console.log("Route detected intent match found: ", match);
            return {
                origin: match[1].trim(),
                destination: match[2].trim()
            };
        };
    }
    return null;
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

    // 2. Detect explicit route direction first (from X to Y / between A and B / A → B)
    // to avoid route queries being misclassified as stop intent.
    const route = detectRouteIntent(query);
    const stop = detectStopIntent(query);
    const hasRouteCue = ROUTE_CUE_PATTERN.test(query);
    console.log("[Intent:RouteStopArbitration] state:", {
        hasRouteCue,
        routeDetected: !!route,
        stopDetected: !!stop
    });

    if (route) {
        console.log("[Intent:FinalDecision] route");
        return {
            intent: "route",
            direction: route,
            stopContext: stop || null
        }
    };

    // 3. Train family with high-confidence phrasing
    // If route cue words are present but route extraction failed, do not force train-group.
    const family = detectTrainFamily(query);
    if (family && !hasRouteCue) {
        console.log("[Intent:FinalDecision] train-group");
        return {
            intent: "train-group",
            trainFamily: family
        }
    };

    // 4. Stop intent
    if (stop) {
        const routeContext = extractStopRouteContext(query, stop);
        console.log("[Intent:FinalDecision] stop");
        return {
            intent: "stop",
            stop: stop,
            routeContext
        }
    }

    // 5. Ambiguous train intent 
    if (TRAIN_KEYWORDS.some(keyword => query.toLowerCase().includes(keyword))) {
        console.log("[Intent:TrainAmbiguous] train keywords present but no exact/group/route-stop resolution");
        console.log("[Intent:FinalDecision] train-ambiguous");
        return {
            intent: "train-ambiguous"
        }
    };

    // 6. Final fallback
    console.log("[Intent:FinalDecision] general");
    return {
        intent: "general"
    };

}

module.exports = { detectQueryIntent }
