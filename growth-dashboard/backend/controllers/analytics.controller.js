/**
 * Analytics Controller
 * 数据统计分析控制器
 */

const { supabaseAdmin } = require('../middlewares/auth');
const { getCachedApiValue, setCachedApiValue, API_CACHE_TTL_MS } = require('../services/cacheService');

const verifyTeacherClassAccessCached = async (teacherId, classId) => {
    const cacheKey = `teacher_class_access::${teacherId}::${classId}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.teacherClass);
    if (cached) {
        return { ok: true };
    }

    const { data: classData, error: classError } = await supabaseAdmin
        .from('classes')
        .select('id')
        .eq('id', classId)
        .eq('teacher_id', teacherId)
        .single();

    if (classError || !classData) {
        return { ok: false };
    }

    setCachedApiValue(cacheKey, true);
    return { ok: true };
};

const isSchemaError = (error) => {
    const msg = String(error?.message || '').toLowerCase();
    return msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache');
};

const fetchBadgesByRange = async (studentId, startIso, endIso) => {
    let query = supabaseAdmin
        .from('student_badges')
        .select('*')
        .eq('student_id', studentId)
        .gte('awarded_at', startIso);

    if (endIso) {
        query = query.lt('awarded_at', endIso);
    }

    const awardedRes = await query;
    if (!awardedRes.error) {
        return awardedRes;
    }

    let fallbackQuery = supabaseAdmin
        .from('student_badges')
        .select('*')
        .eq('student_id', studentId)
        .gte('earned_at', startIso);

    if (endIso) {
        fallbackQuery = fallbackQuery.lt('earned_at', endIso);
    }

    const earnedRes = await fallbackQuery;
    if (!earnedRes.error) {
        return earnedRes;
    }

    if (isSchemaError(awardedRes.error) || isSchemaError(earnedRes.error)) {
        return { data: [], error: null };
    }

    return earnedRes;
};

const fetchClassBadgesSince = async (studentIds, sinceIso) => {
    const awardedRes = await supabaseAdmin
        .from('student_badges')
        .select('student_id, awarded_at')
        .in('student_id', studentIds)
        .gte('awarded_at', sinceIso);

    if (!awardedRes.error) {
        return { data: awardedRes.data || [], error: null };
    }

    const earnedRes = await supabaseAdmin
        .from('student_badges')
        .select('student_id, earned_at')
        .in('student_id', studentIds)
        .gte('earned_at', sinceIso);

    if (!earnedRes.error) {
        return { data: earnedRes.data || [], error: null };
    }

    if (isSchemaError(awardedRes.error) || isSchemaError(earnedRes.error)) {
        return { data: [], error: null };
    }

    return { data: [], error: earnedRes.error };
};

const fetchCheckinsByRange = async (studentId, startIso, endIso) => {
    let moodQuery = supabaseAdmin
        .from('student_moods')
        .select('student_id, mood, created_at')
        .eq('student_id', studentId)
        .eq('mood', 'checkin')
        .gte('created_at', startIso);

    if (endIso) {
        moodQuery = moodQuery.lt('created_at', endIso);
    }

    const moodRes = await moodQuery;
    if (!moodRes.error) return { data: moodRes.data || [], error: null };

    let query = supabaseAdmin
        .from('checkins')
        .select('*')
        .eq('student_id', studentId)
        .gte('created_at', startIso);

    if (endIso) {
        query = query.lt('created_at', endIso);
    }

    const res = await query;
    if (!res.error) return { data: res.data || [], error: null };
    if (isSchemaError(moodRes.error) || isSchemaError(res.error)) {
        return { data: [], error: null };
    }
    return { data: [], error: res.error };
};

const fetchClassCheckinsSince = async (studentIds, sinceIso) => {
    const moodRes = await supabaseAdmin
        .from('student_moods')
        .select('student_id, mood, created_at')
        .in('student_id', studentIds)
        .eq('mood', 'checkin')
        .gte('created_at', sinceIso);

    if (!moodRes.error) {
        return { data: moodRes.data || [], error: null };
    }

    const res = await supabaseAdmin
        .from('checkins')
        .select('student_id, created_at')
        .in('student_id', studentIds)
        .gte('created_at', sinceIso);

    if (!res.error) {
        return { data: res.data || [], error: null };
    }
    if (isSchemaError(moodRes.error) || isSchemaError(res.error)) {
        return { data: [], error: null };
    }
    return { data: [], error: res.error };
};

const getClassStudentsForDistributionCached = async (classId) => {
    const cacheKey = `class_students::${classId}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.teacherStudents);
    if (cached) {
        return { students: cached };
    }

    const { data: students, error } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name')
        .eq('class_id', classId)
        .eq('role', 'student');

    if (error) {
        return { error: error.message };
    }

    const safeStudents = students || [];
    setCachedApiValue(cacheKey, safeStudents);
    return { students: safeStudents };
};

