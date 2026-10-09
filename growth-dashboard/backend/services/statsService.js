/**
 * Stats Service - 统计计算服务
 * 从 server.js 提取的统计逻辑
 */

const { supabaseAdmin } = require('../middlewares/auth');
const { LEVEL_RULES } = require('../config/level-rules');

// ============================================
// Utility Functions
// ============================================

const parsePositiveInt = (raw, fallback, min, max) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

const toFutureDate = (days) => {
    const safeDays = Math.min(Math.max(Number(days) || 7, 3), 30);
    const date = new Date();
    date.setDate(date.getDate() + safeDays);
    return date.toISOString().slice(0, 10);
};

const toDateKey = (value) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
};

// ============================================
// Level & XP Calculations
// ============================================

const calculateLevelProgress = ({ completedTasks = 0, badges = 0, streak = 0 }) => {
    const safeCompletedTasks = Math.max(0, Number(completedTasks) || 0);
    const safeBadges = Math.max(0, Number(badges) || 0);
    const safeStreak = Math.max(0, Number(streak) || 0);

    const streakBonusDays = Math.min(safeStreak, LEVEL_RULES.maxStreakBonusDays);
    const totalXp =
        safeCompletedTasks * LEVEL_RULES.xpPerCompletedTask +
        safeBadges * LEVEL_RULES.xpPerBadge +
        streakBonusDays * LEVEL_RULES.xpPerStreakDay;

    let level = 1;
    let levelThreshold = LEVEL_RULES.baseLevelXp;
    let xpInCurrentLevel = totalXp;

    while (xpInCurrentLevel >= levelThreshold && level < LEVEL_RULES.maxLevel) {
        xpInCurrentLevel -= levelThreshold;
        level += 1;
        levelThreshold = LEVEL_RULES.baseLevelXp + (level - 1) * LEVEL_RULES.levelStepXp;
    }

    const xpToNextLevel = Math.max(0, levelThreshold - xpInCurrentLevel);
    const progressPercent = levelThreshold > 0
        ? Math.min(100, Math.max(0, Math.round((xpInCurrentLevel / levelThreshold) * 100)))
        : 0;

    return {
        level,
        xp_total: totalXp,
        xp_in_level: xpInCurrentLevel,
        xp_next_level: levelThreshold,
        xp_to_next_level: xpToNextLevel,
        progress_percent: progressPercent,
        xp_per_task: LEVEL_RULES.xpPerCompletedTask,
        xp_sources: {
            tasks: safeCompletedTasks * LEVEL_RULES.xpPerCompletedTask,
            badges: safeBadges * LEVEL_RULES.xpPerBadge,
            streak: streakBonusDays * LEVEL_RULES.xpPerStreakDay
        }
    };
};

// ============================================
// Streak Calculations
// ============================================

const calculateConsecutiveStreak = (timestamps) => {
    if (!timestamps || timestamps.length === 0) return 0;

    const distinctDays = [...new Set(timestamps.map(toDateKey))].sort((a, b) => b - a);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const firstDay = distinctDays[0];
    const gapFromToday = (today.getTime() - firstDay) / (1000 * 60 * 60 * 24);
    if (gapFromToday > 1) return 0;

    let streak = 1;
    for (let i = 0; i < distinctDays.length - 1; i++) {
        const diff = (distinctDays[i] - distinctDays[i + 1]) / (1000 * 60 * 60 * 24);
        if (diff === 1) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
};

const getTaskBasedStreak = async (studentId) => {
    const { data: tasksData } = await supabaseAdmin
        .from('student_tasks')
        .select('completed_at')
        .eq('student_id', studentId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(180);

    const timestamps = (tasksData || [])
        .map(item => item.completed_at)
        .filter(Boolean);

    return calculateConsecutiveStreak(timestamps);
};

// ============================================
// Check-in Functions
// ============================================

const getCheckinStatus = async (studentId) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const { data: checkinLogs } = await supabaseAdmin
        .from('student_moods')
        .select('created_at')
        .eq('student_id', studentId)
        .eq('mood', 'checkin')
        .order('created_at', { ascending: false })
        .limit(180);

    const timestamps = (checkinLogs || [])
        .map(item => item.created_at)
        .filter(Boolean);

    const checkedInToday = timestamps.some((value) => {
        const time = new Date(value).getTime();
        return time >= todayStart.getTime() && time < tomorrowStart.getTime();
    });

    const streak = calculateConsecutiveStreak(timestamps);

    return { checkedInToday, streak };
};

// ============================================
// Dream Context Builder
// ============================================

const normalizeDreamList = (rawDream, rawDreams) => {
    if (Array.isArray(rawDreams)) {
        return rawDreams
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 8);
    }

    const text = typeof rawDream === 'string' ? rawDream : '';
    if (!text.trim()) return [];

    return text
        .split(/\r?\n|[；;、,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8);
};

const buildDreamContext = (profile) => {
    const dreams = normalizeDreamList(profile?.dream, profile?.dreams);
    const primaryDream = dreams[0] || '';
    const dreamLine = dreams.length > 0 ? dreams.join('、') : '';
    return { dreams, primaryDream, dreamLine };
};

// ============================================
// Obstacle Validation
// ============================================

const OBSTACLE_TYPES = new Set(['time', 'capability', 'resource', 'emotion', 'social', 'other']);
const OBSTACLE_STATUS = new Set(['todo', 'in_progress', 'resolved']);

const normalizeObstacleType = (rawType) => {
    const type = String(rawType || '').trim().toLowerCase();
    return OBSTACLE_TYPES.has(type) ? type : 'other';
};

const normalizeObstacleStatus = (rawStatus) => {
    const status = String(rawStatus || '').trim().toLowerCase();
    return OBSTACLE_STATUS.has(status) ? status : '';
};

module.exports = {
    // Utilities
    parsePositiveInt,
    toFutureDate,
    toDateKey,

    // Level & XP
    calculateLevelProgress,

    // Streak
    calculateConsecutiveStreak,
    getTaskBasedStreak,

    // Check-in
    getCheckinStatus,

    // Dream Context
    normalizeDreamList,
    buildDreamContext,

    // Obstacle
    OBSTACLE_TYPES,
    OBSTACLE_STATUS,
    normalizeObstacleType,
    normalizeObstacleStatus
};
