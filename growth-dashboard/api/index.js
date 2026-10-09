/**
 * Vercel Serverless Function Entry Point
 * 完整的 Express 应用
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// 检查环境变量
if (!process.env.SUPABASE_URL) {
    console.error('SUPABASE_URL is not set in environment variables');
}
if (!process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_KEY is not set in environment variables');
}

// 创建 Express 应用
const app = express();

// 中间件
app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));

// 错误处理中间件
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: '上传文件过大，请压缩后重试（建议不超过 8MB）' });
    }
    if (err) {
        console.error('Request parse error:', err);
        return res.status(400).json({ error: '请求格式错误' });
    }
    next();
});

// 注册 API 路由（使用完整的路由系统）
const routes = require('../backend/routes/index');
app.use('/api', routes);

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Vercel serverless function handler
module.exports = async (req, res) => {
    try {
        // 设置超时为 30 秒
        req.setTimeout(30000);

        // 调用 Express 应用
        return app(req, res);
    } catch (error) {
        console.error('Vercel handler error:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
};
