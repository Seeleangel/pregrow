const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 确保加载正确的 .env 文件（仅限本地开发）
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseKey = process.env.SUPABASE_KEY;

// 仅在开发环境输出配置状态
if (process.env.NODE_ENV !== 'production') {
    console.log('Supabase Config - URL:', supabaseUrl ? 'SET' : 'NOT SET');
    console.log('Supabase Config - Service Key:', supabaseServiceKey ? 'SET' : 'NOT SET');
}

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});

// ── Token 验证缓存 ──────────────────────────
// 避免每次请求都发远程 HTTP 调用到 Supabase Auth
const tokenVerifyCache = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const TOKEN_CACHE_MAX = 500;

function getCachedUser(token) {
    const entry = tokenVerifyCache.get(token);
    if (!entry) return null;
    if (Date.now() - entry.ts > TOKEN_CACHE_TTL) {
        tokenVerifyCache.delete(token);
        return null;
    }
    return entry.user;
}

function setCachedUser(token, user) {
    // 防止缓存无限增长
    if (tokenVerifyCache.size > TOKEN_CACHE_MAX) {
        const oldest = tokenVerifyCache.keys().next().value;
        tokenVerifyCache.delete(oldest);
    }
    tokenVerifyCache.set(token, { user, ts: Date.now() });
}

const requireAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '请先登录' });
        }

        const token = authHeader.split(' ')[1];

        // 优先命中缓存，避免远程 HTTP 往返
        const cachedUser = getCachedUser(token);
        if (cachedUser) {
            req.user = cachedUser;
            return next();
        }

        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

        if (error || !user) {
            // 验证失败也从缓存清除
            tokenVerifyCache.delete(token);
            console.error('Auth verification failed:', error?.message);
            return res.status(401).json({ error: '登录已过期，请重新登录' });
        }

        setCachedUser(token, user);
        req.user = user;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error.message);
        res.status(500).json({ error: '认证服务异常' });
    }
};

module.exports = { requireAuth, supabaseAdmin };
