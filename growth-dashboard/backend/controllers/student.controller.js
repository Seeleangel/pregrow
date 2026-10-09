/**
 * Student Controller
 * 瀛︾敓鐩稿叧鎺у埗锟?
 */

const pathModule = require('path');
const { supabaseAdmin } = require('../middlewares/auth');
const { uploadBase64Image } = require('../services/storageService');
const cacheService = require('../services/cacheService');
const statsService = require('../services/statsService');
const aiService = require('../services/aiService');
const { syncStudentStickerBadges, getStickerRuleByBadgeName } = require('../services/badgeService');
const { createNotification, createNotifications, NotificationTypes } = require('./notification.controller');

const {
    getCachedApiValue,
    setCachedApiValue,
    clearCachedApiByPrefix,
    invalidateStudentCaches,
    invalidateStudentAiCaches,
    API_CACHE_TTL_MS
} = cacheService;

const {
    parsePositiveInt,
    calculateLevelProgress,
    getTaskBasedStreak,
    getCheckinStatus,
    normalizeDreamList,
    buildDreamContext,
    normalizeObstacleType,
    normalizeObstacleStatus
} = statsService;

const MOOD_POSITIVITY_MAP = {
    joy: 0.95,
    surprise: 0.8,
    sadness: 0.2,
    anger: 0.08,
    disgust: 0.05,
    fear: 0.15,
    interest: 0.9,
    contempt: 0.05,
    distress: 0.12,
    happy: 0.95,
    calm: 0.8,
    neutral: 0.5,
    sad: 0.2,
    angry: 0.08,
    anxious: 0.15,
    checkin: 0.65
};

const normalizeMoodKey = (mood) => String(mood || '').trim().toLowerCase();
const getMoodPositivityScore = (mood) => MOOD_POSITIVITY_MAP[normalizeMoodKey(mood)] ?? 0.5;

const getStudentTeachers = async (studentId) => {
    const { data: studentProfile, error: studentError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, class_id')
        .eq('id', studentId)
        .maybeSingle();

    if (studentError) {
        console.error('Load student profile for notifications failed:', studentError);
        return { studentName: '学生', teacherIds: [] };
    }

    const studentName = String(studentProfile?.full_name || '学生').trim() || '学生';
    const classId = studentProfile?.class_id || null;

    if (!classId) {
        return { studentName, teacherIds: [] };
    }

    const { data: teachers, error: teacherError } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('role', 'teacher')
        .eq('class_id', classId);

    if (teacherError) {
        console.error('Load teacher recipients for notifications failed:', teacherError);
        return { studentName, teacherIds: [] };
    }

    return {
        studentName,
        teacherIds: (teachers || []).map((item) => String(item.id || '').trim()).filter(Boolean)
    };
};

const notifySubmissionCreated = async ({
    studentId,
    kind,
    title,
    submissionId,
    taskId = null,
    goalId = null
}) => {
    const safeTitle = String(title || '').trim() || (kind === 'goal' ? '目标' : '今日计划');
    const { studentName, teacherIds } = await getStudentTeachers(studentId);

    await createNotification(
        studentId,
        NotificationTypes.SUBMISSION_PENDING,
        '已提交给老师审核',
        `“${safeTitle}”已提交，等待老师审核。`,
        {
            status: 'submitted',
            kind,
            submission_id: submissionId || null,
            task_id: taskId,
            goal_id: goalId,
            target_url: kind === 'goal' ? 'portfolio.html' : 'dashboard.html#today-plan'
        }
    );

    if (!teacherIds.length) {
        return;
    }

    await createNotifications(teacherIds.map((teacherId) => ({
        user_id: teacherId,
        type: NotificationTypes.SUBMISSION_PENDING,
        title: `${studentName}提交了新材料`,
        content: `请审核“${safeTitle}”的完成材料。`,
        data: {
            status: 'submitted',
            kind,
            student_id: studentId,
            submission_id: submissionId || null,
            task_id: taskId,
            goal_id: goalId,
            target_url: 'submissions.html'
        }
    })));
};

// ============================================
// Tasks
// ============================================

const getTasks = async (req, res) => {
    const studentId = req.query.student_id ? String(req.query.student_id) : '';
    const limit = parsePositiveInt(req.query.limit, 200, 20, 500);
    const cacheKey = `tasks::${studentId || 'public'}::${limit}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.tasks);
    if (cached) return res.json(cached);

    try {
        if (!studentId) {
            const { data, error } = await supabaseAdmin
                .from('tasks')
                .select('*')
                .neq('type', 'personal')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) {
                console.error('Error fetching public tasks:', error);
                return res.status(500).json({ error: error.message });
            }

            setCachedApiValue(cacheKey, data);
            return res.json(data);
        }

        const [sharedResult, personalResult] = await Promise.all([
            supabaseAdmin
                .from('tasks')
                .select('*')
                .neq('type', 'personal')
                .order('created_at', { ascending: false })
                .limit(limit),
            supabaseAdmin
                .from('tasks')
                .select('*')
                .eq('type', 'personal')
                .eq('created_by', studentId)
                .order('created_at', { ascending: false })
                .limit(limit)
        ]);

        if (sharedResult.error) {
            return res.status(500).json({ error: sharedResult.error.message });
        }
        if (personalResult.error) {
            return res.status(500).json({ error: personalResult.error.message });
        }

        const merged = [...(sharedResult.data || []), ...(personalResult.data || [])]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit);

        setCachedApiValue(cacheKey, merged);
        res.json(merged);
    } catch (error) {
        console.error('Get tasks error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Mood
// ============================================

const submitMood = async (req, res) => {
    const { student_id, mood, note } = req.body;
    if (!student_id || !mood) {
        return res.status(400).json({ error: 'Missing student_id or mood' });
    }

    const { data, error } = await supabaseAdmin
        .from('student_moods')
        .insert([{ student_id, mood, note }])
        .select();

    if (error) {
        console.error('Error submitting mood:', error);
        return res.status(500).json({ error: error.message });
    }
    invalidateStudentCaches(student_id);
    res.json({ message: 'Mood recorded', data });
};

// ============================================
// Check-in
// ============================================

const getCheckinStatusHandler = async (req, res) => {
    const { id } = req.params;
    const cacheKey = `checkin::${id}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.checkin);
    if (cached) return res.json(cached);

    try {
        const result = await getCheckinStatus(id);
        const fallbackStreak = result.streak > 0 ? result.streak : await getTaskBasedStreak(id);
        const merged = {
            ...result,
            streak: fallbackStreak
        };
        setCachedApiValue(cacheKey, merged);
        res.json(merged);
    } catch (error) {
        console.error('Error fetching check-in status:', error);
        res.status(500).json({ error: error.message });
    }
};

