/**
 * Analytics Routes
 * 数据统计分析路由
 */

const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const { requireAuth } = require('../middlewares/auth');

// 所有路由需要认证
router.use(requireAuth);

// ============================================
// Analytics
// ============================================

// 学生周对比
router.get('/student/:id/weekly', analyticsController.getWeeklyComparison);

// 学生月对比
router.get('/student/:id/monthly', analyticsController.getMonthlyComparison);

// 目标完成热力图
router.get('/student/:id/heatmap', analyticsController.getGoalHeatmap);

// 班级分布数据 (教师)
router.get('/class/:classId/distribution', analyticsController.getClassDistribution);

// 班级 AI 洞察建议 (教师)
router.get('/class/:classId/insights', analyticsController.getClassInsights);

// 班级词云分析 (教师)
router.get('/class/:classId/word-cloud', analyticsController.getClassWordCloud);

module.exports = router;
