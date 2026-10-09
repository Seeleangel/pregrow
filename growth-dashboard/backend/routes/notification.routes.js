/**
 * Notification Routes
 * 通知路由
 */

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { requireAuth } = require('../middlewares/auth');

// 所有路由需要认证
router.use(requireAuth);

// ============================================
// Notifications
// ============================================

// 获取通知列表
router.get('/', notificationController.getNotifications);

// 获取未读数量
router.get('/unread-count', notificationController.getUnreadCount);

// 标记所有已读
router.post('/read-all', notificationController.markAllAsRead);

// 标记单条已读
router.post('/:id/read', notificationController.markAsRead);

// 删除通知
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;
