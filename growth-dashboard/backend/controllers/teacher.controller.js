/**
 * Teacher Controller
 * 教师相关控制器
 */

const path = require('path');
const { supabaseAdmin } = require('../middlewares/auth');
const { invalidateTeacherCaches, invalidateStudentCaches, getCachedApiValue, setCachedApiValue, API_CACHE_TTL_MS } = require('../services/cacheService');
const { parsePositiveInt, normalizeObstacleType, normalizeObstacleStatus } = require('../services/statsService');
const { uploadBase64Image } = require('../services/storageService');
const { createNotification, NotificationTypes } = require('./notification.controller');

const generateInviteCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const getAuthUserId = (req) => String(
    req?.user?.id ||
    req?.user?.sub ||
    req?.user?.user_id ||
    ''
).trim();

const isSchemaError = (error) => {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    return code === '42703'
        || code.startsWith('PGRST')
        || message.includes('does not exist')
        || message.includes('could not find')
        || message.includes('schema cache');
};

const APPROVED_SUBMISSION_STATUSES = new Set(['completed', 'verified']);
const REVIEWED_SUBMISSION_STATUSES = new Set(['completed', 'verified', 'rejected']);

const normalizeSubmissionStatus = (status) => String(status || '').trim().toLowerCase();

const getSubmissionTimeline = (row = {}) => {
    const status = normalizeSubmissionStatus(row.status);
    const updatedAt = row.updated_at || null;
    const createdAt = row.created_at || null;
    const completedAt = row.completed_at || null;
    const submittedAt = completedAt || createdAt || updatedAt || null;
    const reviewedAt = REVIEWED_SUBMISSION_STATUSES.has(status) ? (updatedAt || null) : null;
    const historyAt = reviewedAt || submittedAt || createdAt || updatedAt || null;

    return {
        status,
        submittedAt,
        reviewedAt,
        historyAt
    };
};

const isAuditFlowTaskRecord = (row = {}) => {
    const goalId = row.goal_id || null;
    const taskType = String(row.tasks?.type || '').trim().toLowerCase();
    const challengeCategory = String(row.tasks?.challenge_category || '').trim().toLowerCase();

    return Boolean(goalId)
        || challengeCategory === 'teacher_assigned'
        || taskType === 'personal';
};