const classifyStudentMindset = (stats) => {
    const goalCompletionRate = stats.goals_total > 0
        ? (stats.goals_completed / stats.goals_total)
        : 0;
    const taskCompletionScore = Math.min(1, stats.tasks_completed / 8);
    const checkinScore = Math.min(1, stats.checkins / 20);
    const badgeScore = Math.min(1, stats.badges / 6);

    const score =
        goalCompletionRate * 0.45 +
        taskCompletionScore * 0.30 +
        checkinScore * 0.15 +
        badgeScore * 0.10;

    let mindset = 'fixed';
    if (score >= 0.67) {
        mindset = 'growth';
    } else if (score >= 0.40) {
        mindset = 'mixed';
    }

    return {
        score: Number(score.toFixed(4)),
        mindset,
        factors: {
            goal_completion_rate: Number(goalCompletionRate.toFixed(4)),
            task_completion_score: Number(taskCompletionScore.toFixed(4)),
            checkin_score: Number(checkinScore.toFixed(4)),
            badge_score: Number(badgeScore.toFixed(4))
        }
    };
};

const computeClassDistributionPayload = async (classId) => {
    const studentsResult = await getClassStudentsForDistributionCached(classId);
    if (studentsResult.error) {
        return { error: studentsResult.error };
    }

    const students = studentsResult.students || [];

    if (!students || students.length === 0) {
        return {
            students: [],
            distribution: {
                total_students: 0,
                avg_goals: 0,
                avg_completed_goals: 0,
                avg_tasks: 0,
                avg_badges: 0,
                top_performers: [],
                classification: {
                    growth: 0,
                    mixed: 0,
                    fixed: 0
                },
                classification_algorithm: {
                    name: 'Weighted Engagement Score',
                    version: 'v1',
                    window_days: 90,
                    thresholds: {
                        growth: 'score >= 0.67',
                        mixed: '0.40 <= score < 0.67',
                        fixed: 'score < 0.40'
                    },
                    weights: {
                        goal_completion_rate: 0.45,
                        task_completion_score: 0.30,
                        checkin_score: 0.15,
                        badge_score: 0.10
                    }
                }
            }
        };
    }

    const studentIds = students.map((s) => s.id);
    const recentFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [goalsRes, tasksRes, badgesRes, checkinsRes] = await Promise.all([
        supabaseAdmin
            .from('student_goals')
            .select('student_id, status, created_at')
            .in('student_id', studentIds)
            .gte('created_at', recentFrom),
        supabaseAdmin
            .from('student_tasks')
            .select('student_id, status, created_at')
            .in('student_id', studentIds)
            .gte('created_at', recentFrom),
        fetchClassBadgesSince(studentIds, recentFrom),
        fetchClassCheckinsSince(studentIds, recentFrom)
    ]);

    if (goalsRes.error) return { error: goalsRes.error.message };
    if (tasksRes.error) return { error: tasksRes.error.message };
    if (badgesRes.error) return { error: badgesRes.error.message };
    if (checkinsRes.error) return { error: checkinsRes.error.message };

    const statsMap = new Map(studentIds.map((studentId) => [studentId, {
        id: studentId,
        goals_total: 0,
        goals_completed: 0,
        tasks_completed: 0,
        badges: 0,
        checkins: 0,
        classification: 'fixed',
        score: 0
    }]));

    for (const goal of goalsRes.data || []) {
        const stat = statsMap.get(goal.student_id);
        if (!stat) continue;
        stat.goals_total += 1;
        if (goal.status === 'completed') {
            stat.goals_completed += 1;
        }
    }

    for (const task of tasksRes.data || []) {
        const stat = statsMap.get(task.student_id);
        if (!stat) continue;
        const completedByStatus = ['completed', 'verified'].includes(String(task.status || '').toLowerCase());
        if (completedByStatus) {
            stat.tasks_completed += 1;
        }
    }

    for (const badge of badgesRes.data || []) {
        const stat = statsMap.get(badge.student_id);
        if (stat) stat.badges += 1;
    }

    const checkinDateSetMap = new Map(studentIds.map((studentId) => [studentId, new Set()]));
    for (const checkin of checkinsRes.data || []) {
        const studentId = checkin.student_id;
        const daySet = checkinDateSetMap.get(studentId);
        if (!daySet) continue;

        const ts = new Date(checkin.created_at || '').getTime();
        if (!Number.isFinite(ts)) continue;
        daySet.add(new Date(ts).toISOString().slice(0, 10));
    }

    for (const [studentId, daySet] of checkinDateSetMap.entries()) {
        const stat = statsMap.get(studentId);
        if (!stat) continue;
        stat.checkins = daySet.size;
    }

    const studentStats = Array.from(statsMap.values());
    const classificationCount = {
        growth: 0,
        mixed: 0,
        fixed: 0
    };

    studentStats.forEach((stats) => {
        const result = classifyStudentMindset(stats);
        stats.classification = result.mindset;
        stats.score = result.score;
        stats.classification_factors = result.factors;
        classificationCount[result.mindset] = (classificationCount[result.mindset] || 0) + 1;
    });

    const result = students.map((student) => {
        const stats = statsMap.get(student.id) || {
            id: student.id,
            goals_total: 0,
            goals_completed: 0,
            tasks_completed: 0,
            badges: 0,
            checkins: 0,
            classification: 'fixed',
            score: 0,
            classification_factors: {
                goal_completion_rate: 0,
                task_completion_score: 0,
                checkin_score: 0,
                badge_score: 0
            }
        };

        return {
            id: student.id,
            name: student.full_name,
            ...stats
        };
    });

    const distribution = {
        total_students: students.length,
        avg_goals: Math.round(studentStats.reduce((sum, s) => sum + s.goals_total, 0) / students.length),
        avg_completed_goals: Math.round(studentStats.reduce((sum, s) => sum + s.goals_completed, 0) / students.length),
        avg_tasks: Math.round(studentStats.reduce((sum, s) => sum + s.tasks_completed, 0) / students.length),
        avg_badges: Math.round(studentStats.reduce((sum, s) => sum + s.badges, 0) / students.length),
        top_performers: result.slice().sort((a, b) => b.score - a.score).slice(0, 5),
        classification: classificationCount,
        classification_algorithm: {
            name: 'Weighted Engagement Score',
            version: 'v1',
            window_days: 90,
            thresholds: {
                growth: 'score >= 0.67',
                mixed: '0.40 <= score < 0.67',
                fixed: 'score < 0.40'
            },
            weights: {
                goal_completion_rate: 0.45,
                task_completion_score: 0.30,
                checkin_score: 0.15,
                badge_score: 0.10
            }
        }
    };

    return {
        students: result,
        distribution
    };
};

