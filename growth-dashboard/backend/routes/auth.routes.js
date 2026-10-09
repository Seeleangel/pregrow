/**
 * Auth Routes
 * 认证相关路由
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { registerRules, loginRules } = require('../middlewares/validator');
const { authLimiter } = require('../config/security');
const { supabaseAdmin } = require('../middlewares/auth');

// 注册 (使用认证限流)
router.post('/register', authLimiter, registerRules, authController.register);

// 登录 (使用认证限流)
router.post('/login', authLimiter, loginRules, authController.login);

// Token 刷新 (供前端在无法直连 Supabase 时使用)
router.post('/auth/refresh', async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) {
        return res.status(400).json({ error: 'Missing refresh_token' });
    }
    try {
        const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token });
        if (error) return res.status(401).json({ error: error.message });
        res.json({ session: data.session });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
