/**
 * API Response Caching Middleware
 * Provides simple in-memory caching for GET requests
 */

// Simple in-memory cache
const cache = new Map();

/**
 * Cache middleware for Express
 * @param {number} duration - Cache duration in seconds (default: 300 = 5 minutes)
 * @returns {Function} Express middleware
 */
function cacheMiddleware(duration = 300) {
    return (req, res, next) => {
        // Only cache GET requests
        if (req.method !== 'GET') {
            return next();
        }

        // Skip caching for authenticated requests with user-specific data
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            // For user-specific endpoints, use a cache key that includes user ID
            // For now, skip caching authenticated requests
            return next();
        }

        const cacheKey = `${req.originalUrl}`;
        const cached = cache.get(cacheKey);

        if (cached && Date.now() < cached.expiry) {
            // Cache hit
            res.setHeader('X-Cache', 'HIT');
            return res.json(cached.data);
        }

        // Cache miss - override res.json to cache the response
        const originalJson = res.json.bind(res);
        res.json = (data) => {
            cache.set(cacheKey, {
                data,
                expiry: Date.now() + (duration * 1000)
            });
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('Cache-Control', `public, max-age=${duration}`);
            return originalJson(data);
        };

        next();
    };
}

/**
 * Clear cache for a specific pattern or all cache
 * @param {string} pattern - Optional pattern to match cache keys
 */
function clearCache(pattern = null) {
    if (!pattern) {
        cache.clear();
        return;
    }

    for (const key of cache.keys()) {
        if (key.includes(pattern)) {
            cache.delete(key);
        }
    }
}

/**
 * Get cache statistics
 */
function getCacheStats() {
    return {
        size: cache.size,
        keys: Array.from(cache.keys())
    };
}

module.exports = {
    cacheMiddleware,
    clearCache,
    getCacheStats
};