const buildAiInsightsFromDistribution = (distribution = {}, students = []) => {
    const totalStudents = Number(distribution.total_students || 0);
    const classification = distribution.classification || {};
    const growthCount = Number(classification.growth || 0);
    const mixedCount = Number(classification.mixed || 0);
    const fixedCount = Number(classification.fixed || 0);

    const growthRate = totalStudents > 0 ? growthCount / totalStudents : 0;
    const mixedRate = totalStudents > 0 ? mixedCount / totalStudents : 0;
    const fixedRate = totalStudents > 0 ? fixedCount / totalStudents : 0;

    const insights = [];

    if (fixedRate >= 0.25 || fixedCount >= 3) {
        insights.push({
            id: 'risk-support',
            priority: 'high',
            title: '固定型学生占比较高，建议启动分层干预',
            summary: `当前固定型 ${fixedCount} 人（${Math.round(fixedRate * 100)}%），建议优先安排 1v1 面谈与短周期可达成目标。`,
            action: '本周内为固定型学生建立“7天小目标 + 每日反馈”计划，并在周五复盘完成率。'
        });
    }

    if (mixedRate >= 0.40) {
        insights.push({
            id: 'mixed-convert',
            priority: 'medium',
            title: '混合型学生基数大，可作为成长型转化重点',
            summary: `混合型 ${mixedCount} 人（${Math.round(mixedRate * 100)}%），具备较强可塑性。`,
            action: '按小组推行“目标拆解模板 + 同伴互评”，将混合型学生优先纳入两周冲刺。'
        });
    }

    if (Number(distribution.avg_tasks || 0) < 3) {
        insights.push({
            id: 'task-engagement',
            priority: 'medium',
            title: '任务完成活跃度偏低，需要提升执行节奏',
            summary: `近 90 天班级人均完成任务 ${Number(distribution.avg_tasks || 0)} 个，建议提高任务节律。`,
            action: '将任务拆分为“每日15分钟微任务”，并在班级内公布周完成榜。'
        });
    }

    const topPerformer = Array.isArray(students)
        ? students.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0]
        : null;

    if (topPerformer && growthCount > 0) {
        insights.push({
            id: 'peer-mentor',
            priority: 'low',
            title: '可利用榜样效应带动班级成长氛围',
            summary: `${topPerformer.name || '优秀学生'} 表现突出，适合作为学习方法分享的示范者。`,
            action: '安排 10 分钟“方法分享”环节，聚焦目标拆解和复盘习惯。'
        });
    }

    if (insights.length === 0) {
        insights.push({
            id: 'steady-state',
            priority: 'low',
            title: '班级状态稳定，建议持续跟踪关键指标',
            summary: '当前分布较为均衡，可继续观察分类变化趋势。',
            action: '保持周节奏追踪，并在出现连续两周波动时启动专题干预。'
        });
    }

    return insights.slice(0, 4);
};

