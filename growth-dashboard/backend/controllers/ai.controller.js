/**
 * AI Controller
 * AI 功能控制器
 */

const aiService = require('../services/aiService');

// ============================================
// Suggestions
// ============================================

const getSuggestions = async (req, res) => {
    const { id } = req.params;
    const dreamFocus = String(req.query.dream_focus || '').trim();

    try {
        const result = await aiService.getSuggestions(id, dreamFocus);
        res.json(result);
    } catch (error) {
        console.error('Get suggestions error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Goal Recommendations
// ============================================

const getGoalRecommendations = async (req, res) => {
    const { id } = req.params;
    const dreamFocus = String(req.query.dream_focus || '').trim();
    const count = Math.max(1, Math.min(4, parseInt(req.query.count) || 3));

    try {
        const result = await aiService.getGoalRecommendations(id, dreamFocus, count);
        res.json(result);
    } catch (error) {
        console.error('Get goal recommendations error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// AI Comment
// ============================================

const getAIComment = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await aiService.getAIComment(id);
        res.json(result);
    } catch (error) {
        console.error('Get AI comment error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Obstacle Suggestion
// ============================================

const getObstacleSuggestion = async (req, res) => {
    const { id } = req.params;
    const dreamFocus = String(req.query.dream_focus || '').trim();

    try {
        const result = await aiService.getObstacleSuggestion(id, dreamFocus);
        res.json(result);
    } catch (error) {
        console.error('Get obstacle suggestion error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getSuggestions,
    getGoalRecommendations,
    getAIComment,
    getObstacleSuggestion
};
