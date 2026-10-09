const { supabaseAdmin } = require('../middlewares/auth');

const STICKER_RULES = Object.freeze([
    {
        name: '成长启航',
        icon: '🌱',
        description: '第一次完成并通过老师审核的任务。',
        goalText: '通过老师审核 1 个任务',
        target: 1,
        unit: '个任务',
        metricKey: 'verifiedTaskCount'
    },
    {
        name: '材料小能手',
        icon: '📎',
        description: '认真提交过程材料，记录你的成长证据。',
        goalText: '提交 3 次有效材料（文字或图片）',
        target: 3,
        unit: '次材料提交',
        metricKey: 'evidenceSubmissionCount'
    },
    {
        name: '坚持行动家',
        icon: '✅',
        description: '持续行动，积少成多，成长看得见。',
        goalText: '通过老师审核 10 个任务',
        target: 10,
        unit: '个任务',
        metricKey: 'verifiedTaskCount'
    },
    {
        name: '挑战达人',
        icon: '🏆',
        description: '主动完成挑战题，把困难变成成长机会。',
        goalText: '通过老师审核 5 个挑战任务',
        target: 5,
        unit: '个挑战任务',
        metricKey: 'verifiedChallengeCount'
    },
    {
        name: '期待执行家',
        icon: '🚀',
        description: '把期待计划真正做出来，并提交给老师确认。',
        goalText: '通过老师审核 3 个期待计划',
        target: 3,
        unit: '个期待计划',
        metricKey: 'verifiedGoalPlanCount'
    },
    {
        name: '早起鸟',
        icon: '🌅',
        description: '坚持打卡，培养稳定的成长习惯。',
        goalText: '连续打卡 7 天',
        target: 7,
        unit: '天打卡',
        metricKey: 'checkinLongestStreak'
    }
]);

const getStickerRuleByBadgeName = (badgeName) => STICKER_RULES.find((rule) => rule.name === badgeName) || null;

const toDateKey = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
};

const calculateLongestStreak = (rows = []) => {
    const uniqueDateKeys = Array.from(new Set(
        rows
            .map((row) => toDateKey(row.created_at))
            .filter(Boolean)
    )).sort();

    if (uniqueDateKeys.length === 0) return 0;

    let longest = 1;
    let current = 1;

    for (let i = 1; i < uniqueDateKeys.length; i += 1) {
        const prev = new Date(uniqueDateKeys[i - 1]);
        const next = new Date(uniqueDateKeys[i]);
        const diffDays = Math.round((next.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
            current += 1;
            if (current > longest) longest = current;
        } else {
            current = 1;
        }
    }

    return longest;
};

const calculateStudentStickerMetrics = async (studentId) => {
    const [
        { data: completedTasks, error: completedError },
        { count: evidenceCount, error: evidenceError },
        { data: checkins, error: checkinsError }
    ] = await Promise.all([
        supabaseAdmin
            .from('student_tasks')
            .select('goal_id, tasks(type)')
            .eq('student_id', studentId)
            .eq('status', 'completed'),
        supabaseAdmin
            .from('student_tasks')
            .select('id', { count: 'exact', head: true })
            .eq('student_id', studentId)
            .in('status', ['submitted', 'completed', 'rejected'])
            .or('proof_note.not.is.null,proof_url.not.is.null'),
        supabaseAdmin
            .from('student_moods')
            .select('created_at')
            .eq('student_id', studentId)
            .eq('mood', 'checkin')
    ]);

    if (completedError) throw completedError;
    if (evidenceError) throw evidenceError;
    if (checkinsError) throw checkinsError;

    const completedRows = completedTasks || [];
    const verifiedTaskCount = completedRows.length;
    const verifiedGoalPlanCount = completedRows.filter((row) => Boolean(row.goal_id)).length;
    const verifiedChallengeCount = completedRows.filter((row) => row.tasks?.type === 'challenge').length;
    const checkinLongestStreak = calculateLongestStreak(checkins || []);

    return {
        verifiedTaskCount,
        verifiedGoalPlanCount,
        verifiedChallengeCount,
        evidenceSubmissionCount: Math.max(0, Number(evidenceCount) || 0),
        checkinLongestStreak
    };
};

const ensureRuleBadges = async () => {
    const names = STICKER_RULES.map((rule) => rule.name);
    const { data: existingRows, error: existingError } = await supabaseAdmin
        .from('badges')
        .select('id, name')
        .in('name', names);

    if (existingError) throw existingError;

    const existingMap = new Map((existingRows || []).map((row) => [row.name, row]));
    const missingRules = STICKER_RULES.filter((rule) => !existingMap.has(rule.name));

    if (missingRules.length > 0) {
        const toInsert = missingRules.map((rule) => ({
            name: rule.name,
            icon: rule.icon,
            description: `${rule.description}｜任务目标：${rule.goalText}`
        }));

        const { error: insertError } = await supabaseAdmin
            .from('badges')
            .insert(toInsert);

        if (insertError) throw insertError;

        const { data: refreshedRows, error: refreshedError } = await supabaseAdmin
            .from('badges')
            .select('id, name')
            .in('name', names);

        if (refreshedError) throw refreshedError;
        return new Map((refreshedRows || []).map((row) => [row.name, row.id]));
    }

    return new Map((existingRows || []).map((row) => [row.name, row.id]));
};

const syncStudentStickerBadges = async (studentId) => {
    const [badgeIdByName, metrics] = await Promise.all([
        ensureRuleBadges(),
        calculateStudentStickerMetrics(studentId)
    ]);

    const badgeIds = STICKER_RULES
        .map((rule) => badgeIdByName.get(rule.name))
        .filter(Boolean);

    const { data: studentBadges, error: studentBadgesError } = await supabaseAdmin
        .from('student_badges')
        .select('badge_id')
        .eq('student_id', studentId)
        .in('badge_id', badgeIds);

    if (studentBadgesError) throw studentBadgesError;

    const unlockedIds = new Set((studentBadges || []).map((row) => row.badge_id));
    const toAward = [];
    const progressMap = {};

    for (const rule of STICKER_RULES) {
        const badgeId = badgeIdByName.get(rule.name);
        if (!badgeId) continue;

        const current = Math.max(0, Number(metrics[rule.metricKey]) || 0);
        const target = Math.max(1, Number(rule.target) || 1);
        const unlocked = unlockedIds.has(badgeId);

        progressMap[rule.name] = {
            metricKey: rule.metricKey,
            current,
            target,
            percent: Math.min(100, Math.round((current / target) * 100)),
            unlocked
        };

        if (!unlocked && current >= target) {
            toAward.push({ student_id: studentId, badge_id: badgeId });
        }
    }

    if (toAward.length > 0) {
        const { error: awardError } = await supabaseAdmin
            .from('student_badges')
            .insert(toAward);
        if (awardError) throw awardError;

        for (const rule of STICKER_RULES) {
            if (progressMap[rule.name]) {
                progressMap[rule.name].unlocked = progressMap[rule.name].current >= progressMap[rule.name].target;
            }
        }
    }

    return {
        metrics,
        progressMap,
        awardedCount: toAward.length
    };
};

module.exports = {
    STICKER_RULES,
    getStickerRuleByBadgeName,
    syncStudentStickerBadges
};
