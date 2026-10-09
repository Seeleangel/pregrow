/**
 * AI Routes
 * AI 功能路由
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const aiService = require('../services/aiService');
const { requireAuth } = require('../middlewares/auth');

// 所有路由需要认证
router.use(requireAuth);

// ============================================
// AI Chat (智能问答)
// ============================================

router.post('/chat',
    body('question').trim().isLength({ min: 1, max: 500 }).withMessage('问题长度需在1-500字符之间'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ error: 'invalid_input', message: errors.array()[0].msg });
            }

            const { question, context } = req.body;
            const studentId = req.user.id;

            const result = await aiService.chat(studentId, question, context);
            res.json(result);
        } catch (error) {
            console.error('AI chat error:', error);
            res.status(500).json({ error: 'ai_error', message: 'AI服务暂时不可用' });
        }
    }
);

// ============================================
// Sentiment Analysis (情感分析)
// ============================================

router.post('/sentiment',
    body('text').trim().isLength({ min: 1, max: 1000 }).withMessage('文本长度需在1-1000字符之间'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ error: 'invalid_input', message: errors.array()[0].msg });
            }

            const { text } = req.body;
            const result = await aiService.analyzeSentiment(text);
            res.json(result);
        } catch (error) {
            console.error('Sentiment analysis error:', error);
            res.status(500).json({ error: 'ai_error', message: '情感分析服务暂时不可用' });
        }
    }
);

// ============================================
// Mood Sentiment Analysis (心情记录批量分析)
// ============================================

router.post('/mood/analyze', async (req, res) => {
    try {
        const studentId = req.user.id;
        const result = await aiService.analyzeMoodSentiment(studentId);
        res.json(result);
    } catch (error) {
        console.error('Mood sentiment analysis error:', error);
        res.status(500).json({ error: 'ai_error', message: '心情分析服务暂时不可用' });
    }
});

// ============================================
// AI Suggestions (获取AI建议)
// ============================================

router.get('/suggestions', async (req, res) => {
    try {
        const studentId = req.user.id;
        const { dreamFocus } = req.query;
        const result = await aiService.getSuggestions(studentId, dreamFocus);
        res.json(result);
    } catch (error) {
        console.error('AI suggestions error:', error);
        res.status(500).json({ error: 'ai_error', message: 'AI建议服务暂时不可用' });
    }
});

// ============================================
// AI Comment (获取AI评语)
// ============================================

router.get('/comment', async (req, res) => {
    try {
        const studentId = req.user.id;
        const result = await aiService.getAIComment(studentId);
        res.json(result);
    } catch (error) {
        console.error('AI comment error:', error);
        res.status(500).json({ error: 'ai_error', message: 'AI评语服务暂时不可用' });
    }
});

// ============================================
// Goal Recommendations (获取目标推荐)
// ============================================

router.get('/goals/recommendations', async (req, res) => {
    try {
        const studentId = req.user.id;
        const { dreamFocus, count } = req.query;
        const result = await aiService.getGoalRecommendations(
            studentId,
            dreamFocus,
            parseInt(count) || 3
        );
        res.json(result);
    } catch (error) {
        console.error('Goal recommendations error:', error);
        res.status(500).json({ error: 'ai_error', message: '目标推荐服务暂时不可用' });
    }
});

// ============================================
// Obstacle Suggestion (获取阻碍建议)
// ============================================

router.get('/obstacles/suggestion', async (req, res) => {
    try {
        const studentId = req.user.id;
        const { dreamFocus } = req.query;
        const result = await aiService.getObstacleSuggestion(studentId, dreamFocus);
        res.json(result);
    } catch (error) {
        console.error('Obstacle suggestion error:', error);
        res.status(500).json({ error: 'ai_error', message: '阻碍建议服务暂时不可用' });
    }
});

module.exports = router;
