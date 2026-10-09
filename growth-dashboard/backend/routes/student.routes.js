/**
 * Student Routes
 * 学生相关路由
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const studentController = require('../controllers/student.controller');
const aiController = require('../controllers/ai.controller');
const { requireAuth } = require('../middlewares/auth');

// 所有路由需要认证
router.use(requireAuth);

// ============================================
// Onboarding (引导流程)
// ============================================
const onboardingRoutes = require('./onboarding.routes');
router.use('/:id/onboarding', onboardingRoutes);

// ============================================
// Tasks (公开，但需要认证)
// ============================================
router.get('/tasks', studentController.getTasks);

// ============================================
// Mood
// ============================================
router.post('/mood', studentController.submitMood);

// ============================================
// Check-in
// ============================================
router.get('/:id/checkin/status', studentController.getCheckinStatus);
router.post('/:id/checkin', studentController.submitCheckin);

// ============================================
// Growth Stats & Chart
// ============================================
router.get('/:id/growth-stats', studentController.getGrowthStats);
router.get('/:id/growth-chart', studentController.getGrowthChart);

// ============================================
// Student Tasks (Today Plan)
// ============================================
router.get('/:id/tasks', studentController.getStudentTasks);
router.post('/:id/today-plan', studentController.createTodayPlan);
router.delete('/:id/today-plan/:taskId', studentController.deleteTodayPlan);
router.post('/:id/tasks/:taskId/complete', studentController.completeTask);
router.post('/:id/tasks/:taskId/complete-with-evidence', studentController.completeTaskWithEvidence);
router.post('/:id/tasks/:taskId/reopen', studentController.reopenTask);

// ============================================
// Goals
// ============================================
router.get('/:id/goals', studentController.getGoals);
router.post('/:id/goals', studentController.createGoal);
router.post('/:id/goals/:goalId/submit', studentController.submitGoalWithEvidence);
router.patch('/:id/goals/:goalId', studentController.updateGoal);
router.delete('/:id/goals/:goalId', studentController.deleteGoal);

// ============================================
// Multi-Dream Management
// ============================================
router.get('/:id/dreams/overview', studentController.getDreamsOverview);
router.post('/:id/dreams/focus', studentController.setFocusedDream);
router.patch('/:id/dreams/:goalId/status', studentController.updateDreamStatus);
router.patch('/:id/dreams/:goalId/allocation', studentController.updateDreamAllocation);

// ============================================
// Obstacles
// ============================================
router.get('/:id/obstacles', studentController.getObstacles);
router.get('/:id/obstacles/suggestion', aiController.getObstacleSuggestion);
router.post('/:id/obstacles', studentController.createObstacle);
router.patch('/:id/obstacles/:obstacleId', studentController.updateObstacle);
router.delete('/:id/obstacles/:obstacleId', studentController.deleteObstacle);
router.post('/:id/obstacles/:obstacleId/create-task', studentController.createObstacleTask);

// ============================================
// Badges & Sticker Board
// ============================================
router.get('/:id/badges', studentController.getBadges);
router.get('/:id/sticker-board', studentController.getStickerBoard);

// ============================================
// Stats & Milestones
// ============================================
router.get('/:id/stats', studentController.getStats);
router.get('/:id/milestones', studentController.getMilestones);

// ============================================
// AI Features
// ============================================
router.get('/:id/suggestions', aiController.getSuggestions);
router.get('/:id/goal-recommendations', aiController.getGoalRecommendations);
router.get('/:id/ai-comment', aiController.getAIComment);
router.get('/:id/ai-task-suggestions', studentController.getAiTaskSuggestions);

// ============================================
// Profile
// ============================================
router.get('/:id/profile-lite', studentController.getProfileLite);
router.get('/:id/summary', studentController.getSummary);
router.patch('/:id/profile', studentController.updateProfile);
router.post('/:id/avatar/upload', studentController.uploadAvatar);

// ============================================
// Class Join
// ============================================
router.post('/:id/class/join', async (req, res) => {
    const { id } = req.params;
    const { inviteCode } = req.body;

    if (!inviteCode || typeof inviteCode !== 'string') {
        return res.status(400).json({ error: '邀请码格式不正确' });
    }

    try {
        const { supabaseAdmin } = require('../middlewares/auth');
        const { invalidateTeacherCaches } = require('../services/cacheService');

        const { data: classData, error: classError } = await supabaseAdmin
            .from('classes')
            .select('id, school_name, name')
            .eq('invite_code', inviteCode.trim().toUpperCase())
            .single();

        if (classError || !classData) {
            return res.status(404).json({ error: '无效的邀请码，请检查后重试' });
        }

        const { data: updatedProfile, error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({
                class_id: classData.id,
                school_name: classData.school_name,
                class_name: classData.name
            })
            .eq('id', id)
            .select('id, full_name, class_id, school_name, class_name')
            .single();

        if (updateError) throw updateError;

        invalidateTeacherCaches();

        res.json({
            message: '成功加入班级',
            data: updatedProfile,
            classInfo: classData
        });
    } catch (error) {
        console.error('Join class error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
