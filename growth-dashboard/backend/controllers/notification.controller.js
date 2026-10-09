/**
 * Notification Controller
 * 通知控制器
 */

const { supabaseAdmin } = require('../middlewares/auth');

// 通知类型
const NotificationTypes = {
    TASK_REMINDER: 'task_reminder',
    GOAL_PROGRESS: 'goal_progress',
    GOAL_COMPLETED: 'goal_completed',
    BADGE_EARNED: 'badge_earned',
    SYSTEM: 'system',
    CLASS_JOINED: 'class_joined',
    CHECKIN_REMINDER: 'checkin_reminder',
    SUBMISSION_PENDING: 'submission_pending',
    REVIEW_APPROVED: 'review_approved',
    REVIEW_REJECTED: 'review_rejected'
};

// ============================================
// 获取通知列表
// ============================================

const getNotifications = async (req, res) => {
    const userId = req.user.id;
    const { limit = 20, unread_only = false } = req.query;

    try {
        let query = supabaseAdmin
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));

        if (unread_only === 'true') {
            query = query.eq('is_read', false);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error fetching notifications:', error);
            return res.status(500).json({ error: error.message });
        }

        // 获取未读数量
        const { count: unreadCount } = await supabaseAdmin
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_read', false);

        res.json({
            notifications: data || [],
            unread_count: unreadCount || 0
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 获取未读数量
// ============================================

const getUnreadCount = async (req, res) => {
    const userId = req.user.id;

    try {
        const { count, error } = await supabaseAdmin
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_read', false);

        if (error) {
            console.error('Error fetching unread count:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ unread_count: count || 0 });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 标记单条通知已读
// ============================================

const markAsRead = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const { error } = await supabaseAdmin
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id)
            .eq('user_id', userId);

        if (error) {
            console.error('Error marking notification as read:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, message: '通知已标记为已读' });
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 标记所有通知已读
// ============================================

const markAllAsRead = async (req, res) => {
    const userId = req.user.id;

    try {
        const { error } = await supabaseAdmin
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', userId)
            .eq('is_read', false);

        if (error) {
            console.error('Error marking all notifications as read:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, message: '所有通知已标记为已读' });
    } catch (error) {
        console.error('Mark all as read error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 删除通知
// ============================================

const deleteNotification = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const { error } = await supabaseAdmin
            .from('notifications')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);

        if (error) {
            console.error('Error deleting notification:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, message: '通知已删除' });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 创建通知 (内部使用)
// ============================================

const createNotification = async (userId, type, title, content = null, data = null) => {
    try {
        const { error } = await supabaseAdmin
            .from('notifications')
            .insert({
                user_id: userId,
                type,
                title,
                content,
                data
            });

        if (error) {
            console.error('Error creating notification:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Create notification error:', error);
        return false;
    }
};

// ============================================
// 批量创建通知
// ============================================

const createNotifications = async (notifications) => {
    try {
        const { error } = await supabaseAdmin
            .from('notifications')
            .insert(notifications);

        if (error) {
            console.error('Error creating notifications:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Create notifications error:', error);
        return false;
    }
};

module.exports = {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    createNotification,
    createNotifications,
    NotificationTypes
};
