/**
 * Routes Index
 * 路由聚合器
 */

const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const studentRoutes = require('./student.routes');
const classRoutes = require('./class.routes');
const challengeRoutes = require('./challenge.routes');
const teacherRoutes = require('./teacher.routes');
const exportRoutes = require('./export.routes');
const notificationRoutes = require('./notification.routes');
const analyticsRoutes = require('./analytics.routes');
const aiRoutes = require('./ai.routes');
const studentController = require('../controllers/student.controller');
const teacherController = require('../controllers/teacher.controller');
const { requireAuth, supabaseAdmin } = require('../middlewares/auth');

// ============================================
// 公开路由 (不需要认证)
// ============================================
router.use('/', authRoutes);                    // /api/register, /api/login

// ============================================
// 受保护路由 (需要认证)
// ============================================

// /api/tasks - 顶级路由
router.get('/tasks', requireAuth, studentController.getTasks);

// /api/students - 教师仪表板
router.get('/students', requireAuth, teacherController.getStudents);

// /api/submissions - 教师仪表板
router.get('/submissions', requireAuth, teacherController.getSubmissions);
router.post('/submissions/:submissionId/review', requireAuth, teacherController.reviewSubmission);
router.post('/submissions/review-batch', requireAuth, teacherController.reviewSubmissionsBatch);

// /api/student/*
router.use('/student', studentRoutes);

// /api/class/*
router.use('/class', classRoutes);

// /api/challenge/*
router.use('/challenge', challengeRoutes);

// /api/teacher/*
router.use('/teacher', teacherRoutes);

// /api/export/*
router.use('/export', exportRoutes);

// /api/notifications/*
router.use('/notifications', notificationRoutes);

// /api/analytics/*
router.use('/analytics', analyticsRoutes);

// /api/ai/*
router.use('/ai', aiRoutes);

// ============================================
// 健康检查端点 (公开)
// ============================================
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: {
            NODE_ENV: process.env.NODE_ENV,
            SUPABASE_URL: process.env.SUPABASE_URL ? 'SET' : 'NOT_SET',
            SUPABASE_KEY: process.env.SUPABASE_KEY ? 'SET' : 'NOT_SET',
            SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? 'SET' : 'NOT_SET',
            SUPABASE_STORAGE_URL: process.env.SUPABASE_STORAGE_URL ? 'SET' : 'NOT_SET',
            ECNU_API_KEY: process.env.ECNU_API_KEY ? 'SET' : 'NOT_SET'
        }
    });
});

// 数据库连接测试端点 (公开)
router.get('/test-db', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('tasks')
            .select('id, title, challenge_category')
            .eq('type', 'challenge')
            .limit(1);

        if (error) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }

        res.json({
            success: true,
            message: 'Database connection successful',
            count: data?.length || 0,
            sample: data?.[0] || null
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