const fetchSubmissionRows = async (studentIds, limit) => {
    const attempts = [
        {
            select: 'id, student_id, task_id, goal_id, status, proof_url, proof_note, created_at, completed_at, updated_at, tasks ( title, type, challenge_category )',
            hasGoalId: true,
            hasProofNote: true,
            hasUpdatedAt: true,
            hasChallengeCategory: true
        },
        {
            select: 'id, student_id, task_id, goal_id, status, proof_url, proof_note, created_at, completed_at, tasks ( title, type, challenge_category )',
            hasGoalId: true,
            hasProofNote: true,
            hasUpdatedAt: false,
            hasChallengeCategory: true
        },
        {
            select: 'id, student_id, task_id, goal_id, status, proof_url, created_at, completed_at, tasks ( title, type )',
            hasGoalId: true,
            hasProofNote: false,
            hasUpdatedAt: false,
            hasChallengeCategory: false
        },
        {
            select: 'id, student_id, task_id, status, proof_url, created_at, completed_at, tasks ( title, type )',
            hasGoalId: false,
            hasProofNote: false,
            hasUpdatedAt: false,
            hasChallengeCategory: false
        }
    ];

    let lastError = null;

    for (const attempt of attempts) {
        let query = supabaseAdmin
            .from('student_tasks')
            .select(attempt.select)
            .in('student_id', studentIds)
            .in('status', ['submitted', 'completed', 'verified', 'rejected'])
            .limit(limit * 4);

        if (attempt.hasUpdatedAt) {
            query = query.order('updated_at', { ascending: false, nullsFirst: false });
        }

        query = query
            .order('completed_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false });

        const result = await query;
        if (!result.error) {
            return {
                data: result.data || [],
                error: null,
                capabilities: attempt
            };
        }

        lastError = result.error;
        if (!isSchemaError(result.error)) {
            return {
                data: [],
                error: result.error,
                capabilities: attempt
            };
        }
    }

    return {
        data: [],
        error: lastError,
        capabilities: attempts[attempts.length - 1]
    };
};

const resolveSubmissionTitle = async (submission) => {
    if (!submission) return '本次提交';

    if (submission.goal_id) {
        const { data: goal } = await supabaseAdmin
            .from('student_goals')
            .select('title')
            .eq('id', submission.goal_id)
            .maybeSingle();
        return String(goal?.title || '').trim() || '目标';
    }

    const taskId = submission.task_id || null;
    if (!taskId) return '今日计划';

    const { data: task } = await supabaseAdmin
        .from('tasks')
        .select('title')
        .eq('id', taskId)
        .maybeSingle();
    return String(task?.title || '').trim() || '今日计划';
};

const notifyReviewResult = async (submission, action) => {
    if (!submission?.student_id) return;

    const title = await resolveSubmissionTitle(submission);
    const approved = action === 'verified';

    await createNotification(
        submission.student_id,
        approved ? NotificationTypes.REVIEW_APPROVED : NotificationTypes.REVIEW_REJECTED,
        approved ? '老师已通过你的提交' : '老师请你再修改一下',
        approved
            ? `“${title}”已通过审核，可以继续下一步啦。`
            : `“${title}”还需要补充或调整，请按老师建议再提交一次。`,
        {
            status: approved ? 'completed' : 'rejected',
            submission_id: submission.id || null,
            task_id: submission.task_id || null,
            goal_id: submission.goal_id || null,
            target_url: submission.goal_id ? 'portfolio.html' : 'dashboard.html#today-plan'
        }
    );
};

const setPrivateCacheHeaders = (res, maxAgeSec = 20) => {
    res.set('Cache-Control', `private, max-age=${maxAgeSec}`);
};

const getTeacherProfileCached = async (teacherId) => {
    if (!teacherId) {
        return { error: 'Missing teacher_id', status: 400 };
    }

    const cacheKey = `teacher_profile::${teacherId}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.teacherProfile);
    if (cached) {
        return { teacherProfile: cached };
    }

    const { data: teacherProfile, error: teacherError } = await supabaseAdmin
        .from('profiles')
        .select('id, role, class_id, full_name, avatar_url, school_name, class_name, bio')
        .eq('id', teacherId)
        .single();

    if (teacherError) {
        return { error: teacherError.message, status: 500 };
    }

    if (!teacherProfile || teacherProfile.role !== 'teacher') {
        return { error: '仅教师可执行该操作', status: 403 };
    }

    setCachedApiValue(cacheKey, teacherProfile);
    return { teacherProfile };
};

const getProfile = async (req, res) => {
    const { id } = req.params;

    if (String(req.user?.id || '') !== String(id || '')) {
        return res.status(403).json({ error: '无权查看该教师资料' });
    }

    try {
        const profileResult = await getTeacherProfileCached(id);
        if (profileResult.error) {
            return res.status(profileResult.status).json({ error: profileResult.error });
        }

        const teacherProfile = profileResult.teacherProfile || {};
        setPrivateCacheHeaders(res, 20);
        return res.json({
            id: teacherProfile.id,
            full_name: teacherProfile.full_name || '',
            avatar_url: teacherProfile.avatar_url || '',
            bio: teacherProfile.bio || '',
            school_name: teacherProfile.school_name || '',
            class_name: teacherProfile.class_name || '',
            class_id: teacherProfile.class_id || null
        });
    } catch (error) {
        console.error('Fetch teacher profile error:', error);
        return res.status(500).json({ error: error.message });
    }
};

const updateProfile = async (req, res) => {
    const { id } = req.params;

    if (String(req.user?.id || '') !== String(id || '')) {
        return res.status(403).json({ error: '无权修改该教师资料' });
    }

    const fullName = String(req.body?.full_name || '').trim();
    const avatarUrl = String(req.body?.avatar_url || '').trim();
    const bio = String(req.body?.bio || '').trim();

    if (!fullName) {
        return res.status(400).json({ error: '姓名不能为空' });
    }

    if (fullName.length < 3) {
        return res.status(400).json({ error: '姓名至少需要 3 个字符' });
    }

    if (fullName.length > 32) {
        return res.status(400).json({ error: '姓名最多 32 个字符' });
    }

    if (avatarUrl && avatarUrl.length > 500) {
        return res.status(400).json({ error: '头像链接过长' });
    }

    if (bio.length > 200) {
        return res.status(400).json({ error: '个人简介最多 200 字' });
    }

    try {
        const profileResult = await getTeacherProfileCached(id);
        if (profileResult.error) {
            return res.status(profileResult.status).json({ error: profileResult.error });
        }

        const { data, error } = await supabaseAdmin
            .from('profiles')
            .update({
                full_name: fullName,
                avatar_url: avatarUrl,
                bio,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('role', 'teacher')
            .select('id, full_name, avatar_url, bio, school_name, class_name, class_id')
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateTeacherCaches();
        return res.json({
            message: '个人资料已更新',
            data: data || null
        });
    } catch (error) {
        console.error('Update teacher profile error:', error);
        return res.status(500).json({ error: error.message });
    }
};

const uploadAvatar = async (req, res) => {
    const { id } = req.params;
    const { fileName, mimeType, dataBase64 } = req.body || {};

    if (String(req.user?.id || '') !== String(id || '')) {
        return res.status(403).json({ error: '无权上传该教师头像' });
    }

    if (!fileName || !mimeType || !dataBase64) {
        return res.status(400).json({ error: '缺少 fileName, mimeType 或 dataBase64' });
    }

    if (!String(mimeType).startsWith('image/')) {
        return res.status(400).json({ error: '仅支持图片文件' });
    }

    const rawBase64 = String(dataBase64 || '').includes(',')
        ? String(dataBase64).split(',')[1]
        : String(dataBase64 || '');

    if (!rawBase64) {
        return res.status(400).json({ error: '图片数据无效' });
    }

    const estimatedBytes = Math.floor(rawBase64.length * 0.75);
    const maxBytes = 5 * 1024 * 1024;
    if (estimatedBytes > maxBytes) {
        return res.status(400).json({ error: '图片不能超过 5MB' });
    }

    try {
        const cleanName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const extension = path.extname(cleanName) || '.png';
        const finalName = `avatars/teacher/${id}/${Date.now()}${extension}`;
        const avatarUrl = await uploadBase64Image(dataBase64, finalName, mimeType);

        const { data, error } = await supabaseAdmin
            .from('profiles')
            .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('role', 'teacher')
            .select('id, avatar_url')
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateTeacherCaches();
        return res.json({
            message: '头像上传成功',
            avatar_url: data?.avatar_url || avatarUrl
        });
    } catch (error) {
        console.error('Upload teacher avatar error:', error);
        return res.status(500).json({ error: error.message });
    }
};

const getClassStudentsCached = async (classId) => {
    if (!classId) return { students: [] };

    const cacheKey = `class_students::${classId}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.teacherStudents);
    if (cached) {
        return { students: cached };
    }

    const { data: students, error: studentsError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, avatar_url, school_name, class_name')
        .eq('role', 'student')
        .eq('class_id', classId)
        .order('full_name', { ascending: true });

    if (studentsError) {
        return { error: studentsError.message, status: 500 };
    }

    const safeStudents = students || [];
    setCachedApiValue(cacheKey, safeStudents);
    return { students: safeStudents };
};

const resolveTeacherContextCached = async (teacherId) => {
    if (!teacherId) {
        return { error: 'Missing teacher_id', status: 400 };
    }

    const cacheKey = `teacher_context::${teacherId}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.teacherContext);
    if (cached) {
        return {
            teacherProfile: cached.teacherProfile,
            students: cached.students,
            studentIds: cached.studentIds,
            studentIdSet: new Set(cached.studentIds)
        };
    }

    const profileResult = await getTeacherProfileCached(teacherId);
    if (profileResult.error) return profileResult;
    const teacherProfile = profileResult.teacherProfile;

    let students = [];
    if (teacherProfile.class_id) {
        const studentsResult = await getClassStudentsCached(teacherProfile.class_id);
        if (studentsResult.error) return studentsResult;
        students = studentsResult.students || [];
    }

    const studentIds = students.map((item) => item.id).filter(Boolean);
    const payload = { teacherProfile, students, studentIds };
    setCachedApiValue(cacheKey, payload);

    return {
        teacherProfile,
        students,
        studentIds,
        studentIdSet: new Set(studentIds)
    };
};

// ============================================
// Get Teacher's Class
// ============================================

const getClass = async (req, res) => {
    const { id } = req.params;

    if (String(req.user?.id || '') !== String(id || '')) {
        return res.status(403).json({ error: '无权查看该班级信息' });
    }

    try {
        const profileResult = await getTeacherProfileCached(id);
        if (profileResult.error) {
            return res.status(profileResult.status).json({ error: profileResult.error });
        }

        const teacherProfile = profileResult.teacherProfile;
        if (!teacherProfile.class_id) {
            return res.status(404).json({ error: '未找到班级' });
        }

        const classCacheKey = `teacher_class::${teacherProfile.class_id}`;
        const cachedClass = getCachedApiValue(classCacheKey, API_CACHE_TTL_MS.teacherClass);
        if (cachedClass) {
            setPrivateCacheHeaders(res, 20);
            return res.json(cachedClass);
        }

        const { data, error } = await supabaseAdmin
            .from('classes')
            .select('id, name, school_name, invite_code, teacher_id')
            .eq('id', teacherProfile.class_id)
            .eq('teacher_id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: '未找到班级' });
            throw error;
        }

        setCachedApiValue(classCacheKey, data);
        setPrivateCacheHeaders(res, 20);
        res.json(data);
    } catch (error) {
        console.error('Fetch teacher class error:', error);
        res.status(500).json({ error: error.message });
    }
};

const updateClassInfo = async (req, res) => {
    const { id } = req.params;
    const schoolName = String(req.body?.school_name || '').trim();
    const className = String(req.body?.name || '').trim();

    if (String(req.user?.id || '') !== String(id || '')) {
        return res.status(403).json({ error: '无权修改该班级' });
    }

    if (!schoolName || !className) {
        return res.status(400).json({ error: 'school_name 和 name 为必填' });
    }

    try {
        const profileResult = await getTeacherProfileCached(id);
        if (profileResult.error) {
            return res.status(profileResult.status).json({ error: profileResult.error });
        }

        const teacherProfile = profileResult.teacherProfile;

        if (!teacherProfile.class_id) {
            return res.status(404).json({ error: '未绑定班级，无法修改' });
        }

        const { data: updatedClass, error: classError } = await supabaseAdmin
            .from('classes')
            .update({
                school_name: schoolName,
                name: className
            })
            .eq('id', teacherProfile.class_id)
            .eq('teacher_id', id)
            .select('id, name, school_name, invite_code, teacher_id')
            .single();

        if (classError) return res.status(500).json({ error: classError.message });

        const { error: profilesError } = await supabaseAdmin
            .from('profiles')
            .update({
                school_name: schoolName,
                class_name: className
            })
            .eq('class_id', teacherProfile.class_id);

        if (profilesError) return res.status(500).json({ error: profilesError.message });

        invalidateTeacherCaches();
        return res.json({ message: '班级信息已更新', data: updatedClass });
    } catch (error) {
        console.error('Update class info error:', error);
        return res.status(500).json({ error: error.message });
    }
};

const refreshClassInviteCode = async (req, res) => {
    const { id } = req.params;

    if (String(req.user?.id || '') !== String(id || '')) {
        return res.status(403).json({ error: '无权刷新该班级邀请码' });
    }

    try {
        const profileResult = await getTeacherProfileCached(id);
        if (profileResult.error) {
            return res.status(profileResult.status).json({ error: profileResult.error });
        }

        const teacherProfile = profileResult.teacherProfile;

        if (!teacherProfile.class_id) {
            return res.status(404).json({ error: '未绑定班级，无法刷新邀请码' });
        }

        let nextCode = null;
        for (let i = 0; i < 8; i++) {
            const candidate = generateInviteCode();
            const { data: existed, error: existedError } = await supabaseAdmin
                .from('classes')
                .select('id')
                .eq('invite_code', candidate)
                .maybeSingle();

            if (existedError) {
                return res.status(500).json({ error: existedError.message });
            }

            if (!existed) {
                nextCode = candidate;
                break;
            }
        }

        if (!nextCode) {
            return res.status(500).json({ error: '邀请码生成失败，请稍后重试' });
        }

        const { data: updatedClass, error: updateError } = await supabaseAdmin
            .from('classes')
            .update({ invite_code: nextCode })
            .eq('id', teacherProfile.class_id)
            .eq('teacher_id', id)
            .select('id, name, school_name, invite_code, teacher_id')
            .single();

        if (updateError) return res.status(500).json({ error: updateError.message });

        invalidateTeacherCaches();
        return res.json({ message: '邀请码已刷新', data: updatedClass });
    } catch (error) {
        console.error('Refresh class invite code error:', error);
        return res.status(500).json({ error: error.message });
    }
};

// ============================================
// Get Students (Teacher Dashboard)
// ============================================

const getStudents = async (req, res) => {
    const authTeacherId = getAuthUserId(req);
    const queryTeacherId = String(req.query.teacher_id || '').trim();
    const teacherId = authTeacherId || queryTeacherId;
    const className = String(req.query.class_name || '').trim();
    const limit = parsePositiveInt(req.query.limit, 50, 1, 200);
    const cacheKey = `students::${teacherId}::${className}::${limit}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.students);
    if (cached) {
        setPrivateCacheHeaders(res, 20);
        return res.json(cached);
    }

    if (!teacherId) {
        return res.status(401).json({ error: '请先登录教师账号' });
    }

    if (authTeacherId && queryTeacherId && authTeacherId !== queryTeacherId) {
        return res.status(403).json({ error: 'teacher_id 与当前登录账号不匹配' });
    }

    try {
        const context = await resolveTeacherContextCached(teacherId);
        if (context.error) {
            return res.status(context.status).json({ error: context.error });
        }

        if (!context.teacherProfile.class_id) {
            return res.json([]);
        }

        const normalizedClassName = className.toLowerCase();
        const allStudents = context.students || [];
        const filtered = normalizedClassName
            ? allStudents.filter((item) => String(item.class_name || '').toLowerCase().includes(normalizedClassName))
            : allStudents;
        const result = filtered.slice(0, limit);

        const studentIds = result.map((item) => item.id).filter(Boolean);
        const weeklyMap = new Map(studentIds.map((id) => [id, 0]));

        if (studentIds.length > 0) {
            const since = new Date();
            since.setDate(since.getDate() - 7);

            let taskRowsResult = await supabaseAdmin
                .from('student_tasks')
                .select('student_id, status, goal_id, completed_at, created_at, updated_at, tasks ( type, challenge_category )')
                .in('student_id', studentIds)
                .in('status', ['completed', 'verified'])
                .order('updated_at', { ascending: false, nullsFirst: false })
                .order('completed_at', { ascending: false, nullsFirst: false })
                .order('created_at', { ascending: false })
                .limit(5000);

            if (taskRowsResult.error && isSchemaError(taskRowsResult.error)) {
                taskRowsResult = await supabaseAdmin
                    .from('student_tasks')
                    .select('student_id, status, goal_id, completed_at, created_at, tasks ( type, challenge_category )')
                    .in('student_id', studentIds)
                    .in('status', ['completed', 'verified'])
                    .order('completed_at', { ascending: false, nullsFirst: false })
                    .order('created_at', { ascending: false })
                    .limit(5000);
            }

            if (taskRowsResult.error) {
                return res.status(500).json({ error: taskRowsResult.error.message });
            }

            (taskRowsResult.data || []).forEach((row) => {
                const studentId = row.student_id;
                if (!weeklyMap.has(studentId)) return;

                const timeline = getSubmissionTimeline(row);
                if (!APPROVED_SUBMISSION_STATUSES.has(timeline.status)) return;
                if (!isAuditFlowTaskRecord(row)) return;

                const ts = new Date(timeline.submittedAt || '').getTime();
                if (!Number.isFinite(ts) || ts < since.getTime()) return;

                weeklyMap.set(studentId, Number(weeklyMap.get(studentId) || 0) + 1);
            });
        }

        const enriched = result.map((student) => ({
            ...student,
            weekly_completed: Number(weeklyMap.get(student.id) || 0)
        }));

        setCachedApiValue(cacheKey, enriched);
        setPrivateCacheHeaders(res, 20);
        res.json(enriched);
    } catch (error) {
        console.error('Get students error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Get Submissions (Teacher Dashboard)
// ============================================

const getSubmissions = async (req, res) => {
    const authTeacherId = getAuthUserId(req);
    const queryTeacherId = String(req.query.teacher_id || '').trim();
    const teacherId = authTeacherId || queryTeacherId;
    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const historyMode = String(req.query.history || '').trim().toLowerCase();
    const showAllHistory = historyMode === 'all';
    const days = showAllHistory ? null : parsePositiveInt(req.query.days, 7, 1, 30);
    const cacheKey = `submissions::${teacherId}::${showAllHistory ? 'all' : days}::${limit}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.submissions);
    if (cached) {
        setPrivateCacheHeaders(res, 15);
        return res.json(cached);
    }

    if (!teacherId) {
        return res.status(401).json({ error: '请先登录教师账号' });
    }

    if (authTeacherId && queryTeacherId && authTeacherId !== queryTeacherId) {
        return res.status(403).json({ error: 'teacher_id 与当前登录账号不匹配' });
    }

    try {
        const context = await resolveTeacherContextCached(teacherId);
        if (context.error) {
            return res.status(context.status).json({ error: context.error });
        }

        if (!context.teacherProfile.class_id) {
            return res.json([]);
        }

        const students = context.students || [];
        const studentIds = students.map((item) => item.id).filter(Boolean);
        const profileMap = new Map(students.map((item) => [item.id, {
            id: item.id,
            full_name: item.full_name,
            avatar_url: item.avatar_url
        }]));

        if (studentIds.length === 0) {
            return res.json([]);
        }

        // 获取最近的任务完成记录
        let sinceTime = null;
        if (!showAllHistory) {
            const since = new Date();
            since.setDate(since.getDate() - days);
            sinceTime = since.getTime();
        }

        const submissionRowsResult = await fetchSubmissionRows(studentIds, limit);
        if (submissionRowsResult.error) {
            return res.status(500).json({ error: submissionRowsResult.error.message });
        }

        const submissionRows = submissionRowsResult.data || [];
        const capabilities = submissionRowsResult.capabilities || {};
        const goalIds = capabilities.hasGoalId
            ? Array.from(new Set(submissionRows.map((item) => item.goal_id).filter(Boolean)))
            : [];

        let goalTitleMap = new Map();
        if (goalIds.length) {
            const goalResult = await supabaseAdmin
                .from('student_goals')
                .select('id, title')
                .in('id', goalIds);

            if (!goalResult.error) {
                goalTitleMap = new Map((goalResult.data || []).map((item) => [item.id, item.title]));
            } else if (!isSchemaError(goalResult.error)) {
                return res.status(500).json({ error: goalResult.error.message });
            }
        }

        const normalized = submissionRows
            .map((item) => {
                const profile = profileMap.get(item.student_id) || null;
                const proofNote = String(capabilities.hasProofNote ? (item.proof_note || '') : '').trim();
                const proofUrl = String(item.proof_url || '').trim();
                const goalId = capabilities.hasGoalId ? (item.goal_id || null) : null;
                const taskType = item.tasks?.type || (goalId ? 'goal_plan' : 'challenge');
                const challengeCategory = String(
                    capabilities.hasChallengeCategory ? (item.tasks?.challenge_category || '') : ''
                ).trim().toLowerCase();
                const timeline = getSubmissionTimeline({
                    ...item,
                    updated_at: capabilities.hasUpdatedAt ? (item.updated_at || null) : null
                });
                const hasEvidence = Boolean(proofNote || proofUrl);
                const isGoalSubmission = Boolean(goalId);
                const isTeacherAssigned = challengeCategory === 'teacher_assigned';
                const isPersonalTask = taskType === 'personal';
                const isAuditFlowRecord = isGoalSubmission || isTeacherAssigned || isPersonalTask;
                const resolvedTitle = item.tasks?.title || goalTitleMap.get(goalId) || '未命名提交';
                const historyAtTs = new Date(timeline.historyAt || '').getTime();
                const isWithinWindow = showAllHistory
                    || (Number.isFinite(historyAtTs) && historyAtTs >= sinceTime);

                if (!isAuditFlowRecord || !isWithinWindow) {
                    return null;
                }

                if (!isGoalSubmission && !hasEvidence) {
                    return null;
                }

                return {
                    id: item.id,
                    student_id: item.student_id,
                    task_id: item.task_id,
                    goal_id: goalId,
                    status: timeline.status || 'submitted',
                    submitted_at: timeline.submittedAt,
                    reviewed_at: timeline.reviewedAt,
                    history_at: timeline.historyAt,
                    created_at: item.created_at || null,
                    updated_at: capabilities.hasUpdatedAt ? (item.updated_at || null) : null,
                    completed_at: item.completed_at || null,
                    task_title: resolvedTitle,
                    task_type: taskType,
                    proof_url: proofUrl || null,
                    proof_note: proofNote,
                    student_name: profile?.full_name || '未命名学生',
                    student_avatar: profile?.avatar_url || null,
                    profiles: profile,
                    tasks: {
                        title: resolvedTitle,
                        type: taskType,
                        challenge_category: capabilities.hasChallengeCategory ? (item.tasks?.challenge_category || null) : null
                    },
                    goal: goalId ? { id: goalId, title: goalTitleMap.get(goalId) || resolvedTitle } : null
                };
            })
            .filter(Boolean)
            .sort((a, b) => {
                const aTs = new Date(a.history_at || '').getTime();
                const bTs = new Date(b.history_at || '').getTime();
                return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
            })
            .slice(0, limit);

        setCachedApiValue(cacheKey, normalized);
        setPrivateCacheHeaders(res, 15);
        res.json(normalized);
    } catch (error) {
        console.error('Get submissions error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getTaskCompletionSummary = async (req, res) => {
    const authTeacherId = getAuthUserId(req);
    const queryTeacherId = String(req.query.teacher_id || '').trim();
    const teacherId = authTeacherId || queryTeacherId;
    const days = parsePositiveInt(req.query.days, 14, 3, 60);
    const top = parsePositiveInt(req.query.top, 2, 1, 5);
    const cacheKey = `task_completion_summary::${teacherId}::${days}::${top}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.submissions);
    if (cached) {
        setPrivateCacheHeaders(res, 20);
        return res.json(cached);
    }

    if (!teacherId) {
        return res.status(401).json({ error: '请先登录教师账号' });
    }

    if (authTeacherId && queryTeacherId && authTeacherId !== queryTeacherId) {
        return res.status(403).json({ error: 'teacher_id 与当前登录账号不匹配' });
    }

    try {
        const context = await resolveTeacherContextCached(teacherId);
        if (context.error) {
            return res.status(context.status).json({ error: context.error });
        }

        const studentIds = context.studentIds || [];
        if (!context.teacherProfile.class_id || !studentIds.length) {
            const emptyPayload = {
                days,
                top,
                overdue_count: 0,
                status_text: '最近 3 天无逾期提交',
                items: [],
                generated_at: new Date().toISOString()
            };
            setCachedApiValue(cacheKey, emptyPayload);
            setPrivateCacheHeaders(res, 20);
            return res.json(emptyPayload);
        }

        const since = new Date();
        since.setDate(since.getDate() - days);
        const overdueThreshold = Date.now() - (3 * 24 * 60 * 60 * 1000);

        const { data: rows, error: rowsError } = await supabaseAdmin
            .from('student_tasks')
            .select('id, status, created_at, completed_at, task_id, goal_id, tasks ( title, challenge_category ), student_goals!student_tasks_goal_id_fkey ( title )')
            .in('student_id', studentIds)
            .gte('created_at', since.toISOString())
            .order('created_at', { ascending: false })
            .limit(5000);

        if (rowsError) {
            return res.status(500).json({ error: rowsError.message });
        }

        const grouped = new Map();
        let overdueCount = 0;

        (rows || []).forEach((item) => {
            const isTeacherAssigned = String(item.tasks?.challenge_category || '').trim().toLowerCase() === 'teacher_assigned';
            if (!isTeacherAssigned) {
                return;
            }

            const title = String(item.tasks?.title || '老师发布任务').trim();
            const status = String(item.status || '').trim().toLowerCase();
            const createdAtTs = new Date(item.created_at || item.completed_at || '').getTime();
            const isCompleted = status === 'completed' || status === 'verified';
            const isOverdue = (status === 'submitted' || status === 'pending') && Number.isFinite(createdAtTs) && createdAtTs > 0 && createdAtTs < overdueThreshold;

            if (!grouped.has(title)) {
                grouped.set(title, {
                    title,
                    total_count: 0,
                    completed_count: 0,
                    overdue_count: 0
                });
            }

            const bucket = grouped.get(title);
            bucket.total_count += 1;
            if (isCompleted) {
                bucket.completed_count += 1;
            }
            if (isOverdue) {
                bucket.overdue_count += 1;
                overdueCount += 1;
            }
        });

        const ranked = Array.from(grouped.values())
            .map((item) => ({
                ...item,
                completion_rate: item.total_count > 0
                    ? Math.round((item.completed_count / item.total_count) * 100)
                    : 0
            }))
            .sort((a, b) => {
                if (b.total_count !== a.total_count) return b.total_count - a.total_count;
                if (b.completed_count !== a.completed_count) return b.completed_count - a.completed_count;
                return a.title.localeCompare(b.title, 'zh-Hans-CN');
            })
            .slice(0, top);

        const payload = {
            days,
            top,
            overdue_count: overdueCount,
            status_text: overdueCount > 0 ? `${overdueCount} 条提交逾期超过 3 天` : '最近 3 天无逾期提交',
            items: ranked,
            generated_at: new Date().toISOString()
        };

        setCachedApiValue(cacheKey, payload);
        setPrivateCacheHeaders(res, 20);
        return res.json(payload);
    } catch (error) {
        console.error('Get task completion summary error:', error);
        return res.status(500).json({ error: error.message });
    }
};

// ============================================
// Get Class Obstacles Summary
// ============================================

const getClassObstaclesSummary = async (req, res) => {
    const authTeacherId = getAuthUserId(req);
    const queryTeacherId = String(req.query.teacher_id || '').trim();
    const teacherId = authTeacherId || queryTeacherId;
    const days = parsePositiveInt(req.query.days, 7, 1, 90);
    const cacheKey = `obstacles_summary::${teacherId}::${days}`;

    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.obstacles);
    if (cached) {
        setPrivateCacheHeaders(res, 20);
        return res.json(cached);
    }

    if (!teacherId) {
        return res.status(401).json({ error: '请先登录教师账号' });
    }

    if (authTeacherId && queryTeacherId && authTeacherId !== queryTeacherId) {
        return res.status(403).json({ error: 'teacher_id 与当前登录账号不匹配' });
    }

    try {
        const context = await resolveTeacherContextCached(teacherId);
        if (context.error) {
            return res.status(context.status).json({ error: context.error });
        }

        if (!context.teacherProfile.class_id) {
            return res.json({
                days,
                total: 0,
                by_type: [],
                by_status: []
            });
        }

        const studentIds = context.studentIds || [];
        if (!studentIds.length) {
            return res.json({
                days,
                total: 0,
                by_type: [],
                by_status: []
            });
        }

        const since = new Date();
        since.setDate(since.getDate() - days);

        const { data: rows, error: rowsError } = await supabaseAdmin
            .from('student_obstacles')
            .select('obstacle_type, status, created_at')
            .in('student_id', studentIds)
            .gte('created_at', since.toISOString());

        if (rowsError) {
            if (rowsError.code === '42P01') {
                return res.json({
                    days,
                    total: 0,
                    by_type: [],
                    by_status: []
                });
            }
            return res.status(500).json({ error: rowsError.message });
        }

        const typeMap = new Map();
        const statusMap = new Map();
        for (const row of rows || []) {
            const type = normalizeObstacleType(row.obstacle_type);
            const status = normalizeObstacleStatus(row.status) || 'todo';
            typeMap.set(type, (typeMap.get(type) || 0) + 1);
            statusMap.set(status, (statusMap.get(status) || 0) + 1);
        }

        const payload = {
            days,
            total: (rows || []).length,
            by_type: Array.from(typeMap.entries()).map(([type, count]) => ({ type, count })),
            by_status: Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }))
        };

        setCachedApiValue(cacheKey, payload);
        setPrivateCacheHeaders(res, 20);
        res.json(payload);
    } catch (error) {
        console.error('Teacher class obstacles summary error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Review Submissions (Teacher)
// ============================================

const reviewSubmission = async (req, res) => {
    const teacherId = String(req.user?.id || '').trim();
    const { submissionId } = req.params;
    const action = String(req.body?.action || '').trim().toLowerCase();

    if (!submissionId) {
        return res.status(400).json({ error: 'Missing submissionId' });
    }

    if (!['verified', 'rejected'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
    }

    try {
        const context = await resolveTeacherContextCached(teacherId);
        if (context.error) {
            return res.status(context.status).json({ error: context.error });
        }

        if (!context.studentIds.length) {
            return res.status(403).json({ error: '当前教师暂无可审核学生' });
        }

        const { data: submission, error: submissionError } = await supabaseAdmin
            .from('student_tasks')
            .select('id, student_id, task_id, goal_id, status, completed_at')
            .eq('id', submissionId)
            .single();

        if (submissionError || !submission) {
            return res.status(404).json({ error: '提交记录不存在' });
        }

        if (!context.studentIdSet.has(submission.student_id)) {
            return res.status(403).json({ error: '???????????????' });
        }

        if (String(submission.status || '').trim().toLowerCase() !== 'submitted') {
            return res.json({
                message: '?????????',
                data: submission
            });
        }

        const nextStatus = action === 'verified' ? 'completed' : 'rejected';
        const reviewTime = new Date().toISOString();
        let updated = null;
        let updateError = null;

        ({
            data: updated,
            error: updateError
        } = await supabaseAdmin
            .from('student_tasks')
            .update({ status: nextStatus, updated_at: reviewTime })
            .eq('id', submissionId)
            .eq('status', 'submitted')
            .select('id, student_id, task_id, goal_id, status, completed_at, created_at, updated_at')
            .single());

        if (updateError && isSchemaError(updateError)) {
            ({
                data: updated,
                error: updateError
            } = await supabaseAdmin
                .from('student_tasks')
                .update({ status: nextStatus })
                .eq('id', submissionId)
                .eq('status', 'submitted')
                .select('id, student_id, task_id, goal_id, status, completed_at, created_at')
                .single());
        }

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        if (submission.goal_id) {
            if (action === 'verified') {
                const completedAt = submission.completed_at || new Date().toISOString();
                await supabaseAdmin
                    .from('student_goals')
                    .update({ status: 'completed', completed_at: completedAt })
                    .eq('id', submission.goal_id)
                    .eq('student_id', submission.student_id);
            } else {
                await supabaseAdmin
                    .from('student_goals')
                    .update({ status: 'in_progress', completed_at: null })
                    .eq('id', submission.goal_id)
                    .eq('student_id', submission.student_id);
            }
        }

        invalidateTeacherCaches();
        invalidateStudentCaches(submission.student_id);
        await notifyReviewResult(updated, action);

        return res.json({
            message: '审核成功',
            data: updated
        });
    } catch (error) {
        console.error('Review submission error:', error);
        return res.status(500).json({ error: error.message });
    }
};

const reviewSubmissionsBatch = async (req, res) => {
    const teacherId = String(req.user?.id || '').trim();
    const action = String(req.body?.action || '').trim().toLowerCase();
    const submissionIds = Array.isArray(req.body?.submission_ids)
        ? req.body.submission_ids.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

    if (!['verified', 'rejected'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
    }

    if (!submissionIds.length) {
        return res.status(400).json({ error: 'submission_ids is required' });
    }

    try {
        const context = await resolveTeacherContextCached(teacherId);
        if (context.error) {
            return res.status(context.status).json({ error: context.error });
        }

        if (!context.studentIds.length) {
            return res.status(403).json({ error: '当前教师暂无可审核学生' });
        }

        const { data: rows, error: rowsError } = await supabaseAdmin
            .from('student_tasks')
            .select('id, student_id, task_id, goal_id, status, completed_at')
            .in('id', submissionIds)
            .in('student_id', context.studentIds);

        if (rowsError) {
            return res.status(500).json({ error: rowsError.message });
        }

        const validRows = (rows || []).filter((item) => String(item.status || '').trim().toLowerCase() === 'submitted');
        if (!validRows.length) {
            return res.json({
                message: '???????????',
                updated_count: 0,
                skipped_count: submissionIds.length,
                data: []
            });
        }

        const validIds = validRows.map((item) => item.id);
        const nextStatus = action === 'verified' ? 'completed' : 'rejected';
        const reviewTime = new Date().toISOString();
        let updatedRows = null;
        let updateError = null;

        ({
            data: updatedRows,
            error: updateError
        } = await supabaseAdmin
            .from('student_tasks')
            .update({ status: nextStatus, updated_at: reviewTime })
            .in('id', validIds)
            .eq('status', 'submitted')
            .select('id, student_id, task_id, goal_id, status, completed_at, created_at, updated_at'));

        if (updateError && isSchemaError(updateError)) {
            ({
                data: updatedRows,
                error: updateError
            } = await supabaseAdmin
                .from('student_tasks')
                .update({ status: nextStatus })
                .in('id', validIds)
                .eq('status', 'submitted')
                .select('id, student_id, task_id, goal_id, status, completed_at, created_at'));
        }

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        const goalRows = (updatedRows || []).filter((item) => item.goal_id);
        if (goalRows.length > 0) {
            if (action === 'verified') {
                await Promise.all(goalRows.map((item) =>
                    supabaseAdmin
                        .from('student_goals')
                        .update({ status: 'completed', completed_at: item.completed_at || new Date().toISOString() })
                        .eq('id', item.goal_id)
                        .eq('student_id', item.student_id)
                ));
            } else {
                await Promise.all(goalRows.map((item) =>
                    supabaseAdmin
                        .from('student_goals')
                        .update({ status: 'in_progress', completed_at: null })
                        .eq('id', item.goal_id)
                        .eq('student_id', item.student_id)
                ));
            }
        }

        const touchedStudents = Array.from(new Set((updatedRows || []).map((item) => item.student_id).filter(Boolean)));
        touchedStudents.forEach((studentId) => invalidateStudentCaches(studentId));
        invalidateTeacherCaches();
        await Promise.all((updatedRows || []).map((item) => notifyReviewResult(item, action)));

        return res.json({
            message: '批量审核成功',
            updated_count: (updatedRows || []).length,
            skipped_count: submissionIds.length - (updatedRows || []).length,
            data: updatedRows || []
        });
    } catch (error) {
        console.error('Batch review submissions error:', error);
        return res.status(500).json({ error: error.message });
    }
};

// ============================================
// Get Class Overview (Dashboard BFF)
// ============================================

const ATTENTION_LOOKBACK_DAYS = 14;
const ATTENTION_LEVEL_THRESHOLDS = {
    high: 70,
    medium: 45,
    low: 25
};

const getRiskLevelByScore = (score) => {
    const safeScore = Number(score || 0);
    if (safeScore >= ATTENTION_LEVEL_THRESHOLDS.high) return 'high';
    if (safeScore >= ATTENTION_LEVEL_THRESHOLDS.medium) return 'medium';
    if (safeScore >= ATTENTION_LEVEL_THRESHOLDS.low) return 'low';
    return 'stable';
};

const buildAttentionReasons = (metrics) => {
    const reasons = [];
    if (metrics.recentTotal14d === 0) reasons.push('14天无活跃');
    if (metrics.recentTotal14d > 0 && metrics.recentTotal7d === 0) reasons.push('7天无活跃');
    if (metrics.recentCompletedTasks14d <= 1) reasons.push('任务完成偏低');
    if (metrics.recentSubmittedTasks14d > 0 && metrics.recentCompletedTasks14d === 0) reasons.push('提交待通过较多');
    if (metrics.recentCheckins14d === 0) reasons.push('缺少打卡');
    if (metrics.recentGoals14d === 0 && metrics.goalsCompleted <= 1) reasons.push('目标进展偏慢');
    return reasons;
};

const normalizeAttentionStudent = (student) => ({
    id: student.id,
    full_name: student.full_name,
    avatar_url: student.avatar_url,
    goals_completed: student.goals_completed,
    tasks_completed: student.tasks_completed,
    risk_score: student.risk_score,
    risk_level: student.risk_level,
    risk_text: student.risk_text,
    detail_text: student.detail_text,
    risk_reasons: student.risk_reasons || [],
    action_type: student.action_type,
    last_activity_at: student.last_activity_at,
    recent_completed_tasks_14d: student.recent_completed_tasks_14d,
    recent_submitted_tasks_14d: student.recent_submitted_tasks_14d,
    recent_checkins_14d: student.recent_checkins_14d,
    recent_goal_completions_14d: student.recent_goal_completions_14d,
    recent_total_events_14d: student.recent_total_events_14d
});

const computeAttentionDataset = async (context) => {
    const students = context.students || [];
    if (!students.length) {
        return {
            mergedStudents: [],
            rankedAttention: [],
            attentionSummary: { total: 0, high: 0, medium: 0, low: 0 },
            avgGoals: 0,
            avgTasks: 0,
            optimismScore: 0
        };
    }

    const since14Days = new Date(Date.now() - ATTENTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const since7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
        { data: profileStats, error: profileStatsError },
        { data: taskRows, error: taskRowsError },
        { data: checkinRows, error: checkinRowsError },
        { data: momentRows, error: momentRowsError },
        { data: goalRows, error: goalRowsError }
    ] = await Promise.all([
        supabaseAdmin
            .from('profiles')
            .select('id, goals_completed, tasks_completed')
            .in('id', context.studentIds),
        supabaseAdmin
            .from('student_tasks')
            .select('student_id, status, created_at, completed_at')
            .in('student_id', context.studentIds)
            .gte('created_at', since14Days),
        supabaseAdmin
            .from('student_moods')
            .select('student_id, mood, created_at')
            .in('student_id', context.studentIds)
            .eq('mood', 'checkin')
            .gte('created_at', since14Days),
        supabaseAdmin
            .from('class_moments')
            .select('student_id, created_at')
            .in('student_id', context.studentIds)
            .gte('created_at', since14Days),
        supabaseAdmin
            .from('student_goals')
            .select('student_id, status, created_at, completed_at')
            .in('student_id', context.studentIds)
            .gte('created_at', since14Days)
    ]);

    let safeProfileStats = profileStats || [];
    if (profileStatsError) {
        const profileErrorCode = String(profileStatsError.code || '');
        if (profileErrorCode === '42703') {
            const { data: profileFallback, error: profileFallbackError } = await supabaseAdmin
                .from('profiles')
                .select('id')
                .in('id', context.studentIds);
            if (profileFallbackError) {
                throw profileFallbackError;
            }
            safeProfileStats = (profileFallback || []).map((item) => ({
                id: item.id,
                goals_completed: 0,
                tasks_completed: 0
            }));
        } else {
            throw profileStatsError;
        }
    }
    if (taskRowsError) throw taskRowsError;
    if (checkinRowsError) throw checkinRowsError;
    if (momentRowsError) throw momentRowsError;
    if (goalRowsError) throw goalRowsError;

    const profileMap = new Map((safeProfileStats || []).map((item) => [item.id, item]));
    const studentInsightMap = new Map(
        context.studentIds.map((studentId) => [studentId, {
            recent_total_events_14d: 0,
            recent_total_events_7d: 0,
            recent_completed_tasks_14d: 0,
            recent_submitted_tasks_14d: 0,
            recent_checkins_14d: 0,
            recent_moments_14d: 0,
            recent_goal_completions_14d: 0,
            last_activity_at: null
        }])
    );

    const since14Ts = new Date(since14Days).getTime();
    const since7Ts = new Date(since7Days).getTime();

    const touchActivity = (studentId, timestamp) => {
        const insight = studentInsightMap.get(studentId);
        if (!insight || !timestamp) return;
        const ts = new Date(timestamp).getTime();
        if (!Number.isFinite(ts)) return;
        if (!insight.last_activity_at || ts > new Date(insight.last_activity_at).getTime()) {
            insight.last_activity_at = new Date(ts).toISOString();
        }
        if (ts >= since14Ts) insight.recent_total_events_14d += 1;
        if (ts >= since7Ts) insight.recent_total_events_7d += 1;
    };

    (taskRows || []).forEach((row) => {
        const studentId = row.student_id;
        const insight = studentInsightMap.get(studentId);
        if (!insight) return;
        touchActivity(studentId, row.completed_at || row.created_at);
        if (row.status === 'completed') insight.recent_completed_tasks_14d += 1;
        else if (row.status === 'submitted') insight.recent_submitted_tasks_14d += 1;
    });

    (checkinRows || []).forEach((row) => {
        const insight = studentInsightMap.get(row.student_id);
        if (!insight) return;
        insight.recent_checkins_14d += 1;
        touchActivity(row.student_id, row.created_at);
    });

    (momentRows || []).forEach((row) => {
        const insight = studentInsightMap.get(row.student_id);
        if (!insight) return;
        insight.recent_moments_14d += 1;
        touchActivity(row.student_id, row.created_at);
    });

    (goalRows || []).forEach((row) => {
        const insight = studentInsightMap.get(row.student_id);
        if (!insight) return;
        if (row.status === 'completed') insight.recent_goal_completions_14d += 1;
        touchActivity(row.student_id, row.completed_at || row.created_at);
    });

    const mergedStudents = students.map((student) => {
        const profile = profileMap.get(student.id) || {};
        const insight = studentInsightMap.get(student.id) || {};

        const goalsCompleted = Number(profile.goals_completed || 0);
        const tasksCompleted = Number(profile.tasks_completed || 0);
        const recentTotal14d = Number(insight.recent_total_events_14d || 0);
        const recentTotal7d = Number(insight.recent_total_events_7d || 0);
        const recentCompletedTasks14d = Number(insight.recent_completed_tasks_14d || 0);
        const recentSubmittedTasks14d = Number(insight.recent_submitted_tasks_14d || 0);
        const recentCheckins14d = Number(insight.recent_checkins_14d || 0);
        const recentGoals14d = Number(insight.recent_goal_completions_14d || 0);

        let riskScore = 0;
        let riskText = '趋势: 学习状态平稳';
        let detailText = '最近两周任务参与稳定，建议持续鼓励。';
        let actionType = 'view_profile';

        if (recentTotal14d === 0) {
            riskScore += 85;
            riskText = '趋势: 近14天无学习活跃';
            detailText = '最近两周没有任务、打卡或班级动态记录，建议尽快沟通学习状态。';
            actionType = 'schedule_talk';
        } else if (recentTotal7d === 0) {
            riskScore += 60;
            riskText = '趋势: 近7天活跃下降';
            detailText = '本周暂无学习过程记录，建议安排一次跟进谈话。';
            actionType = 'schedule_talk';
        } else {
            if (recentCompletedTasks14d <= 1) {
                riskScore += 22;
                riskText = '趋势: 任务参与偏低';
                detailText = '近两周完成任务较少，建议在课堂中给予更明确的目标引导。';
            }
            if (recentSubmittedTasks14d > 0 && recentCompletedTasks14d === 0) {
                riskScore += 10;
                detailText = '近期有提交但审核通过少，建议反馈完成标准并再次辅导。';
            }
            if (recentCheckins14d === 0) riskScore += 10;
            if (recentGoals14d === 0 && goalsCompleted <= 1) riskScore += 8;
            if (tasksCompleted <= 3) riskScore += 8;
        }

        const safeRiskScore = Math.min(100, riskScore);
        const riskReasons = buildAttentionReasons({
            recentTotal14d,
            recentTotal7d,
            recentCompletedTasks14d,
            recentSubmittedTasks14d,
            recentCheckins14d,
            recentGoals14d,
            goalsCompleted
        });

        return {
            ...student,
            goals_completed: goalsCompleted,
            tasks_completed: tasksCompleted,
            recent_completed_tasks_14d: recentCompletedTasks14d,
            recent_submitted_tasks_14d: recentSubmittedTasks14d,
            recent_checkins_14d: recentCheckins14d,
            recent_goal_completions_14d: recentGoals14d,
            recent_total_events_14d: recentTotal14d,
            last_activity_at: insight.last_activity_at || null,
            risk_score: safeRiskScore,
            risk_level: getRiskLevelByScore(safeRiskScore),
            risk_text: riskText,
            detail_text: detailText,
            risk_reasons: riskReasons,
            action_type: actionType
        };
    });

    const totalGoals = mergedStudents.reduce((sum, item) => sum + Number(item.goals_completed || 0), 0);
    const totalTasks = mergedStudents.reduce((sum, item) => sum + Number(item.tasks_completed || 0), 0);
    const avgGoals = totalGoals / mergedStudents.length;
    const avgTasks = totalTasks / mergedStudents.length;
    const optimismScore = Math.min(100, Math.max(0, avgGoals * 20 + avgTasks * 8));

    const rankedAttention = [...mergedStudents]
        .filter((item) => Number(item.risk_score || 0) >= ATTENTION_LEVEL_THRESHOLDS.low)
        .sort((a, b) => {
            const scoreDiff = Number(b.risk_score || 0) - Number(a.risk_score || 0);
            if (scoreDiff !== 0) return scoreDiff;
            const timeA = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
            const timeB = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
            return timeA - timeB;
        });

    const attentionSummary = {
        total: rankedAttention.length,
        high: rankedAttention.filter((item) => item.risk_level === 'high').length,
        medium: rankedAttention.filter((item) => item.risk_level === 'medium').length,
        low: rankedAttention.filter((item) => item.risk_level === 'low').length
    };

    return {
        mergedStudents,
        rankedAttention,
        attentionSummary,
        avgGoals,
        avgTasks,
        optimismScore
    };
};

const getAttentionDatasetCached = async (teacherId, context) => {
    const cacheKey = `attention_students::${teacherId}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.teacherContext);
    if (cached) {
        return cached;
    }
    const computed = await computeAttentionDataset(context);
    setCachedApiValue(cacheKey, computed);
    return computed;
};

const getClassOptimismCached = async (teacherId, context) => {
    const cacheKey = `class_optimism::${teacherId}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.teacherContext);
    if (cached) return cached;

    const students = context.students || [];
    if (!students.length) {
        const empty = {
            score: 0,
            delta: 0,
            trend: 'flat',
            trend_text: '暂无学生数据',
            status_text: '等待学生完成打卡与任务后生成指数',
            level: 'unknown',
            sample_size: 0,
            lookback_days: 14,
            components: {
                mood: 0,
                activity: 0,
                completion: 0,
                checkin: 0
            },
            generated_at: new Date().toISOString()
        };
        setCachedApiValue(cacheKey, empty);
        return empty;
    }

    const studentIds = context.studentIds || [];
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const sinceCurrent = new Date(now - 14 * dayMs).toISOString();
    const sincePrevious = new Date(now - 28 * dayMs).toISOString();
    const splitTime = now - 14 * dayMs;

    const moodScoreMap = {
        joy: 95,
        surprise: 82,
        sadness: 30,
        anger: 15,
        disgust: 10,
        fear: 20,
        interest: 90,
        contempt: 8,
        distress: 25,
        happy: 95,
        calm: 80,
        neutral: 70,
        sad: 30,
        angry: 15,
        anxious: 20,
        checkin: 65
    };

    const [moodsRes, tasksRes] = await Promise.all([
        supabaseAdmin
            .from('student_moods')
            .select('student_id, mood, created_at')
            .in('student_id', studentIds)
            .gte('created_at', sincePrevious),
        supabaseAdmin
            .from('student_tasks')
            .select('student_id, status, created_at, completed_at')
            .in('student_id', studentIds)
            .gte('created_at', sincePrevious)
    ]);

    const moodsRows = moodsRes.error && String(moodsRes.error.code || '') === '42P01' ? [] : (moodsRes.data || []);
    const tasksRows = tasksRes.error && String(tasksRes.error.code || '') === '42P01' ? [] : (tasksRes.data || []);
    if (moodsRes.error && String(moodsRes.error.code || '') !== '42P01') throw moodsRes.error;
    if (tasksRes.error && String(tasksRes.error.code || '') !== '42P01') throw tasksRes.error;

    const calcPeriodStats = (periodStartTs, periodEndTs) => {
        const periodMoods = moodsRows.filter((row) => {
            const ts = new Date(row.created_at).getTime();
            return Number.isFinite(ts) && ts >= periodStartTs && ts < periodEndTs;
        });
        const periodTasks = tasksRows.filter((row) => {
            const ts = new Date(row.created_at || row.completed_at).getTime();
            return Number.isFinite(ts) && ts >= periodStartTs && ts < periodEndTs;
        });

        const moodSamples = periodMoods
            .map((row) => moodScoreMap[String(row.mood || '').toLowerCase()])
            .filter((value) => Number.isFinite(value));
        const moodAvg = moodSamples.length
            ? moodSamples.reduce((sum, value) => sum + value, 0) / moodSamples.length
            : 65;

        const activeStudents = new Set();
        periodMoods.forEach((row) => activeStudents.add(row.student_id));
        periodTasks.forEach((row) => activeStudents.add(row.student_id));
        const activityScore = studentIds.length ? (activeStudents.size / studentIds.length) * 100 : 0;

        const completedTasks = periodTasks.filter((row) => row.status === 'completed').length;
        const submittedTasks = periodTasks.filter((row) => row.status === 'submitted').length;
        const completionDenominator = completedTasks + submittedTasks;
        const completionScore = completionDenominator > 0
            ? (completedTasks / completionDenominator) * 100
            : 55;

        const checkinStudents = new Set(
            periodMoods
                .filter((row) => String(row.mood || '').toLowerCase() === 'checkin')
                .map((row) => row.student_id)
        );
        const checkinScore = studentIds.length ? (checkinStudents.size / studentIds.length) * 100 : 0;

        const totalScore = Math.max(0, Math.min(100,
            moodAvg * 0.45 + activityScore * 0.25 + completionScore * 0.2 + checkinScore * 0.1
        ));

        return {
            score: totalScore,
            mood: moodAvg,
            activity: activityScore,
            completion: completionScore,
            checkin: checkinScore,
            sampleSize: activeStudents.size
        };
    };

    const currentStats = calcPeriodStats(new Date(sinceCurrent).getTime(), now);
    const previousStats = calcPeriodStats(new Date(sincePrevious).getTime(), splitTime);

    const score = Math.round(currentStats.score);
    const delta = Math.round(currentStats.score - previousStats.score);
    const trend = delta >= 4 ? 'up' : delta <= -4 ? 'down' : 'flat';
    const trendText = trend === 'up' ? `较上周期提升 ${Math.abs(delta)} 分` : trend === 'down' ? `较上周期下降 ${Math.abs(delta)} 分` : '较上周期基本持平';
    const level = score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 45 ? 'normal' : 'attention';
    const statusText = `近14天覆盖 ${currentStats.sampleSize}/${studentIds.length} 名学生学习记录`;

    const payload = {
        score,
        delta,
        trend,
        trend_text: trendText,
        status_text: statusText,
        level,
        sample_size: currentStats.sampleSize,
        lookback_days: 14,
        components: {
            mood: Math.round(currentStats.mood),
            activity: Math.round(currentStats.activity),
            completion: Math.round(currentStats.completion),
            checkin: Math.round(currentStats.checkin)
        },
        generated_at: new Date().toISOString()
    };

    setCachedApiValue(cacheKey, payload);
    return payload;
};

const getClassOptimism = async (req, res) => {
    const teacherId = String(req.user?.id || '').trim();

    if (!teacherId) {
        return res.status(401).json({ error: '请先登录教师账号' });
    }

    try {
        const context = await resolveTeacherContextCached(teacherId);
        if (context.error) {
            return res.status(context.status).json({ error: context.error });
        }

        const optimism = await getClassOptimismCached(teacherId, context);
        setPrivateCacheHeaders(res, 20);
        return res.json(optimism);
    } catch (error) {
        console.error('Get class optimism error:', error);
        return res.status(500).json({ error: error.message });
    }
};

const publishClassTask = async (req, res) => {
    const teacherId = getAuthUserId(req);
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const pointsRewardRaw = Number(req.body?.points_reward || 5);
    const pointsReward = Number.isFinite(pointsRewardRaw) ? Math.max(1, Math.min(100, Math.round(pointsRewardRaw))) : 5;

    if (!teacherId) {
        return res.status(401).json({ error: '请先登录教师账号' });
    }

    if (!title) {
        return res.status(400).json({ error: '任务标题不能为空' });
    }
    if (title.length > 80) {
        return res.status(400).json({ error: '任务标题最多 80 字' });
    }
    if (description.length > 300) {
        return res.status(400).json({ error: '任务说明最多 300 字' });
    }

    try {
        const context = await resolveTeacherContextCached(teacherId);
        if (context.error) {
            return res.status(context.status).json({ error: context.error });
        }

        const studentIds = Array.isArray(context.studentIds) ? context.studentIds : [];
        if (!studentIds.length) {
            return res.status(400).json({ error: '当前班级暂无学生，无法发布任务' });
        }

        const nowIso = new Date().toISOString();
        const taskRows = studentIds.map((studentId) => ({
            title,
            description: description || null,
            type: 'personal',
            challenge_category: 'teacher_assigned',
            points_reward: pointsReward,
            created_by: studentId,
            created_at: nowIso
        }));

        const { data: insertedTasks, error: taskError } = await supabaseAdmin
            .from('tasks')
            .insert(taskRows)
            .select('id, created_by');

        if (taskError) {
            return res.status(500).json({ error: taskError.message });
        }

        const studentTaskRows = (insertedTasks || []).map((item) => ({
            student_id: item.created_by,
            task_id: item.id,
            status: 'pending',
            created_at: nowIso
        }));

        const { error: studentTaskError } = await supabaseAdmin
            .from('student_tasks')
            .insert(studentTaskRows);

        if (studentTaskError) {
            return res.status(500).json({ error: studentTaskError.message });
        }

        studentIds.forEach((studentId) => invalidateStudentCaches(studentId));
        invalidateTeacherCaches();

        const assignedCount = studentIds.length;
        const createdTasks = (insertedTasks || []).length;
        return res.status(201).json({
            message: '班级任务发布成功',
            assigned_count: assignedCount,
            created_tasks: createdTasks,
            data: {
                title,
                description,
                points_reward: pointsReward,
                assigned_students: assignedCount,
                created_tasks: createdTasks
            }
        });
    } catch (error) {
        console.error('Publish class task error:', error);
        return res.status(500).json({ error: error.message });
    }
};

const getClassOverview = async (req, res) => {
    const teacherId = String(req.user?.id || '').trim();
    const cacheKey = `class_overview::${teacherId}`;

    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.teacherContext);
    if (cached) {
        setPrivateCacheHeaders(res, 30);
        return res.json(cached);
    }

    try {
        const context = await resolveTeacherContextCached(teacherId);
        if (context.error) {
            return res.status(context.status).json({ error: context.error });
        }

        const students = context.students || [];
        let dataset = null;
        try {
            dataset = await getAttentionDatasetCached(teacherId, context);
        } catch (datasetError) {
            console.error('Get attention dataset fallback:', datasetError);
            dataset = {
                rankedAttention: [],
                attentionSummary: { total: 0, high: 0, medium: 0, low: 0 },
                avgGoals: 0,
                avgTasks: 0,
                optimismScore: 0
            };
        }

        let optimism = null;
        try {
            optimism = await getClassOptimismCached(teacherId, context);
        } catch (optimismError) {
            console.error('Get class optimism fallback:', optimismError);
            optimism = { score: 0 };
        }

        const attentionStudents = (dataset.rankedAttention || []).slice(0, 3).map(normalizeAttentionStudent);

        const payload = {
            class_id: context.teacherProfile.class_id,
            total_students: students.length,
            optimism_score: Math.round(optimism.score || dataset.optimismScore || 0),
            avg_goals_completed: dataset.avgGoals || 0,
            avg_tasks_completed: dataset.avgTasks || 0,
            attention_students: attentionStudents,
            attention_summary: dataset.attentionSummary || { total: 0, high: 0, medium: 0, low: 0 }
        };

        setCachedApiValue(cacheKey, payload);
        setPrivateCacheHeaders(res, 30);
        res.json(payload);
    } catch (error) {
        console.error('Get class overview error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getAttentionStudents = async (req, res) => {
    const teacherId = String(req.user?.id || '').trim();
    const page = parsePositiveInt(req.query.page, 1, 1, 5000);
    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const level = String(req.query.level || 'all').trim().toLowerCase();
    const q = String(req.query.q || '').trim().toLowerCase();

    if (!teacherId) {
        return res.status(401).json({ error: '请先登录教师账号' });
    }

    try {
        const context = await resolveTeacherContextCached(teacherId);
        if (context.error) {
            return res.status(context.status).json({ error: context.error });
        }

        const dataset = await getAttentionDatasetCached(teacherId, context);
        let rows = [...(dataset.rankedAttention || [])];

        if (['high', 'medium', 'low'].includes(level)) {
            rows = rows.filter((item) => item.risk_level === level);
        }

        if (q) {
            rows = rows.filter((item) => {
                const name = String(item.full_name || '').toLowerCase();
                const reasons = (item.risk_reasons || []).join(' ').toLowerCase();
                const riskText = String(item.risk_text || '').toLowerCase();
                return name.includes(q) || reasons.includes(q) || riskText.includes(q);
            });
        }

        const total = rows.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const safePage = Math.min(page, totalPages);
        const start = (safePage - 1) * limit;
        const items = rows.slice(start, start + limit).map(normalizeAttentionStudent);

        setPrivateCacheHeaders(res, 20);
        return res.json({
            items,
            pagination: {
                page: safePage,
                limit,
                total,
                total_pages: totalPages,
                has_prev: safePage > 1,
                has_next: safePage < totalPages
            },
            summary: dataset.attentionSummary || { total: 0, high: 0, medium: 0, low: 0 }
        });
    } catch (error) {
        console.error('Get attention students error:', error);
        return res.status(500).json({ error: error.message });
    }
};

// ============================================
// Schedule CRUD
// ============================================

const getSchedules = async (req, res) => {
    const teacherId = getAuthUserId(req);
    try {
        const { data, error } = await supabaseAdmin
            .from('teacher_schedules')
            .select('*')
            .eq('teacher_id', teacherId)
            .gte('scheduled_date', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0])
            .order('scheduled_date', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(20);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Get schedules error:', error);
        res.status(500).json({ error: error.message });
    }
};

const createSchedule = async (req, res) => {
    const teacherId = getAuthUserId(req);
    const { title, description, scheduled_date } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: '标题不能为空' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('teacher_schedules')
            .insert({
                teacher_id: teacherId,
                title: title.trim(),
                description: (description || '').trim(),
                scheduled_date: scheduled_date || new Date().toISOString().split('T')[0],
                is_completed: false
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        console.error('Create schedule error:', error);
        res.status(500).json({ error: error.message });
    }
};

const updateSchedule = async (req, res) => {
    const teacherId = getAuthUserId(req);
    const { scheduleId } = req.params;
    const { title, description, scheduled_date } = req.body;

    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description.trim();
    if (scheduled_date !== undefined) updates.scheduled_date = scheduled_date;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: '没有需要更新的字段' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('teacher_schedules')
            .update(updates)
            .eq('id', scheduleId)
            .eq('teacher_id', teacherId)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: '日程不存在' });
        res.json(data);
    } catch (error) {
        console.error('Update schedule error:', error);
        res.status(500).json({ error: error.message });
    }
};

const deleteSchedule = async (req, res) => {
    const teacherId = getAuthUserId(req);
    const { scheduleId } = req.params;

    try {
        const { error } = await supabaseAdmin
            .from('teacher_schedules')
            .delete()
            .eq('id', scheduleId)
            .eq('teacher_id', teacherId);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error('Delete schedule error:', error);
        res.status(500).json({ error: error.message });
    }
};

const toggleScheduleComplete = async (req, res) => {
    const teacherId = getAuthUserId(req);
    const { scheduleId } = req.params;

    try {
        // 先获取当前状态
        const { data: current, error: fetchError } = await supabaseAdmin
            .from('teacher_schedules')
            .select('is_completed')
            .eq('id', scheduleId)
            .eq('teacher_id', teacherId)
            .single();

        if (fetchError) throw fetchError;
        if (!current) return res.status(404).json({ error: '日程不存在' });

        const { data, error } = await supabaseAdmin
            .from('teacher_schedules')
            .update({ is_completed: !current.is_completed })
            .eq('id', scheduleId)
            .eq('teacher_id', teacherId)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Toggle schedule complete error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Multi-Dream Analytics (Teacher Dashboard)
// ============================================

const getClassDreamAnalytics = async (req, res) => {
    const teacherId = getAuthUserId(req);
    const cacheKey = `class_dream_analytics::${teacherId}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.classOverview);
    if (cached) {
        return res.json(cached);
    }

    try {
        const profileResult = await getTeacherProfileCached(teacherId);
        if (profileResult.error) {
            return res.status(profileResult.status).json({ error: profileResult.error });
        }

        const classId = profileResult.teacherProfile?.class_id;
        if (!classId) {
            return res.status(400).json({ error: '教师尚未绑定班级' });
        }

        // Get all students in class
        const { data: students, error: studentsError } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name')
            .eq('class_id', classId)
            .eq('role', 'student');

        if (studentsError) {
            return res.status(500).json({ error: studentsError.message });
        }

        const studentIds = (students || []).map(s => s.id);

        if (studentIds.length === 0) {
            return res.json({
                student_count: 0,
                multi_dream_students: 0,
                single_dream_students: 0,
                avg_dreams_per_student: 0,
                dream_status_distribution: { active: 0, paused: 0, completed: 0 },
                top_dreams: [],
                insights: []
            });
        }

        // Get all goals for students in this class
        const { data: goals, error: goalsError } = await supabaseAdmin
            .from('student_goals')
            .select('student_id, title, dream_status, priority, progress')
            .in('student_id', studentIds);

        if (goalsError) {
            return res.status(500).json({ error: goalsError.message });
        }

        // Calculate analytics
        const studentDreamCounts = {};
        const dreamStatusCounts = { active: 0, paused: 0, completed: 0 };
        const dreamTitleCounts = {};

        (goals || []).forEach(goal => {
            // Count per student
            studentDreamCounts[goal.student_id] = (studentDreamCounts[goal.student_id] || 0) + 1;

            // Status distribution
            if (dreamStatusCounts[goal.dream_status] !== undefined) {
                dreamStatusCounts[goal.dream_status]++;
            }

            // Top dreams
            const title = goal.title || '未命名期待';
            if (!dreamTitleCounts[title]) {
                dreamTitleCounts[title] = { count: 0, progress_sum: 0 };
            }
            dreamTitleCounts[title].count++;
            dreamTitleCounts[title].progress_sum += goal.progress || 0;
        });

        // Multi-dream vs single-dream students
        let multiDreamStudents = 0;
        let singleDreamStudents = 0;
        let noDreamStudents = 0;

        studentIds.forEach(id => {
            const count = studentDreamCounts[id] || 0;
            if (count >= 2) multiDreamStudents++;
            else if (count === 1) singleDreamStudents++;
            else noDreamStudents++;
        });

        // Calculate averages per dream title
        const topDreams = Object.entries(dreamTitleCounts)
            .map(([title, data]) => ({
                title,
                count: data.count,
                avg_progress: Math.round(data.progress_sum / data.count)
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // Total dreams
        const totalDreams = goals?.length || 0;
        const avgDreamsPerStudent = studentIds.length > 0 ? (totalDreams / studentIds.length).toFixed(1) : 0;

        // Generate insights
        const insights = [];
        if (multiDreamStudents > singleDreamStudents) {
            insights.push('班内多期待学生占多数，建议关注时间分配平衡');
        }
        if (dreamStatusCounts.completed > 0) {
            insights.push(`${dreamStatusCounts.completed} 个期待已完成，可以继续鼓励学生完成更多`);
        }
        if (dreamStatusCounts.paused > dreamStatusCounts.active) {
            insights.push('暂停的期待较多，建议了解学生遇到的困难');
        }
        if (noDreamStudents > 0) {
            insights.push(`${noDreamStudents} 位学生还没有设定期待，可以引导他们添加`);
        }

        const result = {
            student_count: studentIds.length,
            multi_dream_students: multiDreamStudents,
            single_dream_students: singleDreamStudents,
            no_dream_students: noDreamStudents,
            total_dreams: totalDreams,
            avg_dreams_per_student: parseFloat(avgDreamsPerStudent),
            dream_status_distribution: dreamStatusCounts,
            top_dreams: topDreams,
            insights
        };

        setCachedApiValue(cacheKey, result);
        setPrivateCacheHeaders(res, 60);
        res.json(result);
    } catch (error) {
        console.error('Get class dream analytics error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getProfile,
    updateProfile,
    uploadAvatar,
    getClass,
    updateClassInfo,
    refreshClassInviteCode,
    getStudents,
    getSubmissions,
    getTaskCompletionSummary,
    getClassObstaclesSummary,
    reviewSubmission,
    reviewSubmissionsBatch,
    getClassOverview,
    getClassOptimism,
    getAttentionStudents,
    publishClassTask,
    getSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleScheduleComplete,
    getClassDreamAnalytics
};