const CN_STOPWORDS = new Set([
    '我们', '你们', '他们', '这个', '那个', '今天', '昨天', '现在', '然后', '因为', '所以', '已经', '真的', '就是', '自己',
    '一个', '一些', '一下', '可以', '还有', '没有', '不是', '不要', '觉得', '非常', '特别', '什么', '怎么', '如果', '但是',
    '老师', '同学', '孩子', '学生', '完成', '进行', '发布', '分享', '成长', '目标', '任务', '挑战'
]);

const EN_STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'has', 'was', 'were', 'are', 'is', 'you', 'your', 'our', 'they',
    'them', 'their', 'but', 'not', 'today', 'yesterday', 'very', 'really', 'just', 'can', 'will', 'had', 'did', 'done'
]);

const extractWordCloudTokens = (texts = []) => {
    const counter = new Map();

    const addWord = (word) => {
        const safeWord = String(word || '').trim().toLowerCase();
        if (!safeWord) return;
        if (safeWord.length < 2) return;
        const isEnglish = /^[a-z]+$/.test(safeWord);
        if (isEnglish && EN_STOPWORDS.has(safeWord)) return;
        if (!isEnglish && CN_STOPWORDS.has(safeWord)) return;
        counter.set(safeWord, (counter.get(safeWord) || 0) + 1);
    };

    for (const rawText of texts) {
        const text = String(rawText || '').trim();
        if (!text) continue;

        const cnBlocks = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
        for (const block of cnBlocks) {
            if (block.length <= 4) {
                addWord(block);
            } else {
                for (let i = 0; i < block.length - 1; i++) {
                    addWord(block.slice(i, i + 2));
                }
            }
        }

        const enWords = text.match(/[A-Za-z]{3,20}/g) || [];
        for (const word of enWords) {
            addWord(word);
        }
    }

    const words = Array.from(counter.entries())
        .map(([text, value]) => ({ text, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 40);

    const maxValue = words.length > 0 ? words[0].value : 1;
    return words.map((item) => {
        const ratio = maxValue > 0 ? item.value / maxValue : 0;
        let weight = 1;
        if (ratio >= 0.8) weight = 5;
        else if (ratio >= 0.6) weight = 4;
        else if (ratio >= 0.4) weight = 3;
        else if (ratio >= 0.2) weight = 2;

        return {
            ...item,
            weight
        };
    });
};

// ============================================
// 获取学生周对比数据
// ============================================

const getWeeklyComparison = async (req, res) => {
    const { id } = req.params;

    try {
        // 获取过去7天的数据
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

        // 本周数据
        const { data: thisWeekGoals } = await supabaseAdmin
            .from('student_goals')
            .select('*')
            .eq('student_id', id)
            .gte('created_at', weekAgo.toISOString());

        const { data: thisWeekTasks } = await supabaseAdmin
            .from('student_tasks')
            .select('*')
            .eq('student_id', id)
            .gte('created_at', weekAgo.toISOString());

        const { data: thisWeekCheckins } = await fetchCheckinsByRange(id, weekAgo.toISOString(), null);

        // 上周数据
        const { data: lastWeekGoals } = await supabaseAdmin
            .from('student_goals')
            .select('*')
            .eq('student_id', id)
            .gte('created_at', twoWeeksAgo.toISOString())
            .lt('created_at', weekAgo.toISOString());

        const { data: lastWeekTasks } = await supabaseAdmin
            .from('student_tasks')
            .select('*')
            .eq('student_id', id)
            .gte('created_at', twoWeeksAgo.toISOString())
            .lt('created_at', weekAgo.toISOString());

        const { data: lastWeekCheckins } = await fetchCheckinsByRange(id, twoWeeksAgo.toISOString(), weekAgo.toISOString());

        // 计算统计数据
        const isTaskDone = (task) => ['completed', 'verified'].includes(String(task?.status || '').toLowerCase());

        const thisWeekStats = {
            goals_created: thisWeekGoals?.length || 0,
            goals_completed: thisWeekGoals?.filter(g => g.status === 'completed').length || 0,
            tasks_completed: thisWeekTasks?.filter(isTaskDone).length || 0,
            checkins: thisWeekCheckins?.length || 0
        };

        const lastWeekStats = {
            goals_created: lastWeekGoals?.length || 0,
            goals_completed: lastWeekGoals?.filter(g => g.status === 'completed').length || 0,
            tasks_completed: lastWeekTasks?.filter(isTaskDone).length || 0,
            checkins: lastWeekCheckins?.length || 0
        };

        // 计算变化百分比
        const calculateChange = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 100);
        };

        res.json({
            this_week: thisWeekStats,
            last_week: lastWeekStats,
            changes: {
                goals_created: calculateChange(thisWeekStats.goals_created, lastWeekStats.goals_created),
                goals_completed: calculateChange(thisWeekStats.goals_completed, lastWeekStats.goals_completed),
                tasks_completed: calculateChange(thisWeekStats.tasks_completed, lastWeekStats.tasks_completed),
                checkins: calculateChange(thisWeekStats.checkins, lastWeekStats.checkins)
            }
        });

    } catch (error) {
        console.error('Get weekly comparison error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 获取学生月对比数据
// ============================================

const getMonthlyComparison = async (req, res) => {
    const { id } = req.params;

    try {
        const now = new Date();
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

        // 本月数据
        const { data: thisMonthGoals } = await supabaseAdmin
            .from('student_goals')
            .select('*')
            .eq('student_id', id)
            .gte('created_at', monthAgo.toISOString());

        const { data: thisMonthTasks } = await supabaseAdmin
            .from('student_tasks')
            .select('*')
            .eq('student_id', id)
            .gte('created_at', monthAgo.toISOString());

        const { data: thisMonthBadges, error: thisMonthBadgesError } = await fetchBadgesByRange(id, monthAgo.toISOString(), null);
        if (thisMonthBadgesError) {
            return res.status(500).json({ error: thisMonthBadgesError.message || 'Failed to fetch badges' });
        }

        // 上月数据
        const { data: lastMonthGoals } = await supabaseAdmin
            .from('student_goals')
            .select('*')
            .eq('student_id', id)
            .gte('created_at', twoMonthsAgo.toISOString())
            .lt('created_at', monthAgo.toISOString());

        const { data: lastMonthTasks } = await supabaseAdmin
            .from('student_tasks')
            .select('*')
            .eq('student_id', id)
            .gte('created_at', twoMonthsAgo.toISOString())
            .lt('created_at', monthAgo.toISOString());

        const { data: lastMonthBadges, error: lastMonthBadgesError } = await fetchBadgesByRange(id, twoMonthsAgo.toISOString(), monthAgo.toISOString());
        if (lastMonthBadgesError) {
            return res.status(500).json({ error: lastMonthBadgesError.message || 'Failed to fetch badges' });
        }

        const isTaskDone = (task) => ['completed', 'verified'].includes(String(task?.status || '').toLowerCase());

        const thisMonthStats = {
            goals_created: thisMonthGoals?.length || 0,
            goals_completed: thisMonthGoals?.filter(g => g.status === 'completed').length || 0,
            tasks_completed: thisMonthTasks?.filter(isTaskDone).length || 0,
            badges_earned: thisMonthBadges?.length || 0
        };

        const lastMonthStats = {
            goals_created: lastMonthGoals?.length || 0,
            goals_completed: lastMonthGoals?.filter(g => g.status === 'completed').length || 0,
            tasks_completed: lastMonthTasks?.filter(isTaskDone).length || 0,
            badges_earned: lastMonthBadges?.length || 0
        };

        res.json({
            this_month: thisMonthStats,
            last_month: lastMonthStats,
            period: {
                start: monthAgo.toISOString(),
                end: now.toISOString()
            }
        });

    } catch (error) {
        console.error('Get monthly comparison error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 获取班级分布数据 (教师用)
// ============================================

const getClassDistribution = async (req, res) => {
    const { classId } = req.params;
    const teacherId = req.user.id;
    const cacheKey = `analytics_distribution::v2::${teacherId}::${classId}`;

    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.classDistribution);
    if (cached) {
        res.set('Cache-Control', 'private, max-age=20');
        return res.json(cached);
    }

    try {
        const accessResult = await verifyTeacherClassAccessCached(teacherId, classId);
        if (!accessResult.ok) {
            return res.status(403).json({ error: '无权访问该班级' });
        }

        const payload = await computeClassDistributionPayload(classId);
        if (payload.error) {
            return res.status(500).json({ error: payload.error });
        }

        setCachedApiValue(cacheKey, payload);
        res.set('Cache-Control', 'private, max-age=20');
        res.json(payload);

    } catch (error) {
        console.error('Get class distribution error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 获取班级 AI 洞察建议 (教师用)
// ============================================

const getClassInsights = async (req, res) => {
    const { classId } = req.params;
    const teacherId = req.user.id;
    const forceRefresh = String(req.query.force_refresh || '').toLowerCase() === 'true';
    const cacheKey = `analytics_insights::v1::${teacherId}::${classId}`;

    if (!forceRefresh) {
        const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.classDistribution);
        if (cached) {
            res.set('Cache-Control', 'private, max-age=20');
            return res.json(cached);
        }
    }

    try {
        const accessResult = await verifyTeacherClassAccessCached(teacherId, classId);
        if (!accessResult.ok) {
            return res.status(403).json({ error: '无权访问该班级' });
        }

        const distributionCacheKey = `analytics_distribution::v2::${teacherId}::${classId}`;
        let distributionPayload = getCachedApiValue(distributionCacheKey, API_CACHE_TTL_MS.classDistribution);

        if (!distributionPayload || forceRefresh) {
            distributionPayload = await computeClassDistributionPayload(classId);
            if (distributionPayload.error) {
                return res.status(500).json({ error: distributionPayload.error });
            }
            setCachedApiValue(distributionCacheKey, distributionPayload);
        }

        const insights = buildAiInsightsFromDistribution(
            distributionPayload.distribution || {},
            distributionPayload.students || []
        );

        const payload = {
            insights,
            meta: {
                generated_at: new Date().toISOString(),
                source: 'rule-engine',
                total: insights.length,
                class_id: classId,
                force_refresh: forceRefresh
            }
        };

        setCachedApiValue(cacheKey, payload);
        res.set('Cache-Control', 'private, max-age=20');
        res.json(payload);
    } catch (error) {
        console.error('Get class insights error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 获取班级词云分析 (教师用)
// ============================================

const getClassWordCloud = async (req, res) => {
    const { classId } = req.params;
    const teacherId = req.user.id;
    const forceRefresh = String(req.query.force_refresh || '').toLowerCase() === 'true';
    const days = Math.min(180, Math.max(7, parseInt(req.query.days || '90', 10) || 90));
    const cacheKey = `analytics_word_cloud::v1::${teacherId}::${classId}::${days}`;

    if (!forceRefresh) {
        const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.classDistribution);
        if (cached) {
            res.set('Cache-Control', 'private, max-age=20');
            return res.json(cached);
        }
    }

    try {
        const accessResult = await verifyTeacherClassAccessCached(teacherId, classId);
        if (!accessResult.ok) {
            return res.status(403).json({ error: '无权访问该班级' });
        }

        const studentsResult = await getClassStudentsForDistributionCached(classId);
        if (studentsResult.error) {
            return res.status(500).json({ error: studentsResult.error });
        }

        const students = studentsResult.students || [];
        if (students.length === 0) {
            return res.json({
                words: [],
                meta: {
                    class_id: classId,
                    source: 'class_moments',
                    range_days: days,
                    total_texts: 0,
                    generated_at: new Date().toISOString(),
                    force_refresh: forceRefresh
                }
            });
        }

        const studentIds = students.map((item) => item.id);
        const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const momentsRes = await supabaseAdmin
            .from('class_moments')
            .select('content, created_at, student_id')
            .in('student_id', studentIds)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(1200);

        if (momentsRes.error) {
            if (isSchemaError(momentsRes.error)) {
                return res.json({
                    words: [],
                    meta: {
                        class_id: classId,
                        source: 'class_moments',
                        range_days: days,
                        total_texts: 0,
                        generated_at: new Date().toISOString(),
                        force_refresh: forceRefresh
                    }
                });
            }
            return res.status(500).json({ error: momentsRes.error.message });
        }

        const texts = (momentsRes.data || [])
            .map((row) => String(row.content || '').trim())
            .filter(Boolean);

        const words = extractWordCloudTokens(texts);

        const payload = {
            words,
            meta: {
                class_id: classId,
                source: 'class_moments',
                range_days: days,
                total_texts: texts.length,
                generated_at: new Date().toISOString(),
                force_refresh: forceRefresh
            }
        };

        setCachedApiValue(cacheKey, payload);
        res.set('Cache-Control', 'private, max-age=20');
        res.json(payload);
    } catch (error) {
        console.error('Get class word cloud error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// 获取目标完成热力图数据
// ============================================

const getGoalHeatmap = async (req, res) => {
    const { id } = req.params;
    const { days = 30 } = req.query;

    try {
        const now = new Date();
        const startDate = new Date(now.getTime() - parseInt(days) * 24 * 60 * 60 * 1000);

        // 获取时间范围内的目标完成记录
        const { data: goals } = await supabaseAdmin
            .from('student_goals')
            .select('completed_at, created_at, status')
            .eq('student_id', id)
            .gte('created_at', startDate.toISOString());

        // 按日期统计
        const heatmap = {};
        for (let i = 0; i < parseInt(days); i++) {
            const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateStr = date.toISOString().split('T')[0];
            heatmap[dateStr] = { created: 0, completed: 0 };
        }

        (goals || []).forEach(goal => {
            const createdDate = new Date(goal.created_at).toISOString().split('T')[0];
            if (heatmap[createdDate]) {
                heatmap[createdDate].created++;
            }

            if (goal.completed_at) {
                const completedDate = new Date(goal.completed_at).toISOString().split('T')[0];
                if (heatmap[completedDate]) {
                    heatmap[completedDate].completed++;
                }
            }
        });

        res.json({
            heatmap: Object.entries(heatmap).map(([date, data]) => ({
                date,
                ...data
            })).sort((a, b) => a.date.localeCompare(b.date))
        });

    } catch (error) {
        console.error('Get goal heatmap error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getWeeklyComparison,
    getMonthlyComparison,
    getClassDistribution,
    getClassInsights,
    getClassWordCloud,
    getGoalHeatmap
};
