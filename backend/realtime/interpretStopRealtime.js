/**
 * Interprets RealtimeFacts specifically for a Stop context
 * Returns extracted RT stop facts into { hasRealtime, summary, stats, facts }
 */
const interpretStopRealtime = ({ stop, realtimeFacts }) => {
    console.log("[Interpret RT STOP]", stop.stop_name, "with number of realtime facts:", realtimeFacts?.length);
    // 1. Handle No data facts
    if (!realtimeFacts || realtimeFacts.length === 0) {
        return {
            hasRealtime: false,
            summary: `No active realtime updates found.`,
            stats: { delayed: 0, early: 0, onTime: 0, cancelled: 0 },
            facts: []
        };
    };

    // 2. Filter realtime facts array on this stop
    const matchedStopFacts = realtimeFacts.filter(
        fact => fact.stopId === stop.stop_id
    );
    console.log(`Found matched realtime fact matched query stop id ${JSON.stringify(matchedStopFacts)}. `);

    if (matchedStopFacts.length === 0) {
        return {
            hasRealtime: true,
            summary: `All trains are currently running on schedule (no active delay alerts) at stop ${stop.stop_name}.`,
            stats: { delayed: 0, early: 0, onTime: 0, cancelled: 0 },
            facts: []
        };
    };

    // 3. Calculate realtime facts' delay status stats
    const stats = { delayed: 0, early: 0, onTime: 0, cancelled: 0 };
    matchedStopFacts.forEach(fact => {
        if (fact.status === "delayed") stats.delayed++;
        else if (fact.status === "early") stats.early++;
        else if (fact.status === "cancelled") stats.cancelled++;
        else stats.onTime++; 
    });

    // 4. Generate a natural language summary
    const total = matchedStopFacts.length;
    let summary = `Tracking ${total} realtime trains events at stop ${stop.stop_name}. `;

    if (stats.delayed > 0) summary += `${stats.delayed} are delayed. `;
    if (stats.early > 0) summary += `${stats.early} are early than schedule. `;
    if (stats.cancelled > 0) summary += `${stats.cancelled} are cancelled. `;
    if (stats.onTime === total) summary += `All trains are running on schedule on ${stop.stop_name}.`;

    return {
        hasRealtime: true,
        summary,
        stats,
        facts: matchedStopFacts
    };
};

module.exports = { interpretStopRealtime };