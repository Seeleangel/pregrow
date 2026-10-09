const { LEVEL_RULES } = require('./level-rules');
const { corsOptions, limiter, authLimiter, ALLOWED_ORIGINS } = require('./security');

module.exports = {
    LEVEL_RULES,
    corsOptions,
    limiter,
    authLimiter,
    ALLOWED_ORIGINS
};
