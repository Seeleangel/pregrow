/**
 * Class Controller
 * 班级相关控制器
 */

const path = require('path');
const { supabaseAdmin } = require('../middlewares/auth');
const { uploadBase64Image } = require('../services/storageService');
const { invalidateMomentsCache, invalidateTeacherCaches, getCachedApiValue, setCachedApiValue, API_CACHE_TTL_MS } = require('../services/cacheService');
const { parsePositiveInt } = require('../services/statsService');

// ============================================
// Get Class Moments
// ============================================

const getMoments = async (req, res) => {
    const userId = req.query.user_id ? String(req.query.user_id) : '';
    const limit = parsePositiveInt(req.query.limit, 20, 5, 50);

    if (!userId) {
        return res.json([]);
    }

    try {
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('class_id')
            .eq('id', userId)
            .single();

        if (!profile || !profile.class_id) {
            return res.json([]);
        }

        const classId = profile.class_id;
        const cacheKey = `class_moments::${classId}::${userId}::${limit}`;
        const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.classMoments);
        if (cached) return res.json(cached);

        const { data, error } = await supabaseAdmin
            .from('class_moments')
            .select('id, student_id, class_id, content, type, media_url, likes, created_at, profiles(full_name, avatar_url)')
            .eq('class_id', classId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            if (error.code === '42P01') return res.json([]);
            return res.status(500).json({ error: error.message });
        }

        if (!data || data.length === 0) {
            setCachedApiValue(cacheKey, []);
            return res.json([]);
        }

        const momentIds = data.map(moment => moment.id);
        const [commentsResult, likesResult] = await Promise.all([
            supabaseAdmin
                .from('class_moment_comments')
                .select('moment_id')
                .in('moment_id', momentIds),
            supabaseAdmin
                .from('class_moment_likes')
                .select('moment_id, student_id')
                .in('moment_id', momentIds)
        ]);

        if (commentsResult.error && commentsResult.error.code !== '42P01') {
            return res.status(500).json({ error: commentsResult.error.message });
        }
        if (likesResult.error && likesResult.error.code !== '42P01') {
            return res.status(500).json({ error: likesResult.error.message });
        }

        const commentCountMap = new Map();
        const likeCountMap = new Map();
        const likedByMeSet = new Set();

        for (const row of commentsResult.data || []) {
            commentCountMap.set(row.moment_id, (commentCountMap.get(row.moment_id) || 0) + 1);
        }

        for (const row of likesResult.data || []) {
            likeCountMap.set(row.moment_id, (likeCountMap.get(row.moment_id) || 0) + 1);
            if (userId && row.student_id === userId) {
                likedByMeSet.add(row.moment_id);
            }
        }

        const moments = data.map(moment => ({
            ...moment,
            comment_count: commentCountMap.get(moment.id) || 0,
            like_count: likeCountMap.get(moment.id) ?? Number(moment.likes || 0),
            liked_by_me: likedByMeSet.has(moment.id)
        }));

        setCachedApiValue(cacheKey, moments);
        res.json(moments);
    } catch (err) {
        console.error('Fetch moments error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ============================================
// Create Moment
// ============================================

const createMoment = async (req, res) => {
    const { student_id, content, type, media_url } = req.body;

    if (!student_id) {
        return res.status(400).json({ error: 'Missing student_id' });
    }
    if ((!content || !content.trim()) && !media_url) {
        return res.status(400).json({ error: '请输入动态内容或上传媒体' });
    }

    try {
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('class_id')
            .eq('id', student_id)
            .single();

        if (!profile || !profile.class_id) {
            return res.status(403).json({ error: '您尚未加入任何班级，无法发布动态。' });
        }

        const { data, error } = await supabaseAdmin
            .from('class_moments')
            .insert([{
                student_id,
                class_id: profile.class_id,
                content: content ? content.trim() : '',
                type: type || 'share',
                media_url: media_url || null
            }])
            .select();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateTeacherCaches();
        res.status(201).json(data[0]);
    } catch (err) {
        console.error('Create moment error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ============================================
// Upload Moment Media
// ============================================

const uploadMomentMedia = async (req, res) => {
    const { fileName, mimeType, dataBase64 } = req.body;

    if (!fileName || !mimeType || !dataBase64) {
        return res.status(400).json({ error: 'Missing fileName, mimeType or dataBase64' });
    }

    const isImage = mimeType.startsWith('image/');
    const isAudio = mimeType.startsWith('audio/');
    if (!isImage && !isAudio) {
        return res.status(400).json({ error: '仅支持图片或音频文件' });
    }

    try {
        const cleanName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const extension = path.extname(cleanName) || (isImage ? '.png' : '.mp3');
        const finalName = `moments/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${extension}`;

        const publicUrl = await uploadBase64Image(dataBase64, finalName, mimeType);

        res.json({
            media_url: publicUrl,
            media_type: isImage ? 'image' : 'audio'
        });
    } catch (error) {
        console.error('Upload media error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Toggle Like
// ============================================

const toggleLike = async (req, res) => {
    const { id } = req.params;
    const { student_id } = req.body;

    if (!student_id) {
        return res.status(400).json({ error: 'Missing student_id' });
    }

    try {
        // 检查是否已点赞
        const { data: existing } = await supabaseAdmin
            .from('class_moment_likes')
            .select('id')
            .eq('moment_id', id)
            .eq('student_id', student_id)
            .single();

        if (existing) {
            // 取消点赞
            await supabaseAdmin
                .from('class_moment_likes')
                .delete()
                .eq('id', existing.id);

            // 减少点赞计数
            const { data: moment } = await supabaseAdmin
                .from('class_moments')
                .select('likes')
                .eq('id', id)
                .single();

            if (moment) {
                await supabaseAdmin
                    .from('class_moments')
                    .update({ likes: Math.max(0, (moment.likes || 0) - 1) })
                    .eq('id', id);
            }

            invalidateMomentsCache();
            res.json({ liked: false, message: '取消点赞' });
        } else {
            // 添加点赞
            await supabaseAdmin
                .from('class_moment_likes')
                .insert([{ moment_id: id, student_id: student_id }]);

            // 增加点赞计数
            await supabaseAdmin.rpc('increment_likes', { moment_id: id }).catch(() => {
                // 如果 RPC 不存在，直接更新
                supabaseAdmin
                    .from('class_moments')
                    .update({ likes: supabaseAdmin.rpc('increment', { x: 1 }) })
                    .eq('id', id);
            });

            invalidateMomentsCache();
            res.json({ liked: true, message: '点赞成功' });
        }
    } catch (error) {
        console.error('Toggle like error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Comments
// ============================================

const getComments = async (req, res) => {
    const { id } = req.params;

    try {
        const { data, error } = await supabaseAdmin
            .from('class_moment_comments')
            .select('*, profiles(full_name, avatar_url)')
            .eq('moment_id', id)
            .order('created_at', { ascending: true });

        if (error && error.code !== '42P01') {
            return res.status(500).json({ error: error.message });
        }
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createComment = async (req, res) => {
    const { id } = req.params;
    const { student_id, content } = req.body;

    if (!student_id || !content || !content.trim()) {
        return res.status(400).json({ error: 'Missing student_id or content' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('class_moment_comments')
            .insert([{
                moment_id: id,
                student_id,
                content: content.trim()
            }])
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateMomentsCache();
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteComment = async (req, res) => {
    const { id, commentId } = req.params;
    const { student_id } = req.body;

    try {
        const { error } = await supabaseAdmin
            .from('class_moment_comments')
            .delete()
            .eq('id', commentId)
            .eq('moment_id', id)
            .eq('student_id', student_id);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateMomentsCache();
        res.json({ message: 'Comment deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Delete Moment
// ============================================

const deleteMoment = async (req, res) => {
    const { id } = req.params;
    const { student_id } = req.body;

    try {
        const { error } = await supabaseAdmin
            .from('class_moments')
            .delete()
            .eq('id', id)
            .eq('student_id', student_id);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateMomentsCache();
        invalidateTeacherCaches();
        res.json({ message: 'Moment deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const teacherDeleteMoment = async (req, res) => {
    const { id } = req.params;
    const { teacher_id } = req.body;

    try {
        // 验证教师身份
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('role, class_id')
            .eq('id', teacher_id)
            .single();

        if (!profile || profile.role !== 'teacher') {
            return res.status(403).json({ error: '仅教师可以删除动态' });
        }

        const { data: moment, error: momentError } = await supabaseAdmin
            .from('class_moments')
            .select('id, student_id')
            .eq('id', id)
            .single();

        if (momentError) {
            return res.status(404).json({ error: '动态不存在' });
        }

        if (moment?.student_id) {
            const { data: ownerProfile, error: ownerError } = await supabaseAdmin
                .from('profiles')
                .select('class_id')
                .eq('id', moment.student_id)
                .single();

            if (ownerError) {
                return res.status(500).json({ error: ownerError.message });
            }

            if (!ownerProfile || !profile.class_id || ownerProfile.class_id !== profile.class_id) {
                return res.status(403).json({ error: '只能删除本班学生的动态' });
            }
        }

        const { error } = await supabaseAdmin
            .from('class_moments')
            .delete()
            .eq('id', id);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateMomentsCache();
        invalidateTeacherCaches();
        res.json({ message: 'Moment deleted by teacher' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Get Classmates (same class_id)
// ============================================

const getClassmates = async (req, res) => {
    const userId = req.query.user_id ? String(req.query.user_id) : '';

    if (!userId) {
        return res.json([]);
    }

    try {
        // Get current user's class_id
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('class_id')
            .eq('id', userId)
            .single();

        if (!profile || !profile.class_id) {
            return res.json([]);
        }

        const cacheKey = `classmates::${profile.class_id}`;
        const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.classMoments);
        if (cached) return res.json(cached);

        // Fetch all students in the same class
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, avatar_url, role')
            .eq('class_id', profile.class_id)
            .eq('role', 'student')
            .order('full_name', { ascending: true });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        const classmates = (data || []).map(p => ({
            id: p.id,
            name: p.full_name || '未命名',
            avatar_url: p.avatar_url || null,
            is_self: p.id === userId,
        }));

        setCachedApiValue(cacheKey, classmates);
        res.json(classmates);
    } catch (err) {
        console.error('Fetch classmates error:', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getMoments,
    createMoment,
    uploadMomentMedia,
    toggleLike,
    getComments,
    createComment,
    deleteComment,
    deleteMoment,
    teacherDeleteMoment,
    getClassmates
};
