/**
 * Performance Monitoring Middleware
 * Tracks request timing and provides performance headers
 */

// Simple performance tracking
const requestStats = {
    totalRequests: 0,
    slowRequests: 0,
    averageResponseTime: 0,
    endpoints: new Map()
};

/**
 * Performance monitoring middleware
 * Adds timing headers and tracks slow requests
 */
function performanceMiddleware(req, res, next) {
    const start = Date.now();
    const startMemory = process.memoryUsage();

    // Override res.end to capture timing
    const originalEnd = res.end.bind(res);
    res.end = function(...args) {
        const duration = Date.now() - start;
        const endMemory = process.memoryUsage();
        const memoryDiff = endMemory.heapUsed - startMemory.heapUsed;

        // Streaming/static responses may have already sent their headers.
        if (!res.headersSent) {
            res.setHeader('X-Response-Time', `${duration}ms`);
            if (process.env.NODE_ENV === 'development') {
                res.setHeader('X-Memory-Delta', `${Math.round(memoryDiff / 1024)}KB`);
            }
        }

        // Track statistics
        requestStats.totalRequests++;
        const oldAvg = requestStats.averageResponseTime;
        requestStats.averageResponseTime =
            (oldAvg * (requestStats.totalRequests - 1) + duration) / requestStats.totalRequests;

        if (duration > 1000) {
            requestStats.slowRequests++;
            console.warn(`[PERFORMANCE] Slow request: ${req.method} ${req.path} took ${duration}ms`);
        }

        // Track per-endpoint stats
        const key = `${req.method} ${req.route?.path || req.path}`;
        if (!requestStats.endpoints.has(key)) {
            requestStats.endpoints.set(key, { count: 0, totalTime: 0, slowCount: 0 });
        }
        const stats = requestStats.endpoints.get(key);
        stats.count++;
        stats.totalTime += duration;
        if (duration > 1000) stats.slowCount++;

        return originalEnd(...args);
    };

    next();
}

/**
 * Get performance statistics
 */
function getPerformanceStats() {
    const endpointStats = {};
    requestStats.endpoints.forEach((value, key) => {
        endpointStats[key] = {
            ...value,
            averageTime: Math.round(value.totalTime / value.count)
        };
    });

    return {
        totalRequests: requestStats.totalRequests,
        slowRequests: requestStats.slowRequests,
        slowRequestRate: requestStats.totalRequests > 0
            ? (requestStats.slowRequests / requestStats.totalRequests * 100).toFixed(2) + '%'
            : '0%',
        averageResponseTime: Math.round(requestStats.averageResponseTime),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        endpoints: endpointStats
    };
}

/**
 * Reset performance statistics
 */
function resetPerformanceStats() {
    requestStats.totalRequests = 0;
    requestStats.slowRequests = 0;
    requestStats.averageResponseTime = 0;
    requestStats.endpoints.clear();
}

module.exports = {
    performanceMiddleware,
    getPerformanceStats,
    resetPerformanceStats
};