const submitCheckin = async (req, res) => {
    const { id } = req.params;

    try {
        clearCachedApiByPrefix(`checkin::${id}`);
        const statusBefore = await getCheckinStatus(id);
        if (statusBefore.checkedInToday) {
            return res.json({
                message: 'Already checked in today',
                checked_in_today: true,
                streak: statusBefore.streak,
                already_checked_in: true
            });
        }

        const { data, error } = await supabaseAdmin
            .from('student_moods')
            .insert([{ student_id: id, mood: 'checkin', note: 'daily checkin' }])
            .select();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // 鎺ㄥ streak +1锛岄伩鍏嶄簩锟?DB 鏌ヨ
        invalidateStudentCaches(id);
        res.json({
            message: 'Check-in recorded',
            checked_in_today: true,
            streak: statusBefore.streak + 1,
            already_checked_in: false,
            data
        });
    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Growth Stats
// ============================================

const getGrowthStats = async (req, res) => {
    const { id } = req.params;
    const timelineLimit = parsePositiveInt(req.query.limit, 15, 1, 100);
    const timelineOffset = parsePositiveInt(req.query.offset, 0, 0, 5000);
    const timelineWindow = timelineLimit + timelineOffset;
    const cacheKey = `growth_stats::${id}::${timelineLimit}::${timelineOffset}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.growthStats);
    if (cached) return res.json(cached);

    try {
        let createdDate = new Date();
        try {
            const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(id);
            if (user && user.created_at) {
                createdDate = new Date(user.created_at);
            }
        } catch (e) {
            console.error('Failed to get user creation date', e);
        }

        const account_age_days = Math.max(1, Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24)));

        // 鎸戞垬璁℃暟闂幆锟?0棰樺畬鏁存祴璇曟墠锟?娆℃寫锟?
        const CHALLENGE_QUESTIONS_PER_TEST = 10;
        const parseChallengeAnswerType = (notes) => {
            const raw = String(notes || '');
            const matched = raw.match(/绫诲瀷\s*:\s*(positive|negative)/i);
            return matched ? String(matched[1]).toLowerCase() : '';
        };

        const fetchCompletedTasksForGrowth = async () => {
            const trySelect = async (selectClause) => {
                const { data, error } = await supabaseAdmin
                    .from('student_tasks')
                    .select(selectClause)
                    .eq('student_id', id)
                    .eq('status', 'completed')
                    .order('completed_at', { ascending: false })
                    .limit(2000);
                return { data, error };
            };

            let result = await trySelect('completed_at, notes, proof_note, proof_url, tasks ( challenge_category, title, type, description )');

            if (result.error && String(result.error.code || '') === '42703') {
                result = await trySelect('completed_at, notes, tasks ( challenge_category, title, type, description )');
            }

            if (result.error && String(result.error.code || '') === '42703') {
                result = await trySelect('completed_at, tasks ( challenge_category, title, type, description )');
            }

            if (result.error) {
                throw result.error;
            }

            return Array.isArray(result.data) ? result.data : [];
        };

        const getTotalCheckinDays = async () => {
            // 浼樺寲锛氫娇锟?RPC 鎴栧崟娆℃煡璇㈣幏鍙栧幓閲嶅ぉ鏁帮紝閬垮厤鍏ㄩ噺鍒嗛〉鎵弿
            try {
                // 鏂规1锛氬皾锟?RPC 璋冪敤锛堝鏋滃瓨锟?get_checkin_day_count 鍑芥暟锟?
                const { data: rpcData, error: rpcError } = await supabaseAdmin
                    .rpc('get_checkin_day_count', { p_student_id: id });
                if (!rpcError && rpcData !== null && rpcData !== undefined) {
                    return Number(rpcData) || 0;
                }
            } catch (_) {}

            // 鏂规2锛氬洖閫€ 锟?鍙煡 created_at 瀛楁锛屽崟娆℃煡锟?+ JS 鍘婚噸
            // 姣斿惊鐜垎椤甸珮鏁堝緱澶氾紙鍗曟璇锋眰锛孲upabase 鍐呴儴椤哄簭鎵弿锟?
            const { data, error } = await supabaseAdmin
                .from('student_moods')
                .select('created_at')
                .eq('student_id', id)
                .eq('mood', 'checkin')
                .limit(10000);

            if (error) throw error;

            const uniqueDays = new Set();
            (Array.isArray(data) ? data : []).forEach((item) => {
                if (!item?.created_at) return;
                uniqueDays.add(new Date(item.created_at).toISOString().slice(0, 10));
            });
            return uniqueDays.size;
        };

        const [{ count: totalMoments }, checkinData, totalCheckinDays, completedTasks, { data: recentMoments, error: recentMomentsError }, { data: likedMomentRows, error: likedMomentsError }] = await Promise.all([
            supabaseAdmin.from('class_moments').select('*', { count: 'exact', head: true }).eq('student_id', id),
            getCheckinStatus(id),
            getTotalCheckinDays(),
            fetchCompletedTasksForGrowth(),
            supabaseAdmin
                .from('class_moments')
                .select('id, content, type, created_at')
                .eq('student_id', id)
                .order('created_at', { ascending: false })
                .limit(Math.max(1, timelineWindow)),
            supabaseAdmin
                .from('class_moments')
                .select('likes')
                .eq('student_id', id)
                .limit(5000)
        ]);

        if (recentMomentsError) {
            throw recentMomentsError;
        }
        if (likedMomentsError && String(likedMomentsError.code || '') !== '42703') {
            throw likedMomentsError;
        }

        const totalLikes = (Array.isArray(likedMomentRows) ? likedMomentRows : [])
            .reduce((sum, row) => sum + Math.max(0, Number(row?.likes) || 0), 0);

        const radarCount = { 'school': 0, 'home': 0, 'social': 0, 'emotion': 0, 'other': 0 };
        const activityByDate = {};

        const isChallengeEntry = (item) => {
            const taskType = String(item?.tasks?.type || '').toLowerCase();
            if (taskType === 'challenge') return true;
            const noteText = String(item?.notes || '');
            return /绫诲瀷\s*:\s*(positive|negative)/i.test(noteText);
        };

        const allCompletedTasks = Array.isArray(completedTasks) ? completedTasks : [];
        const challengeAnswers = allCompletedTasks
            .filter((item) => isChallengeEntry(item))
            .sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));

        const nonChallengeTasks = allCompletedTasks
            .filter((item) => !isChallengeEntry(item));

        const completeChallengeSessions = [];
        for (let index = 0; index + CHALLENGE_QUESTIONS_PER_TEST - 1 < challengeAnswers.length; index += CHALLENGE_QUESTIONS_PER_TEST) {
            const chunk = challengeAnswers.slice(index, index + CHALLENGE_QUESTIONS_PER_TEST);
            const categoryCount = {};
            let positiveCount = 0;

            chunk.forEach((entry) => {
                const answerType = parseChallengeAnswerType(entry.notes);
                if (answerType === 'positive') positiveCount += 1;
                const category = String(entry.tasks?.challenge_category || 'other');
                categoryCount[category] = (categoryCount[category] || 0) + 1;
            });

            const topCategory = Object.entries(categoryCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
            const sessionStart = chunk[0]?.completed_at || null;
            const sessionEnd = chunk[chunk.length - 1]?.completed_at || sessionStart;
            const sessionIndex = completeChallengeSessions.length + 1;
            const negativeCount = Math.max(0, CHALLENGE_QUESTIONS_PER_TEST - positiveCount);

            completeChallengeSessions.push({
                session_index: sessionIndex,
                started_at: sessionStart,
                ended_at: sessionEnd,
                top_category: topCategory,
                question_count: CHALLENGE_QUESTIONS_PER_TEST,
                positive_count: positiveCount,
                negative_count: negativeCount
            });
        }

        nonChallengeTasks.forEach((taskItem) => {
            const category = taskItem.tasks?.challenge_category || 'other';
            if (radarCount[category] !== undefined) radarCount[category] += 1;
            else radarCount.other += 1;

            const dateKey = new Date(taskItem.completed_at).toISOString().split('T')[0];
            activityByDate[dateKey] = (activityByDate[dateKey] || 0) + 1;
        });

        completeChallengeSessions.forEach((session) => {
            const category = session.top_category || 'other';
            if (radarCount[category] !== undefined) radarCount[category] += 1;
            else radarCount.other += 1;

            const dateKey = new Date(session.ended_at).toISOString().split('T')[0];
            activityByDate[dateKey] = (activityByDate[dateKey] || 0) + 1;
        });

        const trend = [];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        thirtyDaysAgo.setHours(0, 0, 0, 0);

        // 濡傛灉鐢ㄦ埛娉ㄥ唽鏃堕棿锟?0澶╁唴锛屼粠娉ㄥ唽閭ｅぉ寮€濮嬫埅鏂紝鍚﹀垯鏄剧ず30锟?
        const trendStartDate = createdDate > thirtyDaysAgo ? createdDate : thirtyDaysAgo;
        const trendDaysCount = Math.floor((new Date() - trendStartDate) / (1000 * 60 * 60 * 24)) + 1;

        for (let i = trendDaysCount - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateKey = d.toISOString().split('T')[0];
            trend.push({ date: dateKey.substring(5), count: activityByDate[dateKey] || 0 });
        }

        // recentMoments 宸插湪涓婃柟 Promise.all 涓苟琛屾煡锟?

        const timeline = [];
        nonChallengeTasks
            .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
            .slice(0, Math.max(1, timelineWindow))
            .forEach(t => {
                const taskTitle = t.tasks?.title || '';
                const isObstacle = taskTitle.startsWith('鍏嬫湇闃荤');
                const isPersonal = t.tasks?.type === 'personal';
                const label = isObstacle ? 'Completed a dream obstacle' : isPersonal ? 'Completed a daily plan task' : 'Completed a growth challenge';
                timeline.push({
                    type: 'task',
                    title: label,
                    desc: t.proof_note || t.tasks?.description || t.tasks?.title || '',
                    date: t.completed_at,
                    detail: {
                        task_title: t.tasks?.title || '',
                        task_type: t.tasks?.type || 'task',
                        proof_note: t.proof_note || '',
                        proof_url: t.proof_url || ''
                    }
                });
            });

        completeChallengeSessions.forEach((session) => {
            timeline.push({
                type: 'challenge_session',
                title: `完成第 ${session.session_index} 次成长挑战`,
                desc: `本次共 ${session.question_count} 题：积极选择 ${session.positive_count} 次，坚持努力 ${session.negative_count} 次。`,
                date: session.ended_at,
                detail: {
                    session_index: session.session_index,
                    question_count: session.question_count,
                    positive_count: session.positive_count,
                    negative_count: session.negative_count,
                    top_category: session.top_category,
                    started_at: session.started_at,
                    ended_at: session.ended_at
                }
            });
        });

        (recentMoments || []).forEach(m => {
            timeline.push({
                type: 'moment',
                title: 'Posted a new class moment',
                desc: m.content,
                date: m.created_at,
                detail: {
                    moment_type: m.type || 'post',
                    content: m.content || ''
                }
            });
        });
        timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

        const timelineTotal = timeline.length;
        const pagedTimeline = timeline.slice(timelineOffset, timelineOffset + timelineLimit);

        const result = {
            account_age_days,
            metrics: {
                total_challenges: completeChallengeSessions.length,
                total_portfolios: totalMoments || 0,
                total_moments: totalMoments || 0,
                likes: totalLikes,
                likes_received: totalLikes,
                streak: checkinData?.streak || 0,
                total_checkin_days: totalCheckinDays || 0
            },
            challenge_session_rule: {
                questions_per_session: CHALLENGE_QUESTIONS_PER_TEST,
                completed_sessions: completeChallengeSessions.length,
                pending_questions: challengeAnswers.length % CHALLENGE_QUESTIONS_PER_TEST
            },
            radar: radarCount,
            trend,
            timeline: pagedTimeline,
            timeline_pagination: {
                limit: timelineLimit,
                offset: timelineOffset,
                total: timelineTotal,
                has_more: timelineOffset + pagedTimeline.length < timelineTotal
            }
        };
        setCachedApiValue(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Growth Stats Error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Student Tasks (Today Plan)
// ============================================

const getStudentTasks = async (req, res) => {
    const { id } = req.params;
    const limit = parsePositiveInt(req.query.limit, 300, 20, 1000);
    const cacheKey = `student_tasks::${id}::${limit}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.studentTasks);
    if (cached) return res.json(cached);

    try {
        let data = null;
        let error = null;

        const primaryResult = await supabaseAdmin
            .from('student_tasks')
            .select('id, task_id, goal_id, status, proof_url, proof_note, completed_at, created_at')
            .eq('student_id', id)
            .is('goal_id', null)
            .order('created_at', { ascending: false })
            .limit(limit);

        data = primaryResult.data;
        error = primaryResult.error;

        if (error && String(error.code || '') === '42703') {
            const fallbackResult = await supabaseAdmin
                .from('student_tasks')
                .select('id, task_id, status, completed_at, created_at')
                .eq('student_id', id)
                .order('created_at', { ascending: false })
                .limit(limit);
            data = fallbackResult.data;
            error = fallbackResult.error;
        }

        if (error) return res.status(500).json({ error: error.message });
        setCachedApiValue(cacheKey, data || []);
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createTodayPlan = async (req, res) => {
    const { id } = req.params;
    const { task_ids, title, description, points_reward } = req.body;

    // 鏀寔涓ょ妯″紡锟?
    // 1. 娣诲姞鐜版湁浠诲姟鍒拌锟? { task_ids: [...] }
    // 2. 鍒涘缓鏂扮殑涓汉浠诲姟骞舵坊鍔犲埌璁″垝: { title, description, points_reward }
    const isNewTask = title && !task_ids;

    try {
        if (isNewTask) {
            // 鍒涘缓鏂扮殑涓汉浠诲姟
            const { data: newTask, error: taskError } = await supabaseAdmin
                .from('tasks')
                .insert([{
                    title: title.trim(),
                    description: description?.trim() || null,
                    type: 'personal',
                    points_reward: points_reward || 5,
                    created_by: id
                }])
                .select()
                .single();

            if (taskError) {
                return res.status(500).json({ error: taskError.message });
            }

            // 娣诲姞鍒板鐢熶换鍔″垪锟?
            const { data: studentTask, error: insertError } = await supabaseAdmin
                .from('student_tasks')
                .insert([{
                    student_id: id,
                    task_id: newTask.id,
                    status: 'pending',
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();

            if (insertError) {
                return res.status(500).json({ error: insertError.message });
            }

            invalidateStudentCaches(id);
            res.status(201).json({ task: newTask, studentTask });
        } else {
            // 娣诲姞鐜版湁浠诲姟鍒拌锟?
            if (!Array.isArray(task_ids) || task_ids.length === 0) {
                return res.status(400).json({ error: 'Please select at least one task' });
            }

            const inserts = task_ids.map(taskId => ({
                student_id: id,
                task_id: taskId,
                status: 'pending',
                created_at: new Date().toISOString()
            }));

            const { data, error } = await supabaseAdmin
                .from('student_tasks')
                .insert(inserts)
                .select();

            if (error) return res.status(500).json({ error: error.message });

            invalidateStudentCaches(id);
            res.status(201).json(data);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteTodayPlan = async (req, res) => {
    const { id, taskId } = req.params;

    try {
        // 1) Try delete by student_tasks.id
        const { data: deletedById } = await supabaseAdmin
            .from('student_tasks')
            .delete()
            .eq('student_id', id)
            .eq('id', taskId)
            .select('id');

        if (deletedById && deletedById.length > 0) {
            invalidateStudentCaches(id);
            return res.json({ message: 'Task removed from plan' });
        }

        // 2) Try delete by task_id
        const { data: deletedByTaskId } = await supabaseAdmin
            .from('student_tasks')
            .delete()
            .eq('student_id', id)
            .eq('task_id', taskId)
            .select('id');

        if (deletedByTaskId && deletedByTaskId.length > 0) {
            invalidateStudentCaches(id);
            return res.json({ message: 'Task removed from plan' });
        }

        // 3) No student_tasks row 锟?delete the personal task from tasks table directly
        const { error: taskDelErr } = await supabaseAdmin
            .from('tasks')
            .delete()
            .eq('id', taskId)
            .eq('created_by', id)
            .eq('type', 'personal');

        if (taskDelErr) return res.status(500).json({ error: taskDelErr.message });

        invalidateStudentCaches(id);
        res.json({ message: 'Task removed from plan' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Complete Task with Evidence Photo
// ============================================

const completeTaskWithEvidence = async (req, res) => {
    const { id, taskId } = req.params;
    const { imageBase64, mimeType: rawMime, proofNote } = req.body || {};
    const sanitizedProofNote = String(proofNote || '').trim();

    if (!imageBase64 && !sanitizedProofNote) {
        return res.status(400).json({ error: '请至少提交一张图片或一句说明' });
    }

    if (sanitizedProofNote.length > 300) {
        return res.status(400).json({ error: 'Proof note must be at most 300 characters' });
    }

    // Sanitise mime type
    const mimeType = rawMime && rawMime.startsWith('image/') ? rawMime : 'image/jpeg';

    try {
        let evidenceUrl = null;
        if (imageBase64) {
            try {
                const fileName = `evidence/${id}/${taskId}_${Date.now()}.jpg`;
                evidenceUrl = await uploadBase64Image(imageBase64, fileName, mimeType);
            } catch (uploadErr) {
                console.error('Evidence upload failed:', uploadErr.message);
                return res.status(500).json({ error: '提交材料上传失败，请稍后重试' });
            }
        }

        const completedAt = new Date().toISOString();
        let data = null;
        let error = null;

        // 2) Try by student_tasks.id first
        const directResult = await supabaseAdmin
            .from('student_tasks')
            .update({
                status: 'submitted',
                completed_at: completedAt,
                proof_note: sanitizedProofNote || null,
                ...(evidenceUrl ? { proof_url: evidenceUrl } : { proof_url: null })
            })
            .eq('student_id', id)
            .eq('id', taskId)
            .select()
            .maybeSingle();
        data = directResult.data;
        error = directResult.error;
        if (error) return res.status(500).json({ error: error.message });

        // 3) Fallback: treat taskId as tasks.id
        if (!data) {
            const { data: latestRows, error: latestError } = await supabaseAdmin
                .from('student_tasks')
                .select('id')
                .eq('student_id', id)
                .eq('task_id', taskId)
                .order('created_at', { ascending: false })
                .limit(1);

            if (latestError) return res.status(500).json({ error: latestError.message });
            const latest = Array.isArray(latestRows) && latestRows.length > 0 ? latestRows[0] : null;

            if (!latest?.id) {
                const { data: existingTaskRow } = await supabaseAdmin.from('tasks').select('id').eq('id', taskId).maybeSingle();
                if (!existingTaskRow) return res.status(404).json({ error: 'Task not found' });
                const { data: inserted, error: insertErr } = await supabaseAdmin
                    .from('student_tasks')
                    .insert([{
                        student_id: id,
                        task_id: taskId,
                        status: 'submitted',
                        completed_at: completedAt,
                        proof_note: sanitizedProofNote || null,
                        ...(evidenceUrl ? { proof_url: evidenceUrl } : {})
                    }])
                    .select()
                    .single();
                if (insertErr) return res.status(500).json({ error: insertErr.message });
                invalidateStudentCaches(id);
                invalidateStudentAiCaches(id);

                const { data: taskRow } = await supabaseAdmin
                    .from('tasks')
                    .select('id, title')
                    .eq('id', taskId)
                    .maybeSingle();

                await notifySubmissionCreated({
                    studentId: id,
                    kind: 'task',
                    title: taskRow?.title || '今日计划',
                    submissionId: inserted?.id || null,
                    taskId: taskId,
                    goalId: null
                });

                return res.json({ ...inserted, proof_url: evidenceUrl });
            }

            const fallbackResult = await supabaseAdmin
                .from('student_tasks')
                .update({
                    status: 'submitted',
                    completed_at: completedAt,
                    proof_note: sanitizedProofNote || null,
                    ...(evidenceUrl ? { proof_url: evidenceUrl } : { proof_url: null })
                })
                .eq('student_id', id)
                .eq('id', latest.id)
                .select()
                .maybeSingle();
            data = fallbackResult.data;
            error = fallbackResult.error;
        }

        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Task not found' });

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);

        const effectiveTaskId = data?.task_id || taskId;
        const { data: taskRow } = await supabaseAdmin
            .from('tasks')
            .select('id, title')
            .eq('id', effectiveTaskId)
            .maybeSingle();

        await notifySubmissionCreated({
            studentId: id,
            kind: 'task',
            title: taskRow?.title || '今日计划',
            submissionId: data?.id || null,
            taskId: effectiveTaskId,
            goalId: null
        });

        res.json({ ...data, proof_url: evidenceUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const completeTask = async (req, res) => {
    return res.status(400).json({
        error: '完成任务前请先提交材料，请使用 complete-with-evidence 接口'
    });
};

const submitGoalWithEvidence = async (req, res) => {
    const { id, goalId } = req.params;
    const { imageBase64, mimeType: rawMime, proofNote } = req.body || {};
    const sanitizedProofNote = String(proofNote || '').trim();

    if (!imageBase64 && !sanitizedProofNote) {
        return res.status(400).json({ error: '请至少提交一张图片或一句说明' });
    }

    if (sanitizedProofNote.length > 300) {
        return res.status(400).json({ error: 'Proof note must be at most 300 characters' });
    }

    const mimeType = rawMime && rawMime.startsWith('image/') ? rawMime : 'image/jpeg';

    try {
        const { data: goal, error: goalError } = await supabaseAdmin
            .from('student_goals')
            .select('id, title, student_id')
            .eq('id', goalId)
            .eq('student_id', id)
            .single();

        if (goalError || !goal) {
            return res.status(404).json({ error: 'Goal not found' });
        }

        let evidenceUrl = null;
        if (imageBase64) {
            try {
                const fileName = `goal-evidence/${id}/${goalId}_${Date.now()}.jpg`;
                evidenceUrl = await uploadBase64Image(imageBase64, fileName, mimeType);
            } catch (uploadErr) {
                console.error('Goal evidence upload failed:', uploadErr.message);
                return res.status(500).json({ error: '提交材料上传失败，请稍后重试' });
            }
        }

        const completedAt = new Date().toISOString();

        const { error: goalUpdateError } = await supabaseAdmin
            .from('student_goals')
            .update({ status: 'completed', completed_at: completedAt })
            .eq('id', goalId)
            .eq('student_id', id);

        if (goalUpdateError) {
            return res.status(500).json({ error: goalUpdateError.message });
        }

        const { data: existingRows, error: existingError } = await supabaseAdmin
            .from('student_tasks')
            .select('id')
            .eq('student_id', id)
            .eq('goal_id', goalId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (existingError && String(existingError.code || '') !== '42703') {
            return res.status(500).json({ error: existingError.message });
        }

        const existing = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;
        let submissionData = null;

        if (existing?.id) {
            const { data, error } = await supabaseAdmin
                .from('student_tasks')
                .update({
                    status: 'submitted',
                    completed_at: completedAt,
                    proof_note: sanitizedProofNote || null,
                    ...(evidenceUrl ? { proof_url: evidenceUrl } : { proof_url: null })
                })
                .eq('student_id', id)
                .eq('id', existing.id)
                .select('*')
                .single();
            if (error) return res.status(500).json({ error: error.message });
            submissionData = data;
        } else {
            const { data, error } = await supabaseAdmin
                .from('student_tasks')
                .insert([{
                    student_id: id,
                    task_id: null,
                    goal_id: goalId,
                    status: 'submitted',
                    completed_at: completedAt,
                    proof_note: sanitizedProofNote || null,
                    ...(evidenceUrl ? { proof_url: evidenceUrl } : {})
                }])
                .select('*')
                .single();
            if (error) return res.status(500).json({ error: error.message });
            submissionData = data;
        }

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);

        await notifySubmissionCreated({
            studentId: id,
            kind: 'goal',
            title: goal.title || '目标',
            submissionId: submissionData?.id || null,
            taskId: null,
            goalId
        });

        return res.json({
            message: '鐩爣瀹屾垚鏉愭枡宸叉彁浜わ紝绛夊緟鑰佸笀瀹℃牳',
            submission: submissionData
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const reopenTask = async (req, res) => {
    const { id, taskId } = req.params;

    try {
        let data = null;
        let error = null;

        // 1) Treat taskId as student_tasks.id first
        const directResult = await supabaseAdmin
            .from('student_tasks')
            .update({
                status: 'pending',
                completed_at: null
            })
            .eq('student_id', id)
            .eq('id', taskId)
            .select()
            .maybeSingle();
        data = directResult.data;
        error = directResult.error;
        if (error) return res.status(500).json({ error: error.message });

        // 2) If not found, treat taskId as tasks.id and update latest student_tasks row only
        if (!data) {
            const { data: latestRows, error: latestError } = await supabaseAdmin
                .from('student_tasks')
                .select('id')
                .eq('student_id', id)
                .eq('task_id', taskId)
                .order('created_at', { ascending: false })
                .limit(1);

            if (latestError) return res.status(500).json({ error: latestError.message });
            const latest = Array.isArray(latestRows) && latestRows.length > 0 ? latestRows[0] : null;
            if (!latest?.id) return res.status(404).json({ error: 'Task not found' });

            const fallbackResult = await supabaseAdmin
                .from('student_tasks')
                .update({
                    status: 'pending',
                    completed_at: null
                })
                .eq('student_id', id)
                .eq('id', latest.id)
                .select()
                .maybeSingle();
            data = fallbackResult.data;
            error = fallbackResult.error;
        }

        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Task not found' });

        invalidateStudentCaches(id);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Goals
// ============================================

const getGoals = async (req, res) => {
    const { id } = req.params;
    const limit = parsePositiveInt(req.query.limit, 50, 1, 200);
    const dreamTag = req.query.dream_tag || '';
    const cacheKey = `goals::${id}::${dreamTag}::${limit}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.goals);
    if (cached) return res.json(cached);

    try {
        let query = supabaseAdmin
            .from('student_goals')
            .select('*')
            .eq('student_id', id);
        if (dreamTag) query = query.eq('dream_tag', dreamTag);
        const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error && error.code !== '42P01') {
            return res.status(500).json({ error: error.message });
        }
        const result = data || [];
        setCachedApiValue(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createGoal = async (req, res) => {
    const { id } = req.params;
    const { title, description, target_date, dream_tag } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: '鐩爣鏍囬涓嶈兘涓虹┖' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('student_goals')
            .insert([{
                student_id: id,
                title: title.trim(),
                description: description?.trim() || null,
                target_date: target_date || null,
                dream_tag: dream_tag || null,
                status: 'in_progress'
            }])
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateGoal = async (req, res) => {
    const { id, goalId } = req.params;
    const updates = req.body;

    try {
        if (updates.title) updates.title = updates.title.trim();
        if (updates.description) updates.description = updates.description.trim();
        // remove updated_at if it's there as it doesn't exist on student_goals
        if (updates.updated_at) delete updates.updated_at;

        // 澶勭悊鐘舵€佸彉锟?
        if (updates.status === 'completed') {
            updates.completed_at = new Date().toISOString();
        } else if (updates.status === 'active' || updates.status === 'in_progress') {
            // 鍓嶇鍙兘鍙戯拷?'active'锛屾暟鎹簱浣跨敤 'in_progress'
            updates.status = 'in_progress';
            updates.completed_at = null;
        }

        const { data, error } = await supabaseAdmin
            .from('student_goals')
            .update(updates)
            .eq('id', goalId)
            .eq('student_id', id)
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Goal not found' });

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteGoal = async (req, res) => {
    const { id, goalId } = req.params;

    try {
        const { error } = await supabaseAdmin
            .from('student_goals')
            .delete()
            .eq('id', goalId)
            .eq('student_id', id);

        if (error) return res.status(500).json({ error: error.message });

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);
        res.json({ message: 'Goal deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Obstacles
// ============================================

const getObstacles = async (req, res) => {
    const { id } = req.params;
    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const dreamFocus = req.query.dream_focus || '';
    const cacheKey = `obstacles::${id}::${limit}::${dreamFocus}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.obstacles);
    if (cached) return res.json(cached);

    try {
        let query = supabaseAdmin
            .from('student_obstacles')
            .select('*')
            .eq('student_id', id);
        if (dreamFocus) query = query.eq('dream_tag', dreamFocus);
        const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error && error.code !== '42P01') {
            return res.status(500).json({ error: error.message });
        }

        setCachedApiValue(cacheKey, data || []);
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createObstacle = async (req, res) => {
    const { id } = req.params;
    const { content, obstacle_type, severity, dream_tag } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ error: '闃荤鍐呭涓嶈兘涓虹┖' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('student_obstacles')
            .insert([{
                student_id: id,
                content: content.trim(),
                obstacle_type: normalizeObstacleType(obstacle_type),
                severity: Math.min(5, Math.max(1, Number(severity) || 3)),
                dream_tag: dream_tag || null,
                status: 'todo'
            }])
            .select()
            .single();

        if (error && error.code !== '42P01') {
            return res.status(500).json({ error: error.message });
        }

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateObstacle = async (req, res) => {
    const { id, obstacleId } = req.params;
    const updates = req.body;

    try {
        if (updates.content) updates.content = updates.content.trim();
        if (updates.obstacle_type) updates.obstacle_type = normalizeObstacleType(updates.obstacle_type);
        if (updates.status) updates.status = normalizeObstacleStatus(updates.status) || updates.status;
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabaseAdmin
            .from('student_obstacles')
            .update(updates)
            .eq('id', obstacleId)
            .eq('student_id', id)
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Obstacle not found' });

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteObstacle = async (req, res) => {
    const { id, obstacleId } = req.params;

    try {
        const { error } = await supabaseAdmin
            .from('student_obstacles')
            .delete()
            .eq('id', obstacleId)
            .eq('student_id', id);

        if (error) return res.status(500).json({ error: error.message });

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);
        res.json({ message: 'Obstacle deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createObstacleTask = async (req, res) => {
    const { id, obstacleId } = req.params;

    try {
        const { data: obstacle, error: obstacleError } = await supabaseAdmin
            .from('student_obstacles')
            .select('*')
            .eq('id', obstacleId)
            .eq('student_id', id)
            .single();

        if (obstacleError || !obstacle) {
            return res.status(404).json({ error: 'Obstacle not found' });
        }

        const { data: task, error: taskError } = await supabaseAdmin
            .from('tasks')
            .insert([{
                type: 'personal',
                title: `鍏嬫湇闃荤: ${obstacle.content.substring(0, 30)}...`,
                description: obstacle.content,
                challenge_category: obstacle.obstacle_type,
                created_by: id
            }])
            .select()
            .single();

        if (taskError) {
            return res.status(500).json({ error: taskError.message });
        }

        // Insert into student_tasks so the task appears in today's plan and can be completed
        const { error: stError } = await supabaseAdmin
            .from('student_tasks')
            .insert([{ student_id: id, task_id: task.id, status: 'pending' }]);
        if (stError) return res.status(500).json({ error: stError.message });

        const { data: updatedObstacle, error: updateError } = await supabaseAdmin
            .from('student_obstacles')
            .update({
                linked_task_id: task.id,
                status: obstacle.status === 'resolved' ? 'resolved' : 'in_progress',
                updated_at: new Date().toISOString()
            })
            .eq('id', obstacleId)
            .eq('student_id', id)
            .select('*')
            .single();

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);
        res.status(201).json({ task, obstacle: updatedObstacle });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Badges & Sticker Board
// ============================================

const getBadges = async (req, res) => {
    const { id } = req.params;
    const cacheKey = `badges::${id}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.badges);
    if (cached) return res.json(cached);

    try {
        // 浣跨敤 badges(*) 鑾峰彇鎵€鏈夊瓧娈碉紝涓庡師 server.js 涓€锟?
        const { data, error } = await supabaseAdmin
            .from('student_badges')
            .select('*, badges(*)')
            .eq('student_id', id);

        if (error) {
            console.error('Error fetching badges:', error);
            if (error.code === '42P01') return res.json([]);
            return res.status(500).json({ error: error.message });
        }

        const result = data || [];
        setCachedApiValue(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getStickerBoard = async (req, res) => {
    const { id } = req.params;
    const cacheKey = `sticker_board::${id}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.stickerBoard);
    if (cached) return res.json(cached);

    try {
        const syncResult = await syncStudentStickerBadges(id);

        // 骞惰鏌ヨ锛堝師锟?娆￠『搴忊啋鐜板湪1娆″苟琛岋級
        const [{ data: allBadges, error: allBadgesError }, { data: studentBadges, error: studentBadgesError }] = await Promise.all([
            supabaseAdmin
                .from('badges')
                .select('*')
                .order('created_at', { ascending: true }),
            supabaseAdmin
                .from('student_badges')
                .select('badge_id, awarded_at')
                .eq('student_id', id)
        ]);

        if (allBadgesError) {
            if (allBadgesError.code === '42P01') return res.json([]);
            return res.status(500).json({ error: allBadgesError.message });
        }
        if (studentBadgesError) {
            if (studentBadgesError.code === '42P01') return res.json([]);
            return res.status(500).json({ error: studentBadgesError.message });
        }

        const unlockedMap = new Map((studentBadges || []).map(item => [item.badge_id, item.awarded_at]));

        const board = (allBadges || []).map((badge) => {
            const rule = getStickerRuleByBadgeName(badge.name);
            const progress = syncResult.progressMap?.[badge.name] || null;
            const current = progress?.current ?? null;
            const target = progress?.target ?? null;
            const remaining = Number.isFinite(Number(current)) && Number.isFinite(Number(target))
                ? Math.max(0, Number(target) - Number(current))
                : null;
            const unit = rule?.unit || 'times';
            const unlocked = unlockedMap.has(badge.id);

            const nextGoalText = rule
                ? (remaining === null
                    ? `鑾峰彇鐩爣锟?{rule.goalText}`
                    : (remaining <= 0
                        ? '鐩爣宸插畬鎴愶紝绛夊緟绯荤粺鍙戞斁鎴栧凡瑙ｉ攣'
                        : `鍐嶅畬锟?${remaining} ${unit}鍗冲彲鑾峰緱`))
                : null;

            return {
                ...badge,
                unlocked,
                awarded_at: unlockedMap.get(badge.id) || null,
                goal_text: rule?.goalText || null,
                progress_metric_key: rule?.metricKey || null,
                progress_current: current,
                progress_target: target,
                progress_percent: progress?.percent ?? null,
                progress_remaining: remaining,
                progress_unit: rule?.unit || null,
                next_goal_text: nextGoalText
            };
        });

        setCachedApiValue(cacheKey, board);
        res.json(board);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Growth Chart
// ============================================

const getGrowthChart = async (req, res) => {
    const { id } = req.params;
    const cacheKey = `growth_chart::${id}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.growthChart);
    if (cached) return res.json(cached);

    const weeksCount = 6;
    const daysCount = 14;
    const now = new Date();

    const weekBoundaries = [];
    for (let i = 0; i < weeksCount; i++) {
        const end = new Date(now);
        end.setDate(end.getDate() - i * 7);
        end.setHours(23, 59, 59, 999);
        const start = new Date(end);
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
        weekBoundaries.push({ start, end });
    }
    weekBoundaries.reverse();

    const dayBoundaries = [];
    for (let i = 0; i < daysCount; i++) {
        const end = new Date(now);
        end.setDate(end.getDate() - i);
        end.setHours(23, 59, 59, 999);
        const start = new Date(end);
        start.setHours(0, 0, 0, 0);
        dayBoundaries.push({ start, end });
    }
    dayBoundaries.reverse();

    const sixWeeksAgo = weekBoundaries[0].start.toISOString();

    try {
        let profileCreatedAt = 0;
        try {
            const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(id);
            if (user && user.created_at) {
                profileCreatedAt = new Date(user.created_at).getTime();
            }
        } catch (e) {
            console.warn('Failed to fetch user creation date');
        }

        const [tasksRes, moodsRes, momentsRes, badgesRes, goalsRes] = await Promise.all([
            supabaseAdmin.from('student_tasks').select('status, completed_at, created_at').eq('student_id', id).gte('created_at', sixWeeksAgo),
            supabaseAdmin.from('student_moods').select('mood, created_at').eq('student_id', id).neq('mood', 'radar_stats').gte('created_at', sixWeeksAgo),
            supabaseAdmin.from('class_moments').select('id, created_at').eq('student_id', id).gte('created_at', sixWeeksAgo),
            supabaseAdmin.from('student_badges').select('awarded_at').eq('student_id', id).gte('awarded_at', sixWeeksAgo),
            supabaseAdmin.from('student_goals').select('status, created_at, completed_at').eq('student_id', id).gte('created_at', sixWeeksAgo)
        ]);

        const tasks = tasksRes.data || [];
        const moods = moodsRes.data || [];
        const moments = momentsRes.data || [];
        const badges = badgesRes.data || [];
        const goals = goalsRes.data || [];

        const hasAnyActivity = tasks.length > 0 || moods.length > 0 || moments.length > 0 || badges.length > 0 || goals.length > 0;

        const inPeriod = (dateStr, period) => {
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return d >= period.start && d <= period.end;
        };

        const isBeforeRegistration = (period) => {
            if (!profileCreatedAt) return false;
            // If the END of this period is before the user even registered, return true
            return period.end.getTime() < profileCreatedAt;
        };

        const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

        const calcScores = (period) => {
            if (!hasAnyActivity || isBeforeRegistration(period)) {
                return { optimism: 0, grit: 0, creativity: 0, social: 0, achievement: 0 };
            }

            const base = 20;
            const maxBonus = 75;

            // 涔愯
            const periodMoods = moods.filter(m => inPeriod(m.created_at, period));
            const moodPositivityTotal = periodMoods.reduce((sum, item) => sum + getMoodPositivityScore(item.mood), 0);
            let optimismBonus = 0;
            if (periodMoods.length > 0) {
                optimismBonus = (moodPositivityTotal / periodMoods.length) * 20 + periodMoods.length * 3;
            }

            // 鍧氭瘏
            const periodTasks = tasks.filter(t => inPeriod(t.created_at, period));
            const completedTasks = periodTasks.filter(t => t.status === 'completed');
            let gritBonus = 0;
            if (periodTasks.length > 0) {
                gritBonus = (completedTasks.length / periodTasks.length) * 20 + completedTasks.length * 3;
            } else if (completedTasks.length > 0) {
                gritBonus = completedTasks.length * 5;
            }

            // 鍒涳拷?
            const periodGoals = goals.filter(g => inPeriod(g.created_at, period));
            const creativityBonus = periodGoals.length * 10 + completedTasks.length * 4;

            // 绀句氦
            const periodMoments = moments.filter(m => inPeriod(m.created_at, period));
            const socialBonus = periodMoments.length * 10;

            // 鎴愬氨
            const periodBadges = badges.filter(b => inPeriod(b.awarded_at, period));
            const periodGoalsCompleted = goals.filter(g => g.status === 'completed' && inPeriod(g.completed_at || g.created_at, period));
            const achievementBonus = periodBadges.length * 15 + periodGoalsCompleted.length * 10 + completedTasks.length * 3;

            const daySeed = period.start.getDate();
            const jitter = (dimIndex) => (daySeed * (dimIndex + 1)) % 7 - 3;

            return {
                optimism: clamp(base + Math.min(maxBonus, optimismBonus) + jitter(1)),
                grit: clamp(base + Math.min(maxBonus, gritBonus) + jitter(2)),
                creativity: clamp(base + Math.min(maxBonus, creativityBonus) + jitter(3)),
                social: clamp(base + Math.min(maxBonus, socialBonus) + jitter(4)),
                achievement: clamp(base + Math.min(maxBonus, achievementBonus) + jitter(5))
            };
        };

        const formatWeek = (week) => {
            const s = week.start;
            const e = week.end;
            return `${s.getMonth() + 1}/${s.getDate()}-${e.getMonth() + 1}/${e.getDate()}`;
        };

        const formatDay = (day) => `${day.start.getMonth() + 1}/${day.start.getDate()}`;

        // Filter out periods entirely before registration
        const validWeeklyBoundaries = weekBoundaries.filter(week => !isBeforeRegistration(week));
        // Ensure at least one week is shown if they just registered today
        const finalWeeklyBoundaries = validWeeklyBoundaries.length > 0 ? validWeeklyBoundaries : [weekBoundaries[weekBoundaries.length - 1]];

        const weekly = finalWeeklyBoundaries.map(week => ({
            label: formatWeek(week),
            ...calcScores(week)
        }));

        const validDailyBoundaries = dayBoundaries.filter(day => !isBeforeRegistration(day));
        const finalDailyBoundaries = validDailyBoundaries.length > 0 ? validDailyBoundaries : [dayBoundaries[dayBoundaries.length - 1]];

        const daily = finalDailyBoundaries.map(day => ({
            label: formatDay(day),
            ...calcScores(day)
        }));

        const latest = weekly[weekly.length - 1];
        const current = {
            optimism: hasAnyActivity ? Math.max(10, latest.optimism) : 0,
            grit: hasAnyActivity ? Math.max(10, latest.grit) : 0,
            creativity: hasAnyActivity ? Math.max(10, latest.creativity) : 0,
            social: hasAnyActivity ? Math.max(10, latest.social) : 0,
            achievement: hasAnyActivity ? Math.max(10, latest.achievement) : 0
        };

        const result = { current, weekly, daily };
        setCachedApiValue(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Growth chart error:', error);
        const fallbackWeekly = Array.from({ length: weeksCount }, (_, i) => ({
            label: `W${i + 1}`,
            optimism: 10, grit: 10, creativity: 10, social: 10, achievement: 10
        }));
        const fallbackDaily = Array.from({ length: daysCount }, (_, i) => ({
            label: `D${i + 1}`,
            optimism: 10, grit: 10, creativity: 10, social: 10, achievement: 10
        }));
        res.json({
            current: { optimism: 10, grit: 10, creativity: 10, social: 10, achievement: 10 },
            weekly: fallbackWeekly,
            daily: fallbackDaily
        });
    }
};

// ============================================
// Stats & Milestones
// ============================================

const getStats = async (req, res) => {
    const { id } = req.params;
    const cacheKey = `stats::${id}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.stats);
    if (cached) return res.json(cached);

    try {
        const [
            { count: completedTasks },
            { data: badges },
            checkin
        ] = await Promise.all([
            supabaseAdmin.from('student_tasks').select('*', { count: 'exact', head: true }).eq('student_id', id).eq('status', 'completed'),
            supabaseAdmin.from('student_badges').select('id').eq('student_id', id),
            getCheckinStatus(id)
        ]);

        const levelProgress = calculateLevelProgress({
            completedTasks: completedTasks || 0,
            badges: (badges || []).length,
            streak: checkin.streak
        });

        const result = {
            badges: (badges || []).length,
            completed_tasks: completedTasks || 0,
            streak: checkin.streak,
            checked_in_today: checkin.checkedInToday,
            level: levelProgress
        };

        setCachedApiValue(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getMilestones = async (req, res) => {
    const { id } = req.params;

    try {
        const { data, error } = await supabaseAdmin
            .from('student_goals')
            .select('*')
            .eq('student_id', id)
            .eq('status', 'completed')
            .order('completed_at', { ascending: false })
            .limit(5);

        if (error && error.code !== '42P01') {
            return res.status(500).json({ error: error.message });
        }
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Profile
// ============================================

/**
 * 杞婚噺锟?profile 鎺ュ彛锛氫粎杩斿洖鍩虹淇℃伅锛坣ame, avatar, dream, class_id锟?
 * 涓嶈皟锟?AI锛岄€傚悎棰戠箒璋冪敤鐨勫満鏅紙澶村儚鍔犺浇銆佸鑸爮绛夛級
 */
const getProfileLite = async (req, res) => {
    const { id } = req.params;
    const cacheKey = `profile_lite::${id}`;
    const cached = getCachedApiValue(cacheKey, 5 * 60 * 1000); // 5min
    if (cached) return res.json(cached);

    try {
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, avatar_url, dream, dreams, bio, class_id, school_name, class_name')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === '42703') {
                // 瀛楁涓嶅瓨鍦ㄦ椂鍥為€€
                const { data: fallback, error: fallbackErr } = await supabaseAdmin
                    .from('profiles')
                    .select('id, full_name, avatar_url, class_id')
                    .eq('id', id)
                    .single();
                if (fallbackErr) return res.status(500).json({ error: fallbackErr.message });
                if (!fallback) return res.status(404).json({ error: 'Profile not found' });
                setCachedApiValue(cacheKey, fallback);
                return res.json(fallback);
            }
            return res.status(500).json({ error: error.message });
        }
        if (!profile) return res.status(404).json({ error: 'Profile not found' });

        setCachedApiValue(cacheKey, profile);
        res.json(profile);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
const getSummary = async (req, res) => {
    const { id } = req.params;
    const cacheKey = `summary::${id}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.summary);
    if (cached) return res.json(cached);

    try {
        const [{ data: profile, error }, aiComment, dreamsResult] = await Promise.all([
            supabaseAdmin
                .from('profiles')
                .select('*')
                .eq('id', id)
                .single(),
            aiService.getAIComment(id).catch(() => ({ comment: '' })),
            supabaseAdmin
                .from('student_dreams')
                .select('title, priority, created_at')
                .eq('student_id', id)
                .order('priority', { ascending: true })
                .order('created_at', { ascending: false })
                .then((result) => result)
                .catch(() => ({ data: [] }))
        ]);

        if (error) return res.status(500).json({ error: error.message });
        if (!profile) return res.status(404).json({ error: 'Profile not found' });

        const profileDreams = normalizeDreamList(profile?.dream, profile?.dreams);
        const tableDreams = (dreamsResult?.data || [])
            .map((row) => String(row?.title || '').trim())
            .filter(Boolean);
        const dreams = profileDreams.length > 0 ? profileDreams : tableDreams;

        const result = {
            ...profile,
            dream: dreams[0] || profile?.dream || '',
            dreams,
            ai_comment: aiComment.comment
        };
        setCachedApiValue(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateProfile = async (req, res) => {
    const { id } = req.params;
    const updates = req.body || {};

    try {
        const filteredUpdates = {};
        if (updates.full_name !== undefined) filteredUpdates.full_name = String(updates.full_name || '').trim();
        if (updates.bio !== undefined) filteredUpdates.bio = String(updates.bio || '').trim();
        if (updates.avatar_url !== undefined) filteredUpdates.avatar_url = String(updates.avatar_url || '').trim();

        const normalizedDreams = normalizeDreamList(updates.dream, updates.dreams);
        if (updates.dream !== undefined || updates.dreams !== undefined) filteredUpdates.dream = normalizedDreams.join('\n');

        if (Object.keys(filteredUpdates).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        filteredUpdates.updated_at = new Date().toISOString();

        const { data, error } = await supabaseAdmin
            .from('profiles')
            .update(filteredUpdates)
            .eq('id', id)
            .select('id, full_name, dream, dreams, bio, avatar_url')
            .single();

        if (error) return res.status(500).json({ error: error.message });

        try {
            const dreamsOut = normalizeDreamList(data?.dream, data?.dreams);
            const { data: existingDreams } = await supabaseAdmin
                .from('student_dreams')
                .select('id, title')
                .eq('student_id', id);

            const existingTitles = (existingDreams || []).map((dream) => String(dream.title || '').trim());
            const newDreams = dreamsOut.filter((dream) => !existingTitles.includes(dream));
            const dreamsToDelete = (existingDreams || [])
                .filter((dream) => !dreamsOut.includes(String(dream.title || '').trim()))
                .map((dream) => dream.id);

            if (newDreams.length > 0) {
                await supabaseAdmin
                    .from('student_dreams')
                    .insert(newDreams.map((title, index) => ({
                        student_id: id,
                        title,
                        dream_status: 'active',
                        priority: index === 0 ? 1 : 2,
                        is_focused: index === 0 && !(existingDreams || []).length,
                        weekly_hours: 0,
                        progress: 0
                    })));
            }

            if (dreamsToDelete.length > 0) {
                await supabaseAdmin
                    .from('student_dreams')
                    .delete()
                    .in('id', dreamsToDelete);
            }
        } catch (syncError) {
            console.log('Dream sync warning:', syncError.message);
        }

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);
        res.json({
            message: 'Profile updated',
            data: {
                ...data,
                dream: normalizedDreams[0] || data?.dream || '',
                dreams: normalizedDreams
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get multi-dream overview for a student
 * Returns overall statistics, dream list with progress, and resource allocation
 */
const getDreamsOverview = async (req, res) => {
    const { id } = req.params;
    const cacheKey = `dreams_overview::${id}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.summary);
    if (cached) return res.json(cached);

    try {
        const [{ data: profile }, dreamsResult] = await Promise.all([
            supabaseAdmin
                .from('profiles')
                .select('dream, dreams')
                .eq('id', id)
                .single()
                .then((result) => result)
                .catch(() => ({ data: null })),
            supabaseAdmin
                .from('student_dreams')
                .select('id, title, dream_status, priority, is_focused, weekly_hours, progress, created_at, completed_at')
                .eq('student_id', id)
                .order('priority', { ascending: true })
                .order('created_at', { ascending: false })
                .then((result) => result)
                .catch((error) => ({ data: [], error }))
        ]);

        const profileDreams = normalizeDreamList(profile?.dream, profile?.dreams);
        const dbDreams = dreamsResult?.data || [];
        const canFallback = !dreamsResult?.error || String(dreamsResult.error?.message || '').includes('student_dreams');
        if (dreamsResult?.error && !canFallback) {
            return res.status(500).json({ error: dreamsResult.error.message });
        }

        const dbDreamTitles = dbDreams
            .map((dream) => String(dream?.title || '').trim())
            .filter(Boolean);
        const useProfileDreams = profileDreams.length > 0 && (dbDreams.length === 0 || profileDreams.join('|') !== dbDreamTitles.join('|'));
        const effectiveDreamRows = useProfileDreams
            ? profileDreams.map((title, index) => {
                const matched = dbDreams.find((dream) => String(dream?.title || '').trim() === title);
                return matched || {
                    id: `profile-dream-${index}`,
                    title,
                    dream_status: 'active',
                    priority: index === 0 ? 1 : 2,
                    is_focused: index === 0,
                    weekly_hours: 0,
                    progress: 0,
                    created_at: null,
                    completed_at: null
                };
            })
            : (dbDreams.length > 0
                ? dbDreams
                : profileDreams.map((title, index) => ({
                    id: `profile-dream-${index}`,
                    title,
                    dream_status: 'active',
                    priority: index === 0 ? 1 : 2,
                    is_focused: index === 0,
                    weekly_hours: 0,
                    progress: 0,
                    created_at: null,
                    completed_at: null
                })));

        const goalCounts = {};
        if (effectiveDreamRows.length > 0) {
            let goalsData = [];
            let goalsError = null;

            const primaryResult = await supabaseAdmin
                .from('student_goals')
                .select('dream_id, dream_tag, status')
                .eq('student_id', id);
            goalsData = primaryResult.data || [];
            goalsError = primaryResult.error;

            if (goalsError && String(goalsError.code || '') === '42703') {
                const fallbackResult = await supabaseAdmin
                    .from('student_goals')
                    .select('dream_id, dream_tag, goal_status')
                    .eq('student_id', id);
                goalsData = fallbackResult.data || [];
                goalsError = fallbackResult.error;
            }

            if (!goalsError) {
                effectiveDreamRows.forEach((dream) => {
                    const dreamId = String(dream?.id || '').trim();
                    const dreamTitle = String(dream?.title || '').trim();
                    const dreamGoals = (goalsData || []).filter((goal) => {
                        const goalDreamId = String(goal?.dream_id || '').trim();
                        const goalDreamTag = String(goal?.dream_tag || '').trim();
                        return (dreamId && goalDreamId && goalDreamId === dreamId)
                            || (dreamTitle && goalDreamTag === dreamTitle);
                    });

                    goalCounts[dreamId] = {
                        total: dreamGoals.length,
                        completed: dreamGoals.filter((goal) => String(goal?.status || goal?.goal_status || '').toLowerCase() === 'completed').length
                    };
                });
            }
        }

        const dreams = effectiveDreamRows.map((dream) => {
            const counts = goalCounts[dream.id] || { total: 0, completed: 0 };
            return {
                id: dream.id,
                tag: dream.title,
                title: dream.title,
                status: dream.dream_status || 'active',
                progress: dream.progress || 0,
                priority: dream.priority || 2,
                is_focused: Boolean(dream.is_focused),
                weekly_hours: dream.weekly_hours || 0,
                completed_tasks: counts.completed,
                total_tasks: counts.total,
                goal_count: counts.total,
                completed_goal_count: counts.completed,
                created_at: dream.created_at,
                completed_at: dream.completed_at
            };
        });

        const activeDreams = dreams.filter((dream) => dream.status === 'active');
        const completedDreams = dreams.filter((dream) => dream.status === 'completed');
        const pausedDreams = dreams.filter((dream) => dream.status === 'paused');
        const totalWeeklyHours = activeDreams.reduce((sum, dream) => sum + (dream.weekly_hours || 0), 0);

        const result = {
            total_dreams: dreams.length,
            active_count: activeDreams.length,
            completed_count: completedDreams.length,
            paused_count: pausedDreams.length,
            dreams,
            current_focus_dream: dreams.find((dream) => dream.is_focused) || dreams[0] || null,
            resource_allocation: {
                total_weekly_hours: totalWeeklyHours,
                by_dream: activeDreams.reduce((acc, dream) => {
                    acc[dream.tag] = dream.weekly_hours || 0;
                    return acc;
                }, {})
            },
            limits: {
                max_active_dreams: 3,
                can_add_new: activeDreams.length < 3
            }
        };

        setCachedApiValue(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Get dreams overview error:', error);
        res.status(500).json({ error: error.message });
    }
};
const setFocusedDream = async (req, res) => {
    const { id } = req.params;
    const { dream_id } = req.body;

    if (!dream_id) {
        return res.status(400).json({ error: 'dream_id is required' });
    }

    try {
        const { data: dream, error: dreamError } = await supabaseAdmin
            .from('student_dreams')
            .select('id, dream_status')
            .eq('id', dream_id)
            .eq('student_id', id)
            .single();

        if (dreamError || !dream) return res.status(404).json({ error: 'Dream not found' });
        if (dream.dream_status !== 'active') return res.status(400).json({ error: 'Can only focus on active dreams' });

        await supabaseAdmin
            .from('student_dreams')
            .update({ is_focused: false })
            .eq('student_id', id);

        const { data, error } = await supabaseAdmin
            .from('student_dreams')
            .update({ is_focused: true, updated_at: new Date().toISOString() })
            .eq('id', dream_id)
            .eq('student_id', id)
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });

        invalidateStudentCaches(id);
        res.json({ message: 'Focus dream updated', dream: data });
    } catch (error) {
        console.error('Set focused dream error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Update dream status (active/paused/completed)
 */
const updateDreamStatus = async (req, res) => {
    const { id, goalId } = req.params;
    const { dream_status } = req.body;

    if (!dream_status || !['active', 'paused', 'completed'].includes(dream_status)) {
        return res.status(400).json({ error: 'Invalid dream_status. Must be active, paused, or completed' });
    }

    try {
        const updates = {
            dream_status,
            updated_at: new Date().toISOString()
        };

        if (dream_status === 'completed') {
            updates.completed_at = new Date().toISOString();
            updates.progress = 100;
        }

        const { data, error } = await supabaseAdmin
            .from('student_goals')
            .update(updates)
            .eq('id', goalId)
            .eq('student_id', id)
            .select()
            .single();

        if (error) {
            if (error.message && error.message.includes('At most 3 active dreams are allowed')) {
                return res.status(400).json({ error: '鏈€澶氬彧鑳藉悓鏃舵縺锟?涓ⅵ鎯筹紝璇峰厛鏆傚仠鍏朵粬姊︽兂' });
            }
            return res.status(500).json({ error: error.message });
        }

        invalidateStudentCaches(id);
        res.json({ message: 'Dream status updated', dream: data });
    } catch (error) {
        console.error('Update dream status error:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Update dream priority and weekly hours (resource allocation)
 */
const updateDreamAllocation = async (req, res) => {
    const { id, goalId } = req.params;
    const { priority, weekly_hours } = req.body;

    try {
        const updates = {
            updated_at: new Date().toISOString()
        };

        if (priority !== undefined) {
            const priorityNum = parseInt(priority, 10);
            if (isNaN(priorityNum) || priorityNum < 1 || priorityNum > 2) {
                return res.status(400).json({ error: 'Priority must be 1 (high) or 2 (normal)' });
            }
            updates.priority = priorityNum;
        }

        if (weekly_hours !== undefined) {
            const hours = parseInt(weekly_hours, 10);
            if (isNaN(hours) || hours < 0 || hours > 40) {
                return res.status(400).json({ error: 'Weekly hours must be between 0 and 40' });
            }
            updates.weekly_hours = hours;
        }

        const { data, error } = await supabaseAdmin
            .from('student_goals')
            .update(updates)
            .eq('id', goalId)
            .eq('student_id', id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateStudentCaches(id);
        res.json({ message: 'Dream allocation updated', dream: data });
    } catch (error) {
        console.error('Update dream allocation error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// AI Task Suggestions (Today mini-tasks)
// ============================================

const FALLBACK_AI_TASKS = [
    { title: 'Draw your dream', description: 'Use colorful pens to draw the dream you want to achieve most.' },
    { title: 'Tell a family story', description: 'Share a favorite story with your family in your own words.' },
    { title: 'Organize your school bag', description: 'Tidy your school bag or toys and see what treasures you can find.' },
    { title: 'Do 10 jumps', description: 'Jump in place 10 times and wake up your body.' },
    { title: 'Recognize 5 new characters', description: 'Open a book, find 5 unfamiliar characters, and ask a parent to teach you how to read them.' },
    { title: 'Help at home', description: 'Help your family with one small chore such as setting the table or watering plants.' },
    { title: 'Practice writing your name', description: 'Write your name neatly 10 times on paper and try to make it a little better each time.' },
    { title: 'Sing a favorite song', description: 'Sing a song you like and perform it for your family.' },
];

const getAiTaskSuggestions = async (req, res) => {
    const { id } = req.params;
    const cacheKey = `ai_task_suggestions::${id}::${new Date().toISOString().slice(0, 10)}`;
    const cached = getCachedApiValue(cacheKey, 3 * 60 * 60 * 1000); // 3h cache per day
    if (cached) return res.json(cached);

    try {
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('full_name, dream')
            .eq('id', id)
            .single();

        const safeName = profile?.full_name || '鍚屽';
        const { dreamLine } = buildDreamContext(profile);
        const dream = dreamLine || 'Become a better version of yourself';

        // Build prompt
        const prompt = `瀛︾敓濮撳悕锟?{safeName}\n姊︽兂锟?{dream}\n骞撮緞娈碉細瀛﹀墠鑷冲皬瀛︿綆骞寸骇锟?锟?宀侊級`;

        const content = await aiService.callEcnuApiPublic([
            {
                role: 'system',
                content: 'You are a child growth assistant. Generate 3 simple daily micro-tasks for a child aged 3 to 8 that connect to the student dream. Return JSON only with title and description fields and no explanation.'
            },
            { role: 'user', content: `璇锋牴鎹互涓嬩俊鎭帹锟?涓粖鏃ュ井浠诲姟锛歕n${prompt}` }
        ], { maxTokens: 250, temperature: 0.85 });

        let tasks = [];
        if (content) {
            try {
                const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleaned);
                const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.tasks) ? parsed.tasks : []);
                tasks = arr.map(t => ({
                    title: String(t.title || '').trim(),
                    description: String(t.description || '').trim()
                })).filter(t => t.title).slice(0, 3);
            } catch (_) { tasks = []; }
        }

        // Fallback: pick 3 pseudo-random from static list seeded by date+id
        if (tasks.length === 0) {
            const seed = parseInt(id.replace(/-/g, '').slice(0, 8), 16) || 0;
            const dayOffset = Math.floor(Date.now() / 86400000);
            const start = (seed + dayOffset) % FALLBACK_AI_TASKS.length;
            tasks = [0, 1, 2].map(i => FALLBACK_AI_TASKS[(start + i) % FALLBACK_AI_TASKS.length]);
        }

        const result = { dream, tasks };
        setCachedApiValue(cacheKey, result);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const uploadAvatar = async (req, res) => {
    const { id } = req.params;
    const { fileName, mimeType, dataBase64 } = req.body || {};

    if (!fileName || !mimeType || !dataBase64) {
        return res.status(400).json({ error: 'Missing fileName, mimeType or dataBase64' });
    }

    if (!String(mimeType).startsWith('image/')) {
        return res.status(400).json({ error: 'Only image files are supported' });
    }

    try {
        const cleanName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const extension = pathModule.extname(cleanName) || '.png';
        const finalName = `avatars/avatar_${id}_${Date.now()}${extension}`;
        const avatarUrl = await uploadBase64Image(dataBase64, finalName, mimeType);

        const { data, error } = await supabaseAdmin
            .from('profiles')
            .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select('id, avatar_url')
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateStudentCaches(id);
        invalidateStudentAiCaches(id);

        return res.json({
            message: 'Avatar uploaded',
            data,
            avatar_url: avatarUrl
        });
    } catch (error) {
        console.error('Upload avatar error:', error);
        return res.status(500).json({ error: error.message });
    }
};

module.exports = {
    // Tasks
    getTasks,
    submitMood,
    // Check-in
    getCheckinStatus: getCheckinStatusHandler,
    submitCheckin,
    // Growth
    getGrowthStats,
    getGrowthChart,
    // Student Tasks
    getStudentTasks,
    createTodayPlan,
    deleteTodayPlan,
    completeTask,
    completeTaskWithEvidence,
    submitGoalWithEvidence,
    reopenTask,
    // Goals
    getGoals,
    createGoal,
    updateGoal,
    deleteGoal,
    // Multi-Dream Management
    getDreamsOverview,
    setFocusedDream,
    updateDreamStatus,
    updateDreamAllocation,
    // Obstacles
    getObstacles,
    createObstacle,
    updateObstacle,
    deleteObstacle,
    createObstacleTask,
    // Badges
    getBadges,
    getStickerBoard,
    // Stats
    getStats,
    getMilestones,
    // Profile
    getSummary,
    getProfileLite,
    updateProfile,
    uploadAvatar,
    // AI Task Suggestions
    getAiTaskSuggestions
};
