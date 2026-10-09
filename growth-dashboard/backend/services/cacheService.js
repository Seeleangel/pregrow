/**
 * Cache Service - 统一的缓存管理
 * 从 server.js 提取的缓存逻辑
 */

// AI 相关缓存
const suggestionCache = new Map();
const SUGGESTION_TTL_MS = 10 * 60 * 1000;

const commentCache = new Map();
const COMMENT_TTL_MS = 10 * 60 * 1000;

const goalRecommendationCache = new Map();
const GOAL_RECOMMENDATION_TTL_MS = 10 * 60 * 1000;

const obstacleSuggestionCache = new Map();
const OBSTACLE_SUGGESTION_TTL_MS = 8 * 60 * 1000;

// API 响应缓存
const apiCache = new Map();
const API_CACHE_TTL_MS = {
    tasks: 2 * 60 * 1000,           // 2min (任务列表变化不频繁)
    studentTasks: 45 * 1000,        // 45s
    checkin: 5 * 60 * 1000,         // 5min (签到一天最多1次)
    stickerBoard: 5 * 60 * 1000,    // 5min (徽章数据变化少)
    stats: 2 * 60 * 1000,           // 2min
    classMoments: 30 * 1000,        // 30s
    students: 2 * 60 * 1000,        // 2min
    submissions: 30 * 1000,         // 30s
    obstacles: 60 * 1000,           // 1min
    teacherProfile: 2 * 60 * 1000,  // 2min
    teacherClass: 2 * 60 * 1000,    // 2min
    teacherStudents: 60 * 1000,     // 1min
    teacherContext: 45 * 1000,      // 45s (教师班级+学生上下文)
    classDistribution: 60 * 1000,   // 1min
    growthStats: 3 * 60 * 1000,     // 3min (计算量大)
    growthChart: 3 * 60 * 1000,     // 3min (5个并行查询+日期运算)
    goals: 60 * 1000,               // 1min
    badges: 3 * 60 * 1000,          // 3min
    milestones: 3 * 60 * 1000,      // 3min
    summary: 10 * 60 * 1000,        // 10min (含AI调用，节省开销)
};

// ============================================
// Suggestion Cache Functions
// ============================================

const getCachedSuggestion = (studentId) => {
    const cached = suggestionCache.get(studentId);
    if (!cached) return null;
    if (Date.now() - cached.createdAt > SUGGESTION_TTL_MS) {
        suggestionCache.delete(studentId);
        return null;
    }
    return cached.value;
};

const setCachedSuggestion = (studentId, value) => {
    suggestionCache.set(studentId, { value, createdAt: Date.now() });
};

// ============================================
// Comment Cache Functions
// ============================================

const getCachedComment = (studentId) => {
    const cached = commentCache.get(studentId);
    if (!cached) return null;
    if (Date.now() - cached.createdAt > COMMENT_TTL_MS) {
        commentCache.delete(studentId);
        return null;
    }
    return cached.value;
};

const setCachedComment = (studentId, value) => {
    commentCache.set(studentId, { value, createdAt: Date.now() });
};

// ============================================
// Goal Recommendation Cache Functions
// ============================================

const getCachedGoalRecommendations = (studentId) => {
    const cached = goalRecommendationCache.get(studentId);
    if (!cached) return null;
    if (Date.now() - cached.createdAt > GOAL_RECOMMENDATION_TTL_MS) {
        goalRecommendationCache.delete(studentId);
        return null;
    }
    return cached.value;
};

const setCachedGoalRecommendations = (studentId, value) => {
    goalRecommendationCache.set(studentId, { value, createdAt: Date.now() });
};

// ============================================
// Obstacle Suggestion Cache Functions
// ============================================

const getCachedObstacleSuggestion = (cacheKey) => {
    const cached = obstacleSuggestionCache.get(cacheKey);
    if (!cached) return null;
    if (Date.now() - cached.createdAt > OBSTACLE_SUGGESTION_TTL_MS) {
        obstacleSuggestionCache.delete(cacheKey);
        return null;
    }
    return cached.value;
};

const setCachedObstacleSuggestion = (cacheKey, value) => {
    obstacleSuggestionCache.set(cacheKey, { value, createdAt: Date.now() });
};

// ============================================
// API Response Cache Functions
// ============================================

const getCachedApiValue = (key, ttlMs) => {
    const cached = apiCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.createdAt > ttlMs) {
        apiCache.delete(key);
        return null;
    }
    return cached.value;
};

const setCachedApiValue = (key, value) => {
    apiCache.set(key, { value, createdAt: Date.now() });
};

const clearCachedApiByPrefix = (prefix) => {
    for (const key of apiCache.keys()) {
        if (key.startsWith(prefix)) {
            apiCache.delete(key);
        }
    }
};

// ============================================
// Cache Invalidation Functions
// ============================================

const invalidateMomentsCache = () => {
    clearCachedApiByPrefix('class_moments::');
};

const invalidateStudentCaches = (studentId) => {
    if (!studentId) return;
    clearCachedApiByPrefix(`tasks::${studentId}`);
    clearCachedApiByPrefix(`student_tasks::${studentId}`);
    clearCachedApiByPrefix(`checkin::${studentId}`);
    clearCachedApiByPrefix(`growth_stats::${studentId}`);
    clearCachedApiByPrefix(`badges::${studentId}`);
    clearCachedApiByPrefix(`sticker_board::${studentId}`);
    clearCachedApiByPrefix(`stats::${studentId}`);
    clearCachedApiByPrefix(`growth_chart::${studentId}`);
    clearCachedApiByPrefix(`obstacles::${studentId}`);
};

const invalidateTeacherCaches = () => {
    clearCachedApiByPrefix('students::');
    clearCachedApiByPrefix('submissions::');
    clearCachedApiByPrefix('task_completion_summary::');
    clearCachedApiByPrefix('attention_students::');
    clearCachedApiByPrefix('obstacles_summary::');
    clearCachedApiByPrefix('teacher_profile::');
    clearCachedApiByPrefix('teacher_class::');
    clearCachedApiByPrefix('class_students::');
    clearCachedApiByPrefix('teacher_context::');
    clearCachedApiByPrefix('analytics_distribution::');
};

const invalidateStudentAiCaches = (studentId) => {
    if (!studentId) return;

    commentCache.delete(studentId);

    for (const key of suggestionCache.keys()) {
        if (key === studentId || key.startsWith(`${studentId}::`)) {
            suggestionCache.delete(key);
        }
    }

    for (const key of goalRecommendationCache.keys()) {
        if (key === studentId || key.startsWith(`${studentId}::`)) {
            goalRecommendationCache.delete(key);
        }
    }

    for (const key of obstacleSuggestionCache.keys()) {
        if (key === studentId || key.startsWith(`${studentId}::`)) {
            obstacleSuggestionCache.delete(key);
        }
    }

    clearCachedApiByPrefix(`obstacles::${studentId}`);
};

module.exports = {
    // TTL Constants
    API_CACHE_TTL_MS,

    // Suggestion Cache
    getCachedSuggestion,
    setCachedSuggestion,

    // Comment Cache
    getCachedComment,
    setCachedComment,

    // Goal Recommendation Cache
    getCachedGoalRecommendations,
    setCachedGoalRecommendations,

    // Obstacle Suggestion Cache
    getCachedObstacleSuggestion,
    setCachedObstacleSuggestion,

    // API Cache
    getCachedApiValue,
    setCachedApiValue,
    clearCachedApiByPrefix,

    // Invalidation
    invalidateMomentsCache,
    invalidateStudentCaches,
    invalidateTeacherCaches,
    invalidateStudentAiCaches
};
