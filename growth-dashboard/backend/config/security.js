const rateLimit = require('express-rate-limit');

// CORS 白名单配置
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082,http://localhost:19006,http://127.0.0.1:19006,http://localhost:19000,http://127.0.0.1:19000,http://10.0.2.2:3003')
    .split(',')
    .map(origin => origin.trim());

const corsOptions = {
    origin: (origin, callback) => {
        // 允许无 origin 的请求 (如移动应用、Postman、file:// 协议)
        // 注意: file:// 协议的 origin 是字符串 "null"，不是 undefined
        if (!origin || origin === 'null') return callback(null, true);

        // 允许 localhost 上的任意端口（开发环境）
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }

        if (ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400 // 预检请求缓存 24 小时
};

// 通用 Rate Limiter
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 默认 15 分钟
    max: parseInt(process.env.RATE_LIMIT_MAX) || 300, // 每个 IP 在时间窗口内最多 300 请求（APP 首屏需要多个并发请求）
    message: { error: '请求过于频繁，请稍后重试' },
    standardHeaders: true,
    legacyHeaders: false,
    // 跳过健康检查端点
    skip: (req) => req.path === '/health'
});

// 认证专用 Rate Limiter (更严格)
const authLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10, // 每个 IP 最多 10 次登录尝试
    message: { error: '登录尝试过多，请 15 分钟后重试' },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    corsOptions,
    limiter,
    authLimiter,
    ALLOWED_ORIGINS
};
