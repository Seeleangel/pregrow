/**
 * Class Routes
 * 班级相关路由
 */

const express = require('express');
const router = express.Router();
const classController = require('../controllers/class.controller');
const { requireAuth } = require('../middlewares/auth');

// 所有路由需要认证
router.use(requireAuth);

// Moments
router.get('/moments', classController.getMoments);
router.post('/moments', classController.createMoment);
router.post('/moments/upload', classController.uploadMomentMedia);

// Like
router.post('/moments/:id/like', classController.toggleLike);

// Comments
router.get('/moments/:id/comments', classController.getComments);
router.post('/moments/:id/comments', classController.createComment);
router.delete('/moments/:id/comments/:commentId', classController.deleteComment);

// Delete
router.delete('/moments/:id', classController.deleteMoment);
router.delete('/moments/:id/teacher-delete', classController.teacherDeleteMoment);

// Classmates
router.get('/classmates', classController.getClassmates);

module.exports = router;
