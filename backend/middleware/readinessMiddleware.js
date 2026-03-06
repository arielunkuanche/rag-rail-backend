const getReadinessChecks = (state) => ({
    envValidated: Boolean(state.envValidated),
    dbConnected: Boolean(state.dbConnected),
    stopsLoaded: Boolean(state.stopsLoaded)
});

const isReady = (state) => {
    const checks = getReadinessChecks(state);
    return checks.envValidated && checks.dbConnected && checks.stopsLoaded;
};

const healthHandler = (state) => (req, res) => {
    res.status(200).json({
        status: "ok",
        service: "finnish-railway-rag-backend",
        uptimeSec: Math.floor(process.uptime()),
        startedAt: state.bootStartedAt || null
    });
};

const readyHandler = (state) => (req, res) => {
    const checks = getReadinessChecks(state);
    const ready = isReady(state);

    res.status(ready ? 200 : 503).json({
        status: ready ? "ready" : "not_ready",
        checks,
        lastBootError: state.lastBootError || null
    });
};

const requireReady = (state) => (req, res, next) => {
    if (isReady(state)) return next();

    return res.status(503).json({
        error: "Service not ready",
        checks: getReadinessChecks(state),
        lastBootError: state.lastBootError || null
    });
};

module.exports = {
    healthHandler,
    readyHandler,
    requireReady
};
