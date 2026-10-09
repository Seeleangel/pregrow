/**
 * Teacher Routes
 * 教师相关路由
 */

const express = require('express');
const router = express.Router();
const teacherController = require('../controllers/teacher.controller');
const { requireAuth } = require('../middlewares/auth');

// 所有路由需要认证
router.use(requireAuth);

// Get Teacher Profile
router.get('/:id/profile', teacherController.getProfile);
router.patch('/:id/profile', teacherController.updateProfile);
router.post('/:id/avatar/upload', teacherController.uploadAvatar);

// Get Teacher's Class
router.get('/:id/class', teacherController.getClass);
router.patch('/:id/class', teacherController.updateClassInfo);
router.post('/:id/class/invite-code/refresh', teacherController.refreshClassInviteCode);

// Get Students & Analytics Overview
router.get('/:id/class/overview', teacherController.getClassOverview);
router.get('/:id/class/optimism', teacherController.getClassOptimism);
router.get('/:id/class/dream-analytics', teacherController.getClassDreamAnalytics);
router.get('/:id/tasks/completion-summary', teacherController.getTaskCompletionSummary);
router.get('/:id/attention-students', teacherController.getAttentionStudents);
router.post('/:id/tasks/publish', teacherController.publishClassTask);
router.get('/class/obstacles/summary', teacherController.getClassObstaclesSummary);

// Schedule CRUD
router.get('/:id/schedules', teacherController.getSchedules);
router.post('/:id/schedules', teacherController.createSchedule);
router.patch('/:id/schedules/:scheduleId', teacherController.updateSchedule);
router.delete('/:id/schedules/:scheduleId', teacherController.deleteSchedule);
router.patch('/:id/schedules/:scheduleId/toggle', teacherController.toggleScheduleComplete);

module.exports = router;
