const shouldIncludeDetails = () => process.env.NODE_ENV !== "production";

const buildPublicDetails = (err) => {
    if (!shouldIncludeDetails()) {
        return undefined;
    }

    if (err?.details && typeof err.details === "object" && !Array.isArray(err.details)) {
        return err.details;
    }

    return {
        name: err?.name || "Error",
        code: err?.code || "INTERNAL_SERVER_ERROR",
        status: err?.status || 500
    };
};

const buildErrorResponse = ({
    code = "INTERNAL_SERVER_ERROR",
    message = "Something went wrong.",
    requestId = null,
    details = undefined,
    extra = undefined
}) => {
    const response = {
        code,
        message,
        requestId
    };

    if (shouldIncludeDetails() && details !== undefined) {
        response.details = details;
    }

    if (extra && typeof extra === "object") {
        Object.assign(response, extra);
    }

    return response;
};

const sendErrorResponse = (res, {
    status = 500,
    code,
    message,
    requestId = null,
    details = undefined,
    extra = undefined
}) => res.status(status).json(buildErrorResponse({
    code,
    message,
    requestId,
    details,
    extra
}));

const errorResponseMiddleware = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    console.error("Error detected in error handler:", err?.stack || err);

    return sendErrorResponse(res, {
        status: err?.status || 500,
        code: err?.code || "INTERNAL_SERVER_ERROR",
        message: err?.message || "Something broke.",
        requestId: req?.requestId || null,
        details: buildPublicDetails(err)
    });
};

module.exports = {
    buildErrorResponse,
    sendErrorResponse,
    errorResponseMiddleware
};
