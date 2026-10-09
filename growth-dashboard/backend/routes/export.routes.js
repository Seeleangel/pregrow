/**
 * Export Routes
 * 数据导出路由
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const exportController = require('../controllers/export.controller');
const { requireAuth } = require('../middlewares/auth');

// 所有路由需要认证
router.use(requireAuth);

// ============================================
// Export
// ============================================

// 导出学生成长报告 (学生用)
router.get('/student/:id/report', exportController.exportStudentReport);

// 导出班级报告 (教师用)
router.get('/class/:classId/report', exportController.exportClassReport);

module.exports = router;
