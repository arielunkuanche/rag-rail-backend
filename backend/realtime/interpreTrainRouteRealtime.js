/**
 * Interprets RealtimeFacts specifically for train/route context
 * Returns extracted RT stop facts into { hasRealtime, summary, stats, facts }
 */
const interpretTrainRouteRealtime = ({ realtimeFacts, routeIds = [], tripIds = [] }) => {
    console.log(
        "[Interpret RT TRAIN/ROUTE]",
        "facts:", realtimeFacts?.length,
        "routes:", routeIds.length,
        "trips:", tripIds.length
    );
    // 1. Handle No data facts
    if (!realtimeFacts || realtimeFacts.length === 0) {
        return {
            hasRealtime: false,
            summary: `No active realtime updates found.`,
            stats: { delayed: 0, early: 0, onTime: 0, cancelled: 0 },
            facts: []
        };
    };

    // 2. Filter realtime facts array related to routeId and tripId
    const matchedFacts = realtimeFacts.filter(fact => 
        (tripIds.length > 0 && tripIds?.includes(fact.tripId)) || 
        (routeIds.length > 0 && routeIds.includes(fact.routeId))
    );
    //console.log(`[Interpret RT TRAIN/ROUTE] Found matched realtime fact matched query ${JSON.stringify(matchedFacts)}. `);

    if (matchedFacts.length === 0) {
        return {
            hasRealtime: true,
            summary: `All monitored trains are currently running on schedule (no active delay alerts).`,
            stats: { delayed: 0, early: 0, onTime: 0, cancelled: 0 },
            facts: []
        };
    };

    // 3. Calculate realtime facts' delay status stats
    const stats = { delayed: 0, early: 0, onTime: 0, cancelled: 0 };
    matchedFacts.forEach(fact => {
        if (fact.status === "delayed") stats.delayed++;
        else if (fact.status === "early") stats.early++;
        else if (fact.status === "cancelled") stats.cancelled++;
        else stats.onTime++; 
    });

    // 4. Generate a natural language summary
    const total = matchedFacts.length;
    let summary = `Tracking ${total} realtime trains events. `;

    if (stats.delayed > 0) summary += `${stats.delayed} are delayed. `;
    if (stats.early > 0) summary += `${stats.early} are early than schedule. `;
    if (stats.cancelled > 0) summary += `${stats.cancelled} are cancelled. `;
    if (stats.onTime === total) summary += `All trains are running on schedule on the route.`;

    return {
        hasRealtime: true,
        summary,
        stats,
        facts: matchedFacts
    };
};

module.exports = { interpretTrainRouteRealtime };