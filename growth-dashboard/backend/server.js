const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { LEVEL_RULES } = require('./config/level-rules');
const { getImageUrl } = require('./supabase_storage_helper');
const studentController = require('./controllers/student.controller');
const teacherController = require('./controllers/teacher.controller');
const notificationController = require('./controllers/notification.controller');
const teacherRoutes = require('./routes/teacher.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const exportRoutes = require('./routes/export.routes');
const { requireAuth } = require('./middlewares/auth');
const { cacheMiddleware } = require('./middlewares/cache');
const { performanceMiddleware, getPerformanceStats } = require('./middlewares/performance');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Helper function to normalize challenge image paths
function normalizeChallengeImagePath(rawPath) {
    const path = String(rawPath || '').trim();
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;

    const cleaned = path.replace(/^\/+/, '');

    if (cleaned.startsWith('student/img/challenges/')) {
        return cleaned;
    }

    if (cleaned.startsWith('img/challenges/')) {
        return `student/${cleaned}`;
    }

    if (cleaned.startsWith('img/')) {
        const fileName = cleaned.split('/').pop();
        return fileName ? `student/img/challenges/${fileName}` : cleaned;
    }

    return cleaned;
}

const challengeFallbackLibrary = {
    school: [
        {
            id: 'fallback-school-1',
            title: '课堂回答错了，同学笑了',
            description: '你有点难过，不知道下一次还要不要举手。',
            challenge_category: 'school',
            image_url: '/img/challenges/s_6.png',
            options: [
                { id: 'A', text: '我太笨了，以后再也不举手了。', type: 'negative', feedback: '一次答错不代表你不行，勇敢尝试本身就是进步。' },
                { id: 'B', text: '告诉自己“答错也是学习”，下次继续尝试。', type: 'positive', feedback: '你愿意继续尝试，这就是成长型思维。' }
            ]
        }
    ],
    home: [
        {
            id: 'fallback-home-1',
            title: '拼图总是拼不出来',
            description: '你开始有点着急，想要放弃了。',
            challenge_category: 'home',
            image_url: '/img/challenges/h_3.png',
            options: [
                { id: 'A', text: '我不玩了，反正我不会。', type: 'negative', feedback: '给自己贴标签会挡住进步。' },
                { id: 'B', text: '先找边框，再一块块试。', type: 'positive', feedback: '你在用策略解决问题，这很棒。' }
            ]
        }
    ],
    parent_child: [
        {
            id: 'fallback-parent-child-1',
            title: '你不小心打碎了家里最漂亮的花瓶',
            description: '你很害怕被骂，不知道该怎么办。',
            challenge_category: 'parent_child',
            image_url: '/img/challenges/pc_2.png',
            options: [
                { id: 'A', text: '偷偷把碎片藏起来，假装不知道。', type: 'negative', feedback: '说谎会让心里一直有块石头。' },
                { id: 'B', text: '主动道歉，并承诺下次更小心。', type: 'positive', feedback: '诚实和承担责任都很了不起。' }
            ]
        }
    ],
    classmate: [
        {
            id: 'fallback-classmate-1',
            title: '在食堂吃饭时，你不小心把汤洒在了同学衣服上',
            description: '同学看起来要生气了，你会怎么做？',
            challenge_category: 'classmate',
            image_url: '/img/challenges/c_6.png',
            options: [
                { id: 'A', text: '装作没看见，赶紧端着餐盘走开。', type: 'negative', feedback: '逃避不会让事情变好。' },
                { id: 'B', text: '马上拿纸巾帮他擦，并真诚道歉。', type: 'positive', feedback: '真诚道歉和及时补救，会让问题更快解决。' }
            ]
        }
    ]
};

function normalizeChallengeRecord(record = {}) {
    const options = Array.isArray(record.options) ? record.options.filter(Boolean) : [];
    const safeCategory = String(record.challenge_category || '').trim().toLowerCase();
    const imagePath = record.image_url ? getImageUrl(normalizeChallengeImagePath(record.image_url)) : '';
    const normalizedOptions = options.length >= 2
        ? options.map((option, index) => ({
            id: option.id || (index === 0 ? 'A' : 'B'),
            text: option.text || (index === 0 ? '先逃开再说。' : '想办法认真解决。'),
            type: option.type || (index === 0 ? 'negative' : 'positive'),
            feedback: option.feedback || ''
        }))
        : [
            { id: 'A', text: '先躲开，不去面对。', type: 'negative', feedback: '逃避只会让事情变得更难。' },
            { id: 'B', text: '冷静下来，想一个更好的办法。', type: 'positive', feedback: '愿意面对问题，就是在成长。' }
        ];

    return {
        id: record.id || `fallback-${safeCategory || 'all'}`,
        title: record.title || '你会怎么做？',
        description: record.description || '请选择一个更积极的想法。',
        challenge_category: safeCategory || 'home',
        image_url: imagePath,
        options: normalizedOptions
    };
}

function getFallbackChallenge(category) {
    const pool = category && challengeFallbackLibrary[category]
        ? challengeFallbackLibrary[category]
        : Object.values(challengeFallbackLibrary).flat();
    const picked = pool[Math.floor(Math.random() * pool.length)] || challengeFallbackLibrary.home[0];
    return normalizeChallengeRecord(picked);
}

const app = express();
const port = process.env.PORT || 3003;

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});


// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.tailwindcss.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:", "https://*.supabase.co"],
            connectSrc: ["'self'", "https://*.supabase.co"],
        },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding for fonts
}));

// Compression middleware - gzip for all responses
app.use(compression({
    level: 6, // Balanced between speed and compression
    filter: (req, res) => {
        // Don't compress small responses
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    }
}));

// Performance monitoring middleware
app.use(performanceMiddleware);

// CORS middleware
app.use(cors());

// Body parsing middleware
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));

// Static file serving with aggressive caching
const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

// Serve static images from parent directory with caching
app.use('/img', express.static(path.join(__dirname, '../img'), {
    maxAge: ONE_WEEK,
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
        // Cache WebP images for longer
        if (path.endsWith('.webp')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        // Cache other images for a week
        else if (path.match(/\.(png|jpg|jpeg|gif)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=604800');
        }
    }
}));

// Serve optimized challenge images
app.use('/img/challenges-optimized', express.static(path.join(__dirname, '../student/img/challenges-optimized'), {
    maxAge: ONE_YEAR,
    etag: true,
    immutable: true,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
}));

app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: '上传文件过大，请压缩后重试（建议不超过 8MB）' });
    }
    if (err) {
        console.error('Request parse error:', err);
        return res.status(400).json({ error: '请求格式错误' });
    }
    next();
});

// Supabase Public Client (for Auth)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const ecnuApiKey = process.env.ECNU_API_KEY;

if (!supabaseUrl || !supabaseKey || !supabaseServiceKey) {
    console.error('Missing Supabase Credentials (URL, Key, or Service Key) in .env');
    process.exit(1);
}

// Supabase Public Client (for Auth & Client-side logic emulation)
const supabase = createClient(supabaseUrl, supabaseKey);

// Supabase Admin Client (for DB operations bypassing RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

console.log('Supabase Config Check:');
console.log('URL:', supabaseUrl);
console.log('Anon Key (Start):', supabaseKey.substring(0, 10) + '...');
console.log('Service Key (Start):', supabaseServiceKey.substring(0, 10) + '...');

if (supabaseKey === supabaseServiceKey) {
    console.warn('WARNING: SUPABASE_KEY and SUPABASE_SERVICE_KEY appear to be identical. Service Key should be different (secret)!');
}

const suggestionCache = new Map();
const SUGGESTION_TTL_MS = 10 * 60 * 1000;
const commentCache = new Map();
const COMMENT_TTL_MS = 10 * 60 * 1000;
const goalRecommendationCache = new Map();
const GOAL_RECOMMENDATION_TTL_MS = 10 * 60 * 1000;

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

const apiCache = new Map();
const API_CACHE_TTL_MS = {
    tasks: 60 * 1000,
    studentTasks: 30 * 1000,
    checkin: 15 * 1000,
    stickerBoard: 60 * 1000,
    stats: 30 * 1000,
    classMoments: 20 * 1000,
    students: 60 * 1000,
    submissions: 20 * 1000
};

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

const invalidateMomentsCache = () => {
    clearCachedApiByPrefix('class_moments::');
};

const invalidateStudentCaches = (studentId) => {
    if (!studentId) return;
    clearCachedApiByPrefix(`tasks::${studentId}`);
    clearCachedApiByPrefix(`student_tasks::${studentId}`);
    clearCachedApiByPrefix(`checkin::${studentId}`);
    clearCachedApiByPrefix(`sticker_board::${studentId}`);
    clearCachedApiByPrefix(`stats::${studentId}`);
};

const invalidateTeacherCaches = () => {
    clearCachedApiByPrefix('students::');
    clearCachedApiByPrefix('submissions::');
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
};

const parsePositiveInt = (raw, fallback, min, max) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

app.get('/api/notifications', requireAuth, notificationController.getNotifications);
app.get('/api/notifications/unread-count', requireAuth, notificationController.getUnreadCount);
app.post('/api/notifications/read-all', requireAuth, notificationController.markAllAsRead);
app.post('/api/notifications/:id/read', requireAuth, notificationController.markAsRead);
app.delete('/api/notifications/:id', requireAuth, notificationController.deleteNotification);
app.use('/api/teacher', teacherRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/export', exportRoutes);

const toFutureDate = (days) => {
    const safeDays = Math.min(Math.max(Number(days) || 7, 3), 30);
    const date = new Date();
    date.setDate(date.getDate() + safeDays);
    return date.toISOString().slice(0, 10);
};

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
        .split(/\r?\n|[，。、；;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8);
};

const areDreamListsEqual = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => item === right[index]);
};

const buildDreamContext = (profile) => {
    const dreams = normalizeDreamList(profile?.dream, profile?.dreams);
    const primaryDream = dreams[0] || '';
    const dreamLine = dreams.length > 0 ? dreams.join('、') : '';
    return { dreams, primaryDream, dreamLine };
};

const GOAL_FALLBACK_POOL = [
    (safeName, dreamText) => ({ title: `画一张“${dreamText}”小海报`, description: `${safeName}每天用5分钟补充一处内容，和家人分享你的期待故事。`, target_date: toFutureDate(7) }),
    (safeName, dreamText) => ({ title: '每天完成一次生活小自理', description: '例如自己整理书包、收拾玩具或叠衣服，连续坚持一周。', target_date: toFutureDate(10) }),
    (safeName, dreamText) => ({ title: '做一次勇敢表达练习', description: '每天对老师或家人说一句积极的话，练习清晰表达和自信。', target_date: toFutureDate(14) }),
    (safeName, dreamText) => ({ title: `和家人聊聊“${dreamText}”`, description: `${safeName}可以问问家人觉得这个期待需要什么本领。`, target_date: toFutureDate(5) }),
    (safeName, dreamText) => ({ title: '帮家人做一件力所能及的小事', description: '比如帮忙摆碗筷、浇花、擦桌子，锻炼动手能力。', target_date: toFutureDate(3) }),
];

const buildGoalRecommendationFallback = (safeName, dream, count = 3) => {
    const dreamText = dream || '成为更棒的自己';
    const shuffled = [...GOAL_FALLBACK_POOL].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, count).map(fn => fn(safeName, dreamText));
    return { title: 'AI目标推荐', recommendations: picked };
};

const parseGoalRecommendationContent = (content) => {
    if (!content) return [];

    const cleaned = content
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

    try {
        const parsed = JSON.parse(cleaned);
        const arr = Array.isArray(parsed)
            ? parsed
            : (Array.isArray(parsed.recommendations) ? parsed.recommendations : []);

        return arr.map((item) => ({
            title: String(item.title || '').trim(),
            description: String(item.description || '').trim(),
            target_date: toFutureDate(item.days_to_target || item.days || 7)
        })).filter((item) => item.title).slice(0, 4);
    } catch (error) {
        const lines = cleaned
            .split(/\n+/)
            .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
            .filter(Boolean)
            .slice(0, 4);

        return lines.map((line, index) => ({
            title: line.length > 22 ? `${line.slice(0, 22)}...` : line,
            description: line,
            target_date: toFutureDate(7 + index * 3)
        }));
    }
};

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

const getObstacleFallbackSuggestion = ({ studentName, dream, obstacleType, content }) => {
    const safeName = studentName || '同学';
    const safeDream = dream || '你的期待';
    const safeContent = content || '当前遇到的困难';

    const byType = {
        time: `把“${safeContent}”拆成 10 分钟能完成的小步骤，先做第一步就很棒。`,
        capability: `先找一个最容易练习的小技能，连续练 3 天，你会看到自己进步。`,
        resource: `试着向老师或家人说明你需要什么帮助，他们会更容易支持你。`,
        emotion: `先深呼吸 3 次，再告诉自己“我可以先试一次”，慢慢来就会更有信心。`,
        social: `可以先和一位你信任的人说说这个困难，一起想一个小办法。`,
        other: `把困难写成一句话，再写下一个今天就能做的小行动。`
    };

    const first = `${safeName}，关于“${safeDream}”，你已经在认真面对困难了，这非常了不起。`;
    const second = byType[obstacleType] || byType.other;
    return `${first}${second}`;
};

const toDateKey = (value) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
};

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

// Routes
// Middleware to handle mock-student-id for local testing
app.use('/api/student/:id', (req, res, next) => {
    if (req.params.id === 'mock-student-id') {
        // If it's the growth-chart endpoint, return mock data immediately
        if (req.path === '/growth-chart') {
             return res.json({
                current: { optimism: 75, grit: 60, creativity: 50, social: 40, achievement: 80 },
                weekly: [
                    { week: 'W1', optimism: 60, grit: 50, creativity: 40, social: 30, achievement: 70 },
                    { week: 'W2', optimism: 65, grit: 55, creativity: 45, social: 35, achievement: 75 },
                    { week: 'W3', optimism: 70, grit: 58, creativity: 48, social: 38, achievement: 78 },
                    { week: 'W4', optimism: 72, grit: 60, creativity: 50, social: 40, achievement: 80 },
                    { week: 'W5', optimism: 75, grit: 62, creativity: 52, social: 42, achievement: 82 },
                    { week: 'W6', optimism: 78, grit: 65, creativity: 55, social: 45, achievement: 85 }
                ]
            });
        }
        // If it's profile/stats, return mock stats
        if (req.path === '/stats') {
            return res.json({
                badges: 5,
                completed_tasks: 12,
                radar: [80, 70, 60, 50, 90],
                streak: 3,
                checked_in_today: false
            });
        }
    }
    next();
});


// Register User
app.post('/api/register', async (req, res) => {
    const { email, password, role, name, inviteCode, schoolName, className } = req.body;

    try {
        // 1. Sign up user with Supabase Auth (Public Client - as User)
        // Note: This returns a session.
        // 1. Sign up user with Supabase Auth (Admin Client - Bypass Rate Limits & Email Confirm)
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true // Auto-confirm email
        });

        if (authError) throw authError;

        const user = authData.user;

        if (user) {
            // 2. Insert profile data (Admin Client - Bypass RLS)
            // We use supabaseAdmin here because the public client isn't "logged in"
            // as the new user context for the DB insert unless we manually set the session.
            // Using Admin client is safer for trusted backend logic.
            console.log(`Attempting to create profile for user: ${user.id}`);
            const { error: profileError } = await supabaseAdmin
                .from('profiles')
                .insert([
                    {
                        id: user.id,
                        role,
                        full_name: name,
                        school_name: schoolName,
                        class_name: className,
                        invite_code: inviteCode
                    }
                ]);

            if (profileError) {
                // Determine if we should delete the auth user if profile creation fails?
                // For MVP, just return error.
                throw profileError;
            }

            // Admin createUser doesn't return a session, but frontend might expect one.
            // For MVP registration, usually we redirect to login anyway.
            if (role === 'student') {
                invalidateTeacherCaches();
            }
            res.status(201).json({ message: 'User registered successfully', user });
        } else {
            res.status(400).json({ message: 'User verification failed' });
        }

    } catch (error) {
        console.error('Registration error details:', error);
        if (error.cause) console.error('Error cause:', error.cause);
        let errorMessage = error.message || '注册失败，请稍后重试';

        // 检查是否是数据库约束违反（姓名长度不足）
        if (errorMessage && errorMessage.includes('username_length')) {
            errorMessage = '姓名长度至少需要 3 个字符';
        }
        // 检查是否是用户已存在
        else if (errorMessage && (errorMessage.includes('already') || errorMessage.includes('duplicate'))) {
            errorMessage = '该邮箱已被注册，请使用其他邮箱或直接登录';
        }
        res.status(400).json({ error: errorMessage });
    }
});

// Login User
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;

        // Fetch user profile to get role
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        if (profileError) {
            console.error('Error fetching profile:', profileError);
            // Return auth data even if profile fetch fails, but warn
        }

        res.status(200).json({
            message: 'Login successful',
            session: data.session,
            user: data.user,
            role: profile ? profile.role : null
        });

    } catch (error) {
        console.error('Login error:', error);
        let errorMessage = error.message || '登录失败，请检查账号密码';

        // 检查是否是用户已存在或其他常见错误
        if (errorMessage && (errorMessage.includes('already') || errorMessage.includes('duplicate'))) {
            errorMessage = '该邮箱已被注册，请使用其他邮箱或直接登录';
        } else if (errorMessage && (errorMessage.includes('Invalid') || errorMessage.includes('credentials'))) {
            errorMessage = '账号或密码错误';
        }
        res.status(401).json({ error: errorMessage });
    }
});

// --- New API Endpoints for Dashboard Features (Tasks, Moods, Feed) ---

// 1. Get all available purposes/tasks
app.get('/api/tasks', async (req, res) => {
    const studentId = req.query.student_id ? String(req.query.student_id) : '';
    const limit = parsePositiveInt(req.query.limit, 200, 20, 500);
    const cacheKey = `tasks::${studentId || 'public'}::${limit}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.tasks);
    if (cached) return res.json(cached);

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

        const publicTasks = data || [];
        setCachedApiValue(cacheKey, publicTasks);
        return res.json(publicTasks);
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
        console.error('Error fetching shared tasks:', sharedResult.error);
        return res.status(500).json({ error: sharedResult.error.message });
    }
    if (personalResult.error) {
        console.error('Error fetching personal tasks:', personalResult.error);
        return res.status(500).json({ error: personalResult.error.message });
    }

    const merged = [...(sharedResult.data || []), ...(personalResult.data || [])]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, limit);

    setCachedApiValue(cacheKey, merged);
    res.json(merged);
});

// 2. Submit a mood log
app.post('/api/student/mood', async (req, res) => {
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
});

// 2.1 Check-in status
app.get('/api/student/:id/checkin/status', async (req, res) => {
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
});

// 2.2 Submit daily check-in
app.post('/api/student/:id/checkin', async (req, res) => {
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
            console.error('Error submitting check-in:', error);
            return res.status(500).json({ error: error.message });
        }

        const statusAfter = await getCheckinStatus(id);
        invalidateStudentCaches(id);
        res.json({
            message: 'Check-in recorded',
            checked_in_today: true,
            streak: statusAfter.streak,
            already_checked_in: false,
            data
        });
    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 3. Get Class Moments (Feed)
app.get('/api/class/moments', async (req, res) => {
    const userId = req.query.user_id ? String(req.query.user_id) : '';
    const limit = parsePositiveInt(req.query.limit, 20, 5, 50);
    const cacheKey = `class_moments::${userId || 'anon'}::${limit}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.classMoments);
    if (cached) return res.json(cached);

    const { data, error } = await supabaseAdmin
        .from('class_moments')
        .select('id, student_id, content, type, media_url, likes, created_at, profiles(full_name, avatar_url)')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Error fetching class moments:', error);
        if (error.code === '42P01') return res.json([]);
        return res.status(500).json({ error: error.message });
    }
    if (!data || data.length === 0) {
        setCachedApiValue(cacheKey, []);
        return res.json([]);
    }

    const momentIds = data.map((moment) => moment.id);
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
        const key = row.moment_id;
        commentCountMap.set(key, (commentCountMap.get(key) || 0) + 1);
    }

    for (const row of likesResult.data || []) {
        const key = row.moment_id;
        likeCountMap.set(key, (likeCountMap.get(key) || 0) + 1);
        if (userId && row.student_id === userId) {
            likedByMeSet.add(key);
        }
    }

    const moments = data.map((moment) => ({
        ...moment,
        comment_count: commentCountMap.get(moment.id) || 0,
        like_count: likeCountMap.get(moment.id) ?? Number(moment.likes || 0),
        liked_by_me: likedByMeSet.has(moment.id)
    }));

    setCachedApiValue(cacheKey, moments);
    res.json(moments);
});

// 4. Create a Class Moment (Teacher or System)
app.post('/api/class/moments', async (req, res) => {
    const { student_id, content, type, media_url } = req.body;

    if (!student_id) {
        return res.status(400).json({ error: 'Missing student_id' });
    }
    if ((!content || !content.trim()) && !media_url) {
        return res.status(400).json({ error: '请输入动态内容或上传媒体' });
    }

    const { data, error } = await supabaseAdmin
        .from('class_moments')
        .insert([{ student_id, content: content ? content.trim() : '', type: type || 'share', media_url: media_url || null }])
        .select();

    if (error) {
        console.error('Error creating moment:', error);
        return res.status(500).json({ error: error.message });
    }
    invalidateMomentsCache();
    res.json({ message: 'Moment shared', data });
});

// 4.1 Upload media for class moments (image/audio)
app.post('/api/class/moments/upload', async (req, res) => {
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
        const uploadsDir = path.join(__dirname, '../img/uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });

        const cleanName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const extension = path.extname(cleanName) || (isImage ? '.png' : '.mp3');
        const finalName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${extension}`;
        const finalPath = path.join(uploadsDir, finalName);

        const rawBase64 = dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;
        const buffer = Buffer.from(rawBase64, 'base64');
        fs.writeFileSync(finalPath, buffer);

        res.json({
            media_url: `/img/uploads/${finalName}`,
            media_type: isImage ? 'image' : 'audio'
        });
    } catch (error) {
        console.error('Upload media error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4.2 Toggle like for class moment
app.post('/api/class/moments/:id/like', async (req, res) => {
    const { id } = req.params;
    const { student_id } = req.body;

    if (!student_id) {
        return res.status(400).json({ error: 'Missing student_id' });
    }

    try {
        const { data: existingLike, error: findError } = await supabaseAdmin
            .from('class_moment_likes')
            .select('id')
            .eq('moment_id', id)
            .eq('student_id', student_id)
            .maybeSingle();

        if (findError && findError.code !== 'PGRST116' && findError.code !== '42P01') {
            return res.status(500).json({ error: findError.message });
        }

        let likedByMe = false;

        if (findError && findError.code === '42P01') {
            const { data: moment } = await supabaseAdmin
                .from('class_moments')
                .select('likes')
                .eq('id', id)
                .maybeSingle();

            const nextLikes = Number(moment?.likes || 0) + 1;
            await supabaseAdmin.from('class_moments').update({ likes: nextLikes }).eq('id', id);
            invalidateMomentsCache();
            return res.json({ liked_by_me: true, like_count: nextLikes });
        }

        if (existingLike) {
            await supabaseAdmin
                .from('class_moment_likes')
                .delete()
                .eq('id', existingLike.id);
            likedByMe = false;
        } else {
            await supabaseAdmin
                .from('class_moment_likes')
                .insert([{ moment_id: id, student_id }]);
            likedByMe = true;
        }

        const { count: likeCount } = await supabaseAdmin
            .from('class_moment_likes')
            .select('*', { count: 'exact', head: true })
            .eq('moment_id', id);

        await supabaseAdmin
            .from('class_moments')
            .update({ likes: likeCount || 0 })
            .eq('id', id);

        invalidateMomentsCache();
        res.json({
            liked_by_me: likedByMe,
            like_count: likeCount || 0
        });
    } catch (error) {
        console.error('Like moment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4.3 Get comments for class moment
app.get('/api/class/moments/:id/comments', async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
        .from('class_moment_comments')
        .select('*, profiles(full_name, avatar_url)')
        .eq('moment_id', id)
        .order('created_at', { ascending: true });

    if (error) {
        if (error.code === '42P01') return res.json([]);
        return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
});

// 4.4 Create comment for class moment
app.post('/api/class/moments/:id/comments', async (req, res) => {
    const { id } = req.params;
    const { student_id, content } = req.body;

    if (!student_id || !content || !content.trim()) {
        return res.status(400).json({ error: 'Missing student_id or comment content' });
    }

    const { data, error } = await supabaseAdmin
        .from('class_moment_comments')
        .insert([{ moment_id: id, student_id, content: content.trim() }])
        .select('*, profiles(full_name, avatar_url)')
        .single();

    if (error) {
        if (error.code === '42P01') {
            return res.status(500).json({ error: 'class_moment_comments table not found' });
        }
        return res.status(500).json({ error: error.message });
    }

    invalidateMomentsCache();
    res.status(201).json(data);
});

// 4.5 Delete class moment (owner only)
app.delete('/api/class/moments/:id', async (req, res) => {
    const { id } = req.params;
    const { student_id } = req.body || {};

    if (!student_id) {
        return res.status(400).json({ error: 'Missing student_id' });
    }

    try {
        const { data: moment, error: momentError } = await supabaseAdmin
            .from('class_moments')
            .select('id, student_id')
            .eq('id', id)
            .maybeSingle();

        if (momentError) {
            return res.status(500).json({ error: momentError.message });
        }

        if (!moment) {
            return res.status(404).json({ error: '动态不存在' });
        }

        if (moment.student_id !== student_id) {
            return res.status(403).json({ error: '无权限删除该动态' });
        }

        const { error: deleteError } = await supabaseAdmin
            .from('class_moments')
            .delete()
            .eq('id', id);

        if (deleteError) {
            return res.status(500).json({ error: deleteError.message });
        }

        invalidateMomentsCache();
        res.json({ success: true, message: '动态已删除' });
    } catch (error) {
        console.error('Delete moment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4.6 Delete class moment comment (comment owner or moment owner)
app.delete('/api/class/moments/:id/comments/:commentId', async (req, res) => {
    const { id, commentId } = req.params;
    const { student_id } = req.body || {};

    if (!student_id) {
        return res.status(400).json({ error: 'Missing student_id' });
    }

    try {
        const [{ data: comment, error: commentError }, { data: moment, error: momentError }] = await Promise.all([
            supabaseAdmin
                .from('class_moment_comments')
                .select('id, student_id, moment_id')
                .eq('id', commentId)
                .eq('moment_id', id)
                .maybeSingle(),
            supabaseAdmin
                .from('class_moments')
                .select('id, student_id')
                .eq('id', id)
                .maybeSingle()
        ]);

        if (commentError) {
            return res.status(500).json({ error: commentError.message });
        }
        if (momentError) {
            return res.status(500).json({ error: momentError.message });
        }

        if (!comment) {
            return res.status(404).json({ error: '评论不存在' });
        }

        const isCommentOwner = comment.student_id === student_id;
        const isMomentOwner = moment?.student_id === student_id;
        if (!isCommentOwner && !isMomentOwner) {
            return res.status(403).json({ error: '无权限删除该评论' });
        }

        const { error: deleteError } = await supabaseAdmin
            .from('class_moment_comments')
            .delete()
            .eq('id', commentId)
            .eq('moment_id', id);

        if (deleteError) {
            return res.status(500).json({ error: deleteError.message });
        }

        invalidateMomentsCache();
        res.json({ success: true, message: '评论已删除' });
    } catch (error) {
        console.error('Delete comment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4.7 Delete class moment by teacher (moderation)
app.delete('/api/class/moments/:id/teacher-delete', async (req, res) => {
    const { id } = req.params;
    const { teacher_id } = req.body || {};

    if (!teacher_id) {
        return res.status(400).json({ error: 'Missing teacher_id' });
    }

    try {
        const { data: teacherProfile, error: teacherError } = await supabaseAdmin
            .from('profiles')
            .select('id, role')
            .eq('id', teacher_id)
            .maybeSingle();

        if (teacherError) {
            return res.status(500).json({ error: teacherError.message });
        }

        if (!teacherProfile || teacherProfile.role !== 'teacher') {
            return res.status(403).json({ error: '仅老师可执行该操作' });
        }

        const { data: moment, error: momentError } = await supabaseAdmin
            .from('class_moments')
            .select('id')
            .eq('id', id)
            .maybeSingle();

        if (momentError) {
            return res.status(500).json({ error: momentError.message });
        }

        if (!moment) {
            return res.status(404).json({ error: '动态不存在' });
        }

        const { error: deleteError } = await supabaseAdmin
            .from('class_moments')
            .delete()
            .eq('id', id);

        if (deleteError) {
            return res.status(500).json({ error: deleteError.message });
        }

        invalidateMomentsCache();
        res.json({ success: true, message: '动态已删除（老师）' });
    } catch (error) {
        console.error('Teacher delete moment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 5. Get Student Tasks
app.get('/api/student/:id/tasks', async (req, res) => {
    const { id } = req.params;
    const limit = parsePositiveInt(req.query.limit, 300, 50, 1000);
    const cacheKey = `student_tasks::${id}::${limit}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.studentTasks);
    if (cached) return res.json(cached);

    const { data, error } = await supabaseAdmin
        .from('student_tasks')
        .select('id, task_id, status, completed_at, created_at')
        .eq('student_id', id)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Error fetching student tasks:', error);
        return res.status(500).json({ error: error.message });
    }
    const rows = data || [];
    setCachedApiValue(cacheKey, rows);
    res.json(rows);
});

// 5.0 Create personal today-plan item
app.post('/api/student/:id/today-plan', async (req, res) => {
    const { id } = req.params;
    const { title, description, points_reward } = req.body || {};

    if (!title || !String(title).trim()) {
        return res.status(400).json({ error: 'Missing task title' });
    }

    const payload = {
        title: String(title).trim(),
        description: description ? String(description).trim() : null,
        type: 'personal',
        points_reward: Number.isFinite(Number(points_reward)) ? Math.max(1, Number(points_reward)) : 5,
        created_by: id
    };

    try {
        const { data, error } = await supabaseAdmin
            .from('tasks')
            .insert([payload])
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateStudentCaches(id);
        res.status(201).json(data);
    } catch (error) {
        console.error('Create today plan task error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 5.0.1 Delete/hide one today-plan item
app.delete('/api/student/:id/today-plan/:taskId', async (req, res) => {
    const { id, taskId } = req.params;

    try {
        const { data: task, error: taskError } = await supabaseAdmin
            .from('tasks')
            .select('id, type, created_by')
            .eq('id', taskId)
            .maybeSingle();

        if (taskError) {
            return res.status(500).json({ error: taskError.message });
        }
        if (!task) {
            return res.status(404).json({ error: '任务不存在' });
        }

        // Personal tasks owned by student: hard delete task
        if (task.type === 'personal' && task.created_by === id) {
            await supabaseAdmin
                .from('student_tasks')
                .delete()
                .eq('student_id', id)
                .eq('task_id', taskId);

            const { error: deleteTaskError } = await supabaseAdmin
                .from('tasks')
                .delete()
                .eq('id', taskId)
                .eq('created_by', id);

            if (deleteTaskError) {
                return res.status(500).json({ error: deleteTaskError.message });
            }

            invalidateStudentCaches(id);
            invalidateTeacherCaches();
            return res.json({ success: true, mode: 'deleted' });
        }

        // Shared tasks: mark as removed for current student only
        const { data: existingRows, error: findError } = await supabaseAdmin
            .from('student_tasks')
            .select('id')
            .eq('student_id', id)
            .eq('task_id', taskId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (findError) {
            return res.status(500).json({ error: findError.message });
        }

        const existing = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;
        if (existing) {
            const { error: updateError } = await supabaseAdmin
                .from('student_tasks')
                .update({ status: 'removed', completed_at: null })
                .eq('id', existing.id);

            if (updateError) {
                return res.status(500).json({ error: updateError.message });
            }
        } else {
            const { error: insertError } = await supabaseAdmin
                .from('student_tasks')
                .insert([{ student_id: id, task_id: taskId, status: 'removed' }]);

            if (insertError) {
                return res.status(500).json({ error: insertError.message });
            }
        }

        invalidateStudentCaches(id);
        invalidateTeacherCaches();
        res.json({ success: true, mode: 'removed' });
    } catch (error) {
        console.error('Delete today plan task error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 5.1 Complete one student task
app.post('/api/student/:id/tasks/:taskId/complete', async (req, res) => {
    const { id, taskId } = req.params;

    try {
        const { data: existingRows, error: findError } = await supabaseAdmin
            .from('student_tasks')
            .select('id, status')
            .eq('student_id', id)
            .eq('task_id', taskId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (findError) {
            return res.status(500).json({ error: findError.message });
        }

        const now = new Date().toISOString();
        const existing = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;

        let data;
        let error;

        if (existing) {
            ({ data, error } = await supabaseAdmin
                .from('student_tasks')
                .update({ status: 'completed', completed_at: now })
                .eq('id', existing.id)
                .select()
                .single());
        } else {
            ({ data, error } = await supabaseAdmin
                .from('student_tasks')
                .insert([{ student_id: id, task_id: taskId, status: 'completed', completed_at: now }])
                .select()
                .single());
        }

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateStudentCaches(id);
        invalidateTeacherCaches();
        res.json({ success: true, data });
    } catch (error) {
        console.error('Complete student task error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 5.1.1 Complete one student task with evidence for teacher review
app.post('/api/student/:id/tasks/:taskId/complete-with-evidence', async (req, res) => {
    const { id } = req.params;
    res.on('finish', () => {
        if (res.statusCode < 400) {
            invalidateStudentCaches(id);
            invalidateStudentAiCaches(id);
            invalidateTeacherCaches();
        }
    });
    return studentController.completeTaskWithEvidence(req, res);
});

// 5.2 Reopen one student task (undo completion)
app.post('/api/student/:id/tasks/:taskId/reopen', async (req, res) => {
    const { id, taskId } = req.params;

    try {
        const { data: existingRows, error: findError } = await supabaseAdmin
            .from('student_tasks')
            .select('id, status')
            .eq('student_id', id)
            .eq('task_id', taskId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (findError) {
            return res.status(500).json({ error: findError.message });
        }

        const existing = Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;
        if (!existing) {
            return res.status(404).json({ error: '任务记录不存在' });
        }

        const { data, error } = await supabaseAdmin
            .from('student_tasks')
            .update({ status: 'active', completed_at: null })
            .eq('id', existing.id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateStudentCaches(id);
        invalidateTeacherCaches();
        res.json({ success: true, data });
    } catch (error) {
        console.error('Reopen student task error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 6. Get All Submissions (Teacher View)
app.get('/api/submissions', requireAuth, (req, res) => teacherController.getSubmissions(req, res));
app.post('/api/submissions/:submissionId/review', requireAuth, (req, res) => teacherController.reviewSubmission(req, res));
app.post('/api/submissions/review-batch', requireAuth, (req, res) => teacherController.reviewSubmissionsBatch(req, res));

// 6.1 Get Students List (for teacher dashboard)
app.get('/api/students', requireAuth, (req, res) => teacherController.getStudents(req, res));

// 6.5 Get Student Badges List
app.get('/api/student/:id/badges', (req, res) => studentController.getBadges(req, res));

// 6.6 Get Student Sticker Board (all badges + unlock status)
app.get('/api/student/:id/sticker-board', (req, res) => studentController.getStickerBoard(req, res));

// 7. Get Portfolio Stats (Radar Chart Data & Badges)
app.get('/api/student/:id/stats', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `stats::${id}`;
    const cached = getCachedApiValue(cacheKey, API_CACHE_TTL_MS.stats);
    if (cached) return res.json(cached);

    const [badgeResult, taskResult, checkinStatus, moodStatsResult] = await Promise.all([
        supabaseAdmin
            .from('student_badges')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', id),
        supabaseAdmin
            .from('student_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', id)
            .eq('status', 'completed'),
        getCheckinStatus(id),
        supabaseAdmin
            .from('student_moods')
            .select('note')
            .eq('student_id', id)
            .eq('mood', 'radar_stats')
            .order('created_at', { ascending: false })
            .limit(1)
    ]);

    if (badgeResult.error) {
        console.error('Error fetching badge count:', badgeResult.error);
        if (badgeResult.error.code !== '42P01') {
            return res.status(500).json({ error: badgeResult.error.message });
        }
    }
    if (taskResult.error) {
        console.error('Error fetching completed task count:', taskResult.error);
        if (taskResult.error.code !== '42P01') {
            return res.status(500).json({ error: taskResult.error.message });
        }
    }
    if (moodStatsResult.error) {
        console.error('Error fetching radar stats:', moodStatsResult.error);
    }

    const badgeCount = badgeResult.count || 0;
    const taskCount = taskResult.count || 0;

    let streak = checkinStatus.streak;
    if (streak === 0) {
        streak = await getTaskBasedStreak(id);
    }

    let radarData = [80, 80, 80, 80, 80];
    const moodStats = moodStatsResult.data || [];
    if (moodStats && moodStats.length > 0 && moodStats[0].note) {
        try {
            radarData = JSON.parse(moodStats[0].note);
        } catch (e) {
            console.error('Failed to parse radar stats', e);
        }
    }

    const result = {
        badges: badgeCount || 0,
        completed_tasks: taskCount || 0,
        radar: radarData,
        streak: streak,
        checked_in_today: checkinStatus.checkedInToday
    };

    const levelProgress = calculateLevelProgress({
        completedTasks: result.completed_tasks,
        badges: result.badges,
        streak: result.streak
    });

    Object.assign(result, levelProgress);

    setCachedApiValue(cacheKey, result);
    res.json(result);
});

// 7.4 Growth Stats (growth page overview, charts, timeline)
app.get('/api/student/:id/growth-stats', studentController.getGrowthStats);

// 7.5 Growth Chart Data (multi-dimension weekly trends + current snapshot)
app.get('/api/student/:id/growth-chart', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `growth_chart::${id}`;
    const cached = getCachedApiValue(cacheKey, 30 * 1000); // 30s cache
    if (cached) return res.json(cached);

    const weeksCount = 6;
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
    weekBoundaries.reverse(); // oldest first

    const sixWeeksAgo = weekBoundaries[0].start.toISOString();

    try {
        const [tasksRes, moodsRes, momentsRes, badgesRes, goalsRes] = await Promise.all([
            supabaseAdmin
                .from('student_tasks')
                .select('status, completed_at, created_at')
                .eq('student_id', id)
                .gte('created_at', sixWeeksAgo),
            supabaseAdmin
                .from('student_moods')
                .select('mood, created_at')
                .eq('student_id', id)
                .neq('mood', 'radar_stats')
                .gte('created_at', sixWeeksAgo),
            supabaseAdmin
                .from('class_moments')
                .select('id, created_at')
                .eq('student_id', id)
                .gte('created_at', sixWeeksAgo),
            supabaseAdmin
                .from('student_badges')
                .select('awarded_at')
                .eq('student_id', id)
                .gte('awarded_at', sixWeeksAgo),
            supabaseAdmin
                .from('student_goals')
                .select('status, created_at, completed_at')
                .eq('student_id', id)
                .gte('created_at', sixWeeksAgo)
        ]);

        const tasks = tasksRes.data || [];
        const moods = moodsRes.data || [];
        const moments = momentsRes.data || [];
        const badges = badgesRes.data || [];
        const goals = goalsRes.data || [];

        const inWeek = (dateStr, week) => {
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return d >= week.start && d <= week.end;
        };

        const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

        const calcWeekScores = (week) => {
            // 乐观: happy mood ratio
            const weekMoods = moods.filter(m => inWeek(m.created_at, week));
            const moodPositivityTotal = weekMoods.reduce((sum, item) => sum + getMoodPositivityScore(item.mood), 0);
            const totalMoods = weekMoods.length;
            const optimism = totalMoods > 0
                ? clamp((moodPositivityTotal / totalMoods) * 100 + totalMoods * 5)
                : 0;

            // 坚毅: task completion rate + consecutive days
            const weekTasks = tasks.filter(t => inWeek(t.created_at, week));
            const completedTasks = weekTasks.filter(t => t.status === 'completed');
            const grit = weekTasks.length > 0
                ? clamp((completedTasks.length / weekTasks.length) * 80 + completedTasks.length * 5)
                : 0;

            // 创造: goals created + task variety
            const weekGoals = goals.filter(g => inWeek(g.created_at, week));
            const creativity = clamp(weekGoals.length * 20 + completedTasks.length * 10);

            // 社交: moments posted
            const weekMoments = moments.filter(m => inWeek(m.created_at, week));
            const social = clamp(weekMoments.length * 25);

            // 成就: badges earned + goals completed
            const weekBadges = badges.filter(b => inWeek(b.awarded_at, week));
            const weekGoalsCompleted = goals.filter(g => g.status === 'completed' && inWeek(g.completed_at || g.created_at, week));
            const achievement = clamp(weekBadges.length * 30 + weekGoalsCompleted.length * 20 + completedTasks.length * 5);

            return { optimism, grit, creativity, social, achievement };
        };

        const formatWeek = (week) => {
            const s = week.start;
            const e = week.end;
            return `${s.getMonth() + 1}/${s.getDate()}-${e.getMonth() + 1}/${e.getDate()}`;
        };

        const weekly = weekBoundaries.map(week => ({
            week: formatWeek(week),
            ...calcWeekScores(week)
        }));

        // Generate daily data from the last 14 days
        const daysCount = 14;
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

        const inDay = (dateStr, day) => {
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return d >= day.start && d <= day.end;
        };

        const calcDayScores = (day) => {
            const dayMoods = moods.filter(m => inDay(m.created_at, day));
            const moodPositivityTotal = dayMoods.reduce((sum, item) => sum + getMoodPositivityScore(item.mood), 0);
            const totalMoods = dayMoods.length;
            const optimism = totalMoods > 0
                ? clamp((moodPositivityTotal / totalMoods) * 100 + totalMoods * 10)
                : 0;

            const dayTasks = tasks.filter(t => inDay(t.created_at, day));
            const completedTasks = dayTasks.filter(t => t.status === 'completed');
            const grit = dayTasks.length > 0
                ? clamp((completedTasks.length / dayTasks.length) * 80 + completedTasks.length * 10)
                : 0;

            const dayGoals = goals.filter(g => inDay(g.created_at, day));
            const creativity = clamp(dayGoals.length * 20 + completedTasks.length * 10);

            const dayMoments = moments.filter(m => inDay(m.created_at, day));
            const social = clamp(dayMoments.length * 25);

            const dayBadges = badges.filter(b => inDay(b.awarded_at, day));
            const dayGoalsCompleted = goals.filter(g => g.status === 'completed' && inDay(g.completed_at || g.created_at, day));
            const achievement = clamp(dayBadges.length * 30 + dayGoalsCompleted.length * 20 + completedTasks.length * 5);

            return { optimism, grit, creativity, social, achievement };
        };

        const formatDay = (day) => `${day.start.getMonth() + 1}/${day.start.getDate()}`;

        const daily = dayBoundaries.map(day => ({
            label: formatDay(day),
            ...calcDayScores(day)
        }));

        // Current snapshot = latest week scores, but with minimum base of 10
        const latest = weekly[weekly.length - 1];
        const current = {
            optimism: Math.max(10, latest.optimism),
            grit: Math.max(10, latest.grit),
            creativity: Math.max(10, latest.creativity),
            social: Math.max(10, latest.social),
            achievement: Math.max(10, latest.achievement)
        };

        const result = { current, weekly, daily };
        setCachedApiValue(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Growth chart error:', error);
        // Return safe fallback
        const fallbackWeekly = Array.from({ length: weeksCount }, (_, i) => ({
            week: `W${i + 1}`,
            optimism: 10, grit: 10, creativity: 10, social: 10, achievement: 10
        }));
        res.json({
            current: { optimism: 10, grit: 10, creativity: 10, social: 10, achievement: 10 },
            weekly: fallbackWeekly
        });
    }
});

// 8. Get Student Goals
app.get('/api/student/:id/goals', async (req, res) => {
    const { id } = req.params;
    const dreamTag = String(req.query.dream_tag || '').trim();

    let query = supabaseAdmin
        .from('student_goals')
        .select('*')
        .eq('student_id', id);

    if (dreamTag) {
        query = query.eq('dream_tag', dreamTag);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching goals:', error);
        if (error.code === '42P01') return res.json([]);
        return res.status(500).json({ error: error.message });
    }

    res.json(data);
});

// 8.1 Create Student Goal (关联到梦想)
app.post('/api/student/:id/goals', async (req, res) => {
    const { id } = req.params;
    const { title, description, target_date, dream_id, dream_tag } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Missing goal title' });
    }

    // If dream_tag is provided but dream_id is not, lookup the dream_id
    let resolvedDreamId = dream_id || null;
    if (!resolvedDreamId && dream_tag) {
        try {
            const { data: dreamData, error: dreamError } = await supabaseAdmin
                .from('student_dreams')
                .select('id')
                .eq('student_id', id)
                .ilike('title', dream_tag.trim())
                .eq('dream_status', 'active')
                .limit(1)
                .single();

            if (!dreamError && dreamData) {
                resolvedDreamId = dreamData.id;
            }
        } catch (lookupErr) {
            console.log('Dream lookup by tag failed:', lookupErr.message);
        }
    }

    const payload = {
        student_id: id,
        title: title.trim(),
        description: description ? description.trim() : null,
        target_date: target_date || null,
        dream_id: resolvedDreamId,  // 关联到梦想
        dream_tag: dream_tag ? dream_tag.trim() : null,
        goal_status: 'active',
        progress: 0
    };

    const { data, error } = await supabaseAdmin
        .from('student_goals')
        .insert([payload])
        .select()
        .single();

    if (error) {
        console.error('Error creating goal:', error);
        if (error.code === '42P01') {
            return res.status(500).json({ error: 'student_goals table not found' });
        }
        // If dream_id column doesn't exist, try without it
        if (error.message && error.message.includes('dream_id')) {
            delete payload.dream_id;
            delete payload.goal_status;
            delete payload.progress;
            payload.status = 'active';

            const { data: fallbackData, error: fallbackError } = await supabaseAdmin
                .from('student_goals')
                .insert([payload])
                .select()
                .single();

            if (fallbackError) {
                return res.status(500).json({ error: fallbackError.message });
            }
            invalidateStudentAiCaches(id);
            return res.status(201).json(fallbackData);
        }
        return res.status(500).json({ error: error.message });
    }

    invalidateStudentAiCaches(id);
    res.status(201).json(data);
});

// 8.1.1 Update Student Goal
app.patch('/api/student/:id/goals/:goalId', async (req, res) => {
    const { id, goalId } = req.params;
    const { title, description, target_date, status, goal_status, dream_tag, dream_id } = req.body;

    const updatePayload = {};
    if (typeof title === 'string') updatePayload.title = title.trim();
    if (typeof description === 'string') updatePayload.description = description.trim() || null;
    if (target_date !== undefined) updatePayload.target_date = target_date || null;
    if (typeof dream_tag === 'string') updatePayload.dream_tag = dream_tag.trim() || null;
    if (dream_id !== undefined) updatePayload.dream_id = dream_id || null;

    // Support both 'status' (legacy) and 'goal_status' (new)
    const newStatus = status || goal_status;
    if (newStatus) {
        updatePayload.goal_status = newStatus;
        updatePayload.status = newStatus; // For backward compatibility

        if (newStatus === 'completed') {
            updatePayload.completed_at = new Date().toISOString();
            updatePayload.progress = 100;
        }
        if (newStatus === 'active') {
            updatePayload.completed_at = null;
            updatePayload.progress = 0;
        }
    }

    if (Object.keys(updatePayload).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabaseAdmin
        .from('student_goals')
        .update(updatePayload)
        .eq('id', goalId)
        .eq('student_id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating goal:', error);
        if (error.code === '42P01') {
            return res.status(500).json({ error: 'student_goals table not found' });
        }
        return res.status(500).json({ error: error.message });
    }

    invalidateStudentAiCaches(id);
    res.json(data);
});

// 8.1.2 Submit goal with evidence for teacher review
app.post('/api/student/:id/goals/:goalId/submit', async (req, res) => {
    const { id } = req.params;
    res.on('finish', () => {
        if (res.statusCode < 400) {
            invalidateStudentCaches(id);
            invalidateStudentAiCaches(id);
            invalidateTeacherCaches();
        }
    });
    return studentController.submitGoalWithEvidence(req, res);
});

// 8.1.2 Delete Student Goal
app.delete('/api/student/:id/goals/:goalId', async (req, res) => {
    const { id, goalId } = req.params;

    const { error } = await supabaseAdmin
        .from('student_goals')
        .delete()
        .eq('id', goalId)
        .eq('student_id', id);

    if (error) {
        console.error('Error deleting goal:', error);
        if (error.code === '42P01') {
            return res.status(500).json({ error: 'student_goals table not found' });
        }
        return res.status(500).json({ error: error.message });
    }

    invalidateStudentAiCaches(id);
    res.json({ success: true });
});

// 8.1.4 Multi-Dream Management Routes
// Get dreams overview with statistics and resource allocation
// Dreams = 长期愿景 (student_dreams), Goals = 具体目标 (student_goals)
app.get('/api/student/:id/dreams/overview', async (req, res) => {
    const { id } = req.params;
    try {
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('dream, dreams')
            .eq('id', id)
            .single();
        const profileDreams = normalizeDreamList(profile?.dream, profile?.dreams);
        // Fetch from student_dreams table (梦想表)
        const { data: dreamsData, error: dreamsError } = await supabaseAdmin
            .from('student_dreams')
            .select('*')
            .eq('student_id', id)
            .order('priority', { ascending: true })
            .order('created_at', { ascending: false });

        // If student_dreams table doesn't exist, fall back to profile.dream
        if (dreamsError && dreamsError.message && dreamsError.message.includes('student_dreams')) {
            console.log('student_dreams table not found, falling back to profile data...');

            // Get dreams from profile
            const { data: profile, error: profileError } = await supabaseAdmin
                .from('profiles')
                .select('dream')
                .eq('id', id)
                .single();

            if (profileError) {
                return res.status(500).json({ error: profileError.message });
            }

            // Parse dreams from profile
            const dreamText = profile?.dream || '';
            const dreamList = dreamText
                .split(/\r?\n|[，。、；;]+/)
                .map(item => item.trim())
                .filter(Boolean)
                .slice(0, 8);

            let goalRows = [];
            let goalsError = null;

            const goalsPrimaryResult = await supabaseAdmin
                .from('student_goals')
                .select('dream_tag, status')
                .eq('student_id', id);
            goalRows = goalsPrimaryResult.data || [];
            goalsError = goalsPrimaryResult.error;

            if (goalsError && String(goalsError.code || '') === '42703') {
                const goalsFallbackResult = await supabaseAdmin
                    .from('student_goals')
                    .select('dream_tag, goal_status')
                    .eq('student_id', id);
                goalRows = goalsFallbackResult.data || [];
                goalsError = goalsFallbackResult.error;
            }

            const dreams = dreamList.map((title, index) => {
                const matchedGoals = !goalsError
                    ? goalRows.filter((goal) => String(goal?.dream_tag || '').trim() === title)
                    : [];
                const completedCount = matchedGoals.filter((goal) => String(goal?.status || goal?.goal_status || '').toLowerCase() === 'completed').length;

                return {
                    id: `dream-${index}`,
                    tag: title,
                    title: title,
                    status: 'active',
                    progress: 0,
                    priority: index === 0 ? 1 : 2,
                    is_focused: index === 0,
                    weekly_hours: 0,
                    completed_tasks: completedCount,
                    total_tasks: matchedGoals.length,
                    goal_count: matchedGoals.length,
                    completed_goal_count: completedCount
                };
            });

            return res.json({
                total_dreams: dreams.length,
                active_count: dreams.length,
                completed_count: 0,
                paused_count: 0,
                dreams,
                resource_allocation: {
                    total_weekly_hours: 0,
                    by_dream: {}
                },
                _fallback: true
            });
        }

        if (dreamsError) {
            console.error('Error fetching dreams:', dreamsError);
            return res.status(500).json({ error: dreamsError.message });
        }

        // Get goal counts for each dream
        let goalCounts = {};

        if ((dreamsData || []).length > 0) {
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

            if (!goalsError && goalsData) {
                (dreamsData || []).forEach((dream) => {
                    const dreamId = String(dream?.id || '').trim();
                    const dreamTitle = String(dream?.title || '').trim();
                    const dreamGoals = goalsData.filter((g) => {
                        const goalDreamId = String(g?.dream_id || '').trim();
                        const goalDreamTag = String(g?.dream_tag || '').trim();
                        return (dreamId && goalDreamId && goalDreamId === dreamId)
                            || (dreamTitle && goalDreamTag === dreamTitle);
                    });

                    goalCounts[dreamId] = {
                        total: dreamGoals.length,
                        completed: dreamGoals.filter(g => String(g?.status || g?.goal_status || '').toLowerCase() === 'completed').length
                    };
                });
            }
        }

        // Format dreams data
        const dreams = (dreamsData || []).map(dream => {
            const counts = goalCounts[dream.id] || { total: 0, completed: 0 };
            return {
                id: dream.id,
                tag: dream.title,
                title: dream.title,
                description: dream.description,
                status: dream.dream_status || 'active',
                progress: dream.progress || 0,
                priority: dream.priority || 2,
                is_focused: dream.is_focused || false,
                weekly_hours: dream.weekly_hours || 0,
                completed_tasks: counts.completed,
                total_tasks: counts.total,
                goal_count: counts.total,
                completed_goal_count: counts.completed,
                created_at: dream.created_at,
                completed_at: dream.completed_at
            };
        });

        const active_count = dreams.filter(d => d.status === 'active').length;
        const completed_count = dreams.filter(d => d.status === 'completed').length;
        const paused_count = dreams.filter(d => d.status === 'paused').length;

        // Calculate resource allocation
        const activeDreams = dreams.filter(d => d.status === 'active');
        const total_weekly_hours = activeDreams.reduce((sum, d) => sum + d.weekly_hours, 0);

        const by_dream = {};
        activeDreams.forEach(d => {
            by_dream[d.tag] = d.weekly_hours;
        });

        const result = {
            total_dreams: dreams.length,
            active_count,
            completed_count,
            paused_count,
            dreams,
            resource_allocation: {
                total_weekly_hours,
                by_dream
            }
        };

        res.json(result);
    } catch (error) {
        console.error('Get dreams overview error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Set focused dream
app.post('/api/student/:id/dreams/focus', async (req, res) => {
    const { id } = req.params;
    const { dream_id } = req.body;

    if (!dream_id) {
        return res.status(400).json({ error: 'dream_id is required' });
    }

    try {
        // First, unfocus all dreams for this student
        await supabaseAdmin
            .from('student_dreams')
            .update({ is_focused: false })
            .eq('student_id', id);

        // Then set the selected dream as focused
        const { data, error } = await supabaseAdmin
            .from('student_dreams')
            .update({ is_focused: true, updated_at: new Date().toISOString() })
            .eq('id', dream_id)
            .eq('student_id', id)
            .select()
            .single();

        if (error) {
            if (error.message && error.message.includes('student_dreams')) {
                return res.status(500).json({
                    error: 'student_dreams table not found. Please run the database migration first.'
                });
            }
            return res.status(500).json({ error: error.message });
        }

        res.json({ message: 'Focus dream updated', dream: data });
    } catch (error) {
        console.error('Set focused dream error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update dream status (active/paused/completed)
app.patch('/api/student/:id/dreams/:dreamId/status', async (req, res) => {
    const { id, dreamId } = req.params;
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
            .from('student_dreams')
            .update(updates)
            .eq('id', dreamId)
            .eq('student_id', id)
            .select()
            .single();

        if (error) {
            if (error.message && error.message.includes('student_dreams')) {
                return res.status(500).json({
                    error: 'student_dreams table not found. Please run the database migration first.'
                });
            }
            return res.status(500).json({ error: error.message });
        }

        res.json({ message: 'Dream status updated', dream: data });
    } catch (error) {
        console.error('Update dream status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update dream allocation (priority and weekly hours)
app.patch('/api/student/:id/dreams/:dreamId/allocation', async (req, res) => {
    const { id, dreamId } = req.params;
    const { priority, weekly_hours } = req.body;

    try {
        const updates = {
            updated_at: new Date().toISOString()
        };

        if (priority !== undefined) {
            const priorityNum = parseInt(priority, 10);
            if (isNaN(priorityNum) || priorityNum < 1 || priorityNum > 3) {
                return res.status(400).json({ error: 'priority must be between 1 and 3' });
            }
            updates.priority = priorityNum;
        }

        if (weekly_hours !== undefined) {
            const hoursNum = parseInt(weekly_hours, 10);
            if (isNaN(hoursNum) || hoursNum < 0 || hoursNum > 40) {
                return res.status(400).json({ error: 'weekly_hours must be between 0 and 40' });
            }
            updates.weekly_hours = hoursNum;
        }

        const { data, error } = await supabaseAdmin
            .from('student_dreams')
            .update(updates)
            .eq('id', dreamId)
            .eq('student_id', id)
            .select()
            .single();

        if (error) {
            if (error.message && error.message.includes('student_dreams')) {
                return res.status(500).json({
                    error: 'student_dreams table not found. Please run the database migration first.'
                });
            }
            return res.status(500).json({ error: error.message });
        }

        res.json({ message: 'Dream allocation updated', dream: data });
    } catch (error) {
        console.error('Update dream allocation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create new dream
app.post('/api/student/:id/dreams', async (req, res) => {
    const { id } = req.params;
    const { title, description, priority = 2 } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Dream title is required' });
    }

    try {
        // Check active dream limit
        const { data: activeDreams, error: countError } = await supabaseAdmin
            .from('student_dreams')
            .select('id')
            .eq('student_id', id)
            .eq('dream_status', 'active');

        if (!countError && activeDreams && activeDreams.length >= 3) {
            return res.status(400).json({
                error: '最多只能同时激活3个期待。请先暂停或完成一个现有期待。'
            });
        }

        const { data, error } = await supabaseAdmin
            .from('student_dreams')
            .insert([{
                student_id: id,
                title: title.trim(),
                description: description || null,
                priority: parseInt(priority, 10) || 2,
                dream_status: 'active',
                is_focused: false,
                weekly_hours: 0,
                progress: 0
            }])
            .select()
            .single();

        if (error) {
            if (error.message && error.message.includes('student_dreams')) {
                return res.status(500).json({
                    error: 'student_dreams table not found. Please run the database migration first.'
                });
            }
            return res.status(500).json({ error: error.message });
        }

        res.json({ message: 'Dream created', dream: data });
    } catch (error) {
        console.error('Create dream error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete dream
app.delete('/api/student/:id/dreams/:dreamId', async (req, res) => {
    const { id, dreamId } = req.params;

    try {
        // First, delete all associated goals or update them
        await supabaseAdmin
            .from('student_goals')
            .update({ dream_id: null })
            .eq('dream_id', dreamId)
            .eq('student_id', id);

        const { error } = await supabaseAdmin
            .from('student_dreams')
            .delete()
            .eq('id', dreamId)
            .eq('student_id', id);

        if (error) {
            if (error.message && error.message.includes('student_dreams')) {
                return res.status(500).json({
                    error: 'student_dreams table not found. Please run the database migration first.'
                });
            }
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, message: 'Dream deleted' });
    } catch (error) {
        console.error('Delete dream error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get goals for a specific dream
app.get('/api/student/:id/dreams/:dreamId/goals', async (req, res) => {
    const { id, dreamId } = req.params;

    try {
        const { data, error } = await supabaseAdmin
            .from('student_goals')
            .select('*')
            .eq('student_id', id)
            .eq('dream_id', dreamId)
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json(data || []);
    } catch (error) {
        console.error('Get dream goals error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8.1.5 Get Student Obstacles (Dream Blockers)
app.get('/api/student/:id/obstacles', async (req, res) => {
    const { id } = req.params;
    const dreamFocus = String(req.query.dream_focus || '').trim();
    const status = normalizeObstacleStatus(req.query.status);
    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);

    try {
        let query = supabaseAdmin
            .from('student_obstacles')
            .select('*')
            .eq('student_id', id);

        if (dreamFocus) query = query.eq('dream_tag', dreamFocus);
        if (status) query = query.eq('status', status);

        const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            if (error.code === '42P01') return res.json([]);
            return res.status(500).json({ error: error.message });
        }

        res.json(data || []);
    } catch (error) {
        console.error('Get obstacles error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8.1.4 Create Student Obstacle
app.post('/api/student/:id/obstacles', async (req, res) => {
    const { id } = req.params;
    const { dream_tag, obstacle_type, content, severity } = req.body || {};

    const safeContent = String(content || '').trim();
    const safeDreamTag = String(dream_tag || '').trim();
    const safeSeverity = Math.min(5, Math.max(1, Number.parseInt(severity, 10) || 3));
    const safeType = normalizeObstacleType(obstacle_type);

    if (!safeContent) {
        return res.status(400).json({ error: '请填写阻碍描述' });
    }
    if (safeContent.length > 200) {
        return res.status(400).json({ error: '阻碍描述不能超过 200 字' });
    }

    try {
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('dream')
            .eq('id', id)
            .single();

        if (profileError) {
            return res.status(500).json({ error: profileError.message });
        }

        const { dreams, primaryDream } = buildDreamContext(profile || {});
        if (!dreams.length) {
            return res.status(400).json({ error: '请先在个人信息中填写期待' });
        }

        const effectiveDreamTag = safeDreamTag || primaryDream;
        if (!effectiveDreamTag || !dreams.includes(effectiveDreamTag)) {
            return res.status(400).json({ error: '阻碍必须关联到你的某个期待' });
        }

        const { data: duplicateRows } = await supabaseAdmin
            .from('student_obstacles')
            .select('id, created_at')
            .eq('student_id', id)
            .eq('dream_tag', effectiveDreamTag)
            .eq('content', safeContent)
            .order('created_at', { ascending: false })
            .limit(1);

        const latestDuplicate = Array.isArray(duplicateRows) && duplicateRows.length > 0 ? duplicateRows[0] : null;
        if (latestDuplicate) {
            const diffHours = (Date.now() - new Date(latestDuplicate.created_at).getTime()) / (1000 * 60 * 60);
            if (diffHours <= 24) {
                return res.status(409).json({ error: '24小时内你已记录过相同阻碍，试试更新状态吧' });
            }
        }

        const { data, error } = await supabaseAdmin
            .from('student_obstacles')
            .insert([{
                student_id: id,
                dream_tag: effectiveDreamTag,
                obstacle_type: safeType,
                content: safeContent,
                severity: safeSeverity,
                status: 'todo'
            }])
            .select('*')
            .single();

        if (error) {
            if (error.code === '42P01') {
                return res.status(500).json({ error: 'student_obstacles table not found' });
            }
            return res.status(500).json({ error: error.message });
        }

        invalidateStudentAiCaches(id);
        res.status(201).json(data);
    } catch (error) {
        console.error('Create obstacle error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8.1.5 Update Student Obstacle
app.patch('/api/student/:id/obstacles/:obstacleId', async (req, res) => {
    const { id, obstacleId } = req.params;
    const { status, severity, content } = req.body || {};

    const updatePayload = {
        updated_at: new Date().toISOString()
    };

    if (status !== undefined) {
        const normalizedStatus = normalizeObstacleStatus(status);
        if (!normalizedStatus) {
            return res.status(400).json({ error: '状态不合法' });
        }
        updatePayload.status = normalizedStatus;
    }

    if (severity !== undefined) {
        const safeSeverity = Math.min(5, Math.max(1, Number.parseInt(severity, 10) || 3));
        updatePayload.severity = safeSeverity;
    }

    if (typeof content === 'string') {
        const safeContent = content.trim();
        if (!safeContent) {
            return res.status(400).json({ error: '阻碍描述不能为空' });
        }
        if (safeContent.length > 200) {
            return res.status(400).json({ error: '阻碍描述不能超过 200 字' });
        }
        updatePayload.content = safeContent;
    }

    if (Object.keys(updatePayload).length <= 1) {
        return res.status(400).json({ error: '没有可更新字段' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('student_obstacles')
            .update(updatePayload)
            .eq('id', obstacleId)
            .eq('student_id', id)
            .select('*')
            .single();

        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: '阻碍记录不存在' });
            return res.status(500).json({ error: error.message });
        }

        invalidateStudentAiCaches(id);
        res.json(data);
    } catch (error) {
        console.error('Update obstacle error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8.1.6 Delete Student Obstacle
app.delete('/api/student/:id/obstacles/:obstacleId', async (req, res) => {
    const { id, obstacleId } = req.params;

    try {
        const { error } = await supabaseAdmin
            .from('student_obstacles')
            .delete()
            .eq('id', obstacleId)
            .eq('student_id', id);

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        invalidateStudentAiCaches(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete obstacle error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8.1.7 Create today-plan task from obstacle
app.post('/api/student/:id/obstacles/:obstacleId/create-task', async (req, res) => {
    const { id, obstacleId } = req.params;
    const { title, description } = req.body || {};

    try {
        const { data: obstacle, error: obstacleError } = await supabaseAdmin
            .from('student_obstacles')
            .select('id, content, dream_tag, status')
            .eq('id', obstacleId)
            .eq('student_id', id)
            .single();

        if (obstacleError) {
            if (obstacleError.code === 'PGRST116') return res.status(404).json({ error: '阻碍记录不存在' });
            return res.status(500).json({ error: obstacleError.message });
        }

        const safeTitle = String(title || '').trim() || `突破阻碍：${String(obstacle.content || '').slice(0, 16)}`;
        const safeDescription = String(description || '').trim() || `围绕“${obstacle.dream_tag || '当前期待'}”解决阻碍：${obstacle.content}`;

        const { data: task, error: taskError } = await supabaseAdmin
            .from('tasks')
            .insert([{
                title: safeTitle,
                description: safeDescription,
                type: 'personal',
                points_reward: 5,
                created_by: id
            }])
            .select('id, title, description, points_reward, created_at')
            .single();

        if (taskError) {
            return res.status(500).json({ error: taskError.message });
        }

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
        console.error('Create obstacle task error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8.1.8 Get AI suggestion for current obstacle
app.get('/api/student/:id/obstacles/suggestion', async (req, res) => {
    const { id } = req.params;
    const dreamFocus = String(req.query.dream_focus || '').trim();

    try {
        const [{ data: profile }, { data: obstacleRows, error: obstacleError }] = await Promise.all([
            supabaseAdmin
                .from('profiles')
                .select('full_name, dream')
                .eq('id', id)
                .single(),
            supabaseAdmin
                .from('student_obstacles')
                .select('id, dream_tag, obstacle_type, content, severity, status, updated_at, created_at')
                .eq('student_id', id)
                .in('status', ['todo', 'in_progress'])
                .order('severity', { ascending: false })
                .order('updated_at', { ascending: false })
                .limit(20)
        ]);

        if (obstacleError) {
            if (obstacleError.code === '42P01') {
                return res.json({
                    suggestion: '先写下一条你今天最想突破的小阻碍吧。',
                    obstacle: null
                });
            }
            return res.status(500).json({ error: obstacleError.message });
        }

        const { dreams } = buildDreamContext(profile || {});
        const scopedRows = (obstacleRows || []).filter((row) => {
            if (!dreamFocus) return true;
            if (!dreams.includes(dreamFocus)) return false;
            return row.dream_tag === dreamFocus;
        });

        const obstacle = scopedRows[0] || null;
        if (!obstacle) {
            return res.json({
                suggestion: dreamFocus
                    ? `围绕“${dreamFocus}”写下一个当前阻碍，AI会给你小建议。`
                    : '先写下一条你今天最想突破的小阻碍吧。',
                obstacle: null
            });
        }

        const safeName = profile?.full_name || '同学';
        const safeDream = obstacle.dream_tag || dreamFocus || dreams[0] || '你的期待';
        const fallbackSuggestion = getObstacleFallbackSuggestion({
            studentName: safeName,
            dream: safeDream,
            obstacleType: obstacle.obstacle_type,
            content: obstacle.content
        });

        if (!ecnuApiKey) {
            return res.json({ suggestion: fallbackSuggestion, obstacle });
        }

        try {
            const response = await fetch('https://chat.ecnu.edu.cn/open/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${ecnuApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'ecnu-max',
                    messages: [
                        {
                            role: 'system',
                            content: '你是小学成长导师。请根据学生阻碍给出1-2句温暖、可执行、不过度说教的建议。不要使用列表。'
                        },
                        {
                            role: 'user',
                            content: `学生：${safeName}\n期待：${safeDream}\n阻碍类型：${obstacle.obstacle_type}\n阻碍描述：${obstacle.content}\n严重度：${obstacle.severity}/5\n请给出简短建议。`
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 120
                })
            });

            if (!response.ok) throw new Error('Obstacle suggestion API error');

            const data = await response.json();
            const content = String(data?.choices?.[0]?.message?.content || '').trim();
            const suggestion = content || fallbackSuggestion;

            res.json({ suggestion, obstacle });
        } catch (aiError) {
            console.error('Obstacle suggestion AI error:', aiError);
            res.json({ suggestion: fallbackSuggestion, obstacle });
        }
    } catch (error) {
        console.error('Obstacle suggestion error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 8.1.9 Time Tracking APIs (Goal Time Logs)
// ============================================

// Get time logs for a student (with optional date range)
app.get('/api/student/:id/time-logs', async (req, res) => {
    const { id } = req.params;
    const { goal_id, dream_id, start_date, end_date, limit = 50 } = req.query;

    try {
        let query = supabaseAdmin
            .from('goal_time_logs')
            .select(`
                *,
                goal:goal_id (title),
                dream:dream_id (title)
            `)
            .eq('student_id', id)
            .order('created_at', { ascending: false })
            .limit(parseInt(limit, 10));

        if (goal_id) query = query.eq('goal_id', goal_id);
        if (dream_id) query = query.eq('dream_id', dream_id);
        if (start_date) query = query.gte('log_date', start_date);
        if (end_date) query = query.lte('log_date', end_date);

        const { data, error } = await query;

        if (error) {
            if (error.code === '42P01') {
                return res.json([]);
            }
            return res.status(500).json({ error: error.message });
        }

        res.json(data || []);
    } catch (error) {
        console.error('Get time logs error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create a new time log
app.post('/api/student/:id/time-logs', async (req, res) => {
    const { id } = req.params;
    const { goal_id, dream_id, minutes, note, log_date } = req.body;

    if (!goal_id || !minutes || minutes <= 0) {
        return res.status(400).json({ error: 'goal_id and minutes are required' });
    }

    if (minutes > 480) {
        return res.status(400).json({ error: '单次记录时间不能超过8小时' });
    }

    try {
        // Verify goal belongs to student
        const { data: goal, error: goalError } = await supabaseAdmin
            .from('student_goals')
            .select('id, dream_id, student_id')
            .eq('id', goal_id)
            .eq('student_id', id)
            .single();

        if (goalError || !goal) {
            return res.status(404).json({ error: '目标不存在或不属于该学生' });
        }

        const { data, error } = await supabaseAdmin
            .from('goal_time_logs')
            .insert([{
                student_id: id,
                goal_id,
                dream_id: dream_id || goal.dream_id,
                minutes: parseInt(minutes, 10),
                note: note ? String(note).trim().slice(0, 200) : null,
                log_date: log_date || new Date().toISOString().split('T')[0]
            }])
            .select()
            .single();

        if (error) {
            console.error('Create time log error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.status(201).json(data);
    } catch (error) {
        console.error('Create time log error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get time tracking summary for a student
app.get('/api/student/:id/time-summary', async (req, res) => {
    const { id } = req.params;
    const { period = 'week' } = req.query; // 'week', 'month', 'all'

    try {
        let startDate = null;
        const now = new Date();

        if (period === 'week') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - now.getDay());
            startDate.setHours(0, 0, 0, 0);
        } else if (period === 'month') {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        let query = supabaseAdmin
            .from('goal_time_logs')
            .select('minutes, dream_id, goal_id, log_date')
            .eq('student_id', id);

        if (startDate) {
            query = query.gte('log_date', startDate.toISOString().split('T')[0]);
        }

        const { data: logs, error } = await query;

        if (error) {
            if (error.code === '42P01') {
                return res.json({
                    period,
                    total_minutes: 0,
                    total_hours: 0,
                    by_dream: [],
                    by_goal: [],
                    daily_breakdown: []
                });
            }
            return res.status(500).json({ error: error.message });
        }

        // Calculate summary
        const totalMinutes = (logs || []).reduce((sum, log) => sum + (log.minutes || 0), 0);

        // Group by dream
        const dreamMap = new Map();
        const goalMap = new Map();
        const dailyMap = new Map();

        for (const log of logs || []) {
            // By dream
            if (log.dream_id) {
                dreamMap.set(log.dream_id, (dreamMap.get(log.dream_id) || 0) + log.minutes);
            }
            // By goal
            if (log.goal_id) {
                goalMap.set(log.goal_id, (goalMap.get(log.goal_id) || 0) + log.minutes);
            }
            // By day
            if (log.log_date) {
                dailyMap.set(log.log_date, (dailyMap.get(log.log_date) || 0) + log.minutes);
            }
        }

        // Fetch dream and goal titles
        const dreamIds = Array.from(dreamMap.keys());
        const goalIds = Array.from(goalMap.keys());

        let dreamTitles = {};
        let goalTitles = {};

        if (dreamIds.length > 0) {
            const { data: dreams } = await supabaseAdmin
                .from('student_dreams')
                .select('id, title')
                .in('id', dreamIds);
            dreamTitles = Object.fromEntries((dreams || []).map(d => [d.id, d.title]));
        }

        if (goalIds.length > 0) {
            const { data: goals } = await supabaseAdmin
                .from('student_goals')
                .select('id, title')
                .in('id', goalIds);
            goalTitles = Object.fromEntries((goals || []).map(g => [g.id, g.title]));
        }

        res.json({
            period,
            total_minutes: totalMinutes,
            total_hours: Math.round(totalMinutes / 60 * 10) / 10,
            by_dream: Array.from(dreamMap.entries()).map(([id, minutes]) => ({
                dream_id: id,
                title: dreamTitles[id] || '未知期待',
                minutes,
                hours: Math.round(minutes / 60 * 10) / 10
            })).sort((a, b) => b.minutes - a.minutes),
            by_goal: Array.from(goalMap.entries()).map(([id, minutes]) => ({
                goal_id: id,
                title: goalTitles[id] || '未知目标',
                minutes,
                hours: Math.round(minutes / 60 * 10) / 10
            })).sort((a, b) => b.minutes - a.minutes),
            daily_breakdown: Array.from(dailyMap.entries())
                .map(([date, minutes]) => ({ date, minutes, hours: Math.round(minutes / 60 * 10) / 10 }))
                .sort((a, b) => a.date.localeCompare(b.date))
        });
    } catch (error) {
        console.error('Get time summary error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get time budget vs actual comparison (smart reminder data)
app.get('/api/student/:id/time-comparison', async (req, res) => {
    const { id } = req.params;

    try {
        // Get dreams with their planned and actual hours
        const { data: dreams, error: dreamsError } = await supabaseAdmin
            .from('student_dreams')
            .select('id, title, weekly_hours, actual_weekly_hours, is_focused')
            .eq('student_id', id)
            .eq('dream_status', 'active');

        if (dreamsError) {
            return res.status(500).json({ error: dreamsError.message });
        }

        const dreamComparisons = (dreams || []).map(dream => {
            const planned = dream.weekly_hours || 0;
            const actual = dream.actual_weekly_hours || 0;
            const remaining = Math.max(0, planned - actual);
            const progress = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : 0;

            return {
                dream_id: dream.id,
                title: dream.title,
                is_focused: dream.is_focused,
                planned_hours: planned,
                actual_hours: actual,
                remaining_hours: remaining,
                progress_percent: progress,
                status: actual >= planned ? 'completed' : (actual > 0 ? 'in_progress' : 'not_started')
            };
        });

        const totalPlanned = dreamComparisons.reduce((sum, d) => sum + d.planned_hours, 0);
        const totalActual = dreamComparisons.reduce((sum, d) => sum + d.actual_hours, 0);

        // Generate smart reminders
        const reminders = [];

        for (const dream of dreamComparisons) {
            if (dream.planned_hours === 0) continue;

            if (dream.status === 'not_started') {
                reminders.push({
                    type: 'warning',
                    dream: dream.title,
                    message: `你这周给"${dream.title}"安排了${dream.planned_hours}小时，但还没记录任何投入`
                });
            } else if (dream.progress_percent < 50 && dream.planned_hours > 0) {
                reminders.push({
                    type: 'info',
                    dream: dream.title,
                    message: `"${dream.title}"进度${dream.progress_percent}%，还有${dream.remaining_hours}小时待完成`
                });
            } else if (dream.status === 'completed') {
                reminders.push({
                    type: 'success',
                    dream: dream.title,
                    message: `恭喜！"${dream.title}"本周时间目标已达成`
                });
            }
        }

        res.json({
            summary: {
                total_planned_hours: totalPlanned,
                total_actual_hours: totalActual,
                overall_progress: totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0
            },
            dreams: dreamComparisons,
            reminders: reminders
        });
    } catch (error) {
        console.error('Get time comparison error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8.2 Get Growth Milestones (Timeline)
app.get('/api/student/:id/milestones', async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
        .from('student_goals')
        .select('*')
        .eq('student_id', id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error fetching milestones:', error);
        if (error.code === '42P01') return res.json([]);
        return res.status(500).json({ error: error.message });
    }
    res.json(data);
});

// 8.3 Get AI Suggestions (Dream Portfolio)
app.get('/api/student/:id/suggestions', async (req, res) => {
    const { id } = req.params;
    const dreamFocus = String(req.query.dream_focus || '').trim();
    const cacheKey = `${id}::${dreamFocus || 'all'}`;

    const cached = getCachedSuggestion(cacheKey);
    if (cached) return res.json(cached);

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, dream, bio')
        .eq('id', id)
        .single();

    const { data: goals } = await supabaseAdmin
        .from('student_goals')
        .select('title, description, status, target_date, completed_at')
        .eq('student_id', id)
        .order('created_at', { ascending: false })
        .limit(6);

    const safeName = profile?.full_name || '同学';
    const { dreams, dreamLine } = buildDreamContext(profile);
    const effectiveDream = dreamFocus && dreams.includes(dreamFocus) ? dreamFocus : dreamLine;
    const bio = profile?.bio || '';
    const goalsText = (goals || [])
        .map((goal) => {
            const status = goal.status === 'completed' ? '已完成' : '进行中';
            return `${goal.title}（${status}）`;
        })
        .join('；');

    const fallback = {
        title: 'AI小建议',
        tips: [
            effectiveDream ? `${safeName}，围绕“${effectiveDream}”每天完成一个小步骤，你会更接近期待。` : `${safeName}，给自己一个小目标，慢慢来就会更有信心。`,
            '坚持做一件小事，很快就能看到进步哦！'
        ]
    };

    if (!ecnuApiKey) {
        setCachedSuggestion(cacheKey, fallback);
        return res.json(fallback);
    }

    try {
        const prompt = [
            `学生姓名：${safeName}`,
            effectiveDream ? `当前选中的期待：${effectiveDream}` : (dreamLine ? `期待：${dreamLine}` : '期待：未填写'),
            bio ? `兴趣/自我描述：${bio}` : '兴趣/自我描述：未填写',
            goalsText ? `成长足迹：${goalsText}` : '成长足迹：暂无目标'
        ].join('\n');

        const response = await fetch('https://chat.ecnu.edu.cn/open/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ecnuApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'ecnu-max',
                messages: [
                    {
                        role: 'system',
                        content: '你是小学成长记录的AI导师，只输出1到2句简短、积极、可执行的小建议，不要加标题。'
                    },
                    {
                        role: 'user',
                        content: `请根据以下信息给出小建议：\n${prompt}`
                    }
                ],
                temperature: 0.7,
                max_tokens: 120
            })
        });

        if (!response.ok) {
            throw new Error('Suggestion API error');
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content?.trim();
        if (!content) throw new Error('Empty suggestion');

        const sentences = content
            .split(/\n|。|！|!|\./)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 2);

        const result = {
            title: 'AI小建议',
            tips: sentences.length > 0 ? sentences.map((text) => `${text}。`) : fallback.tips
        };

        setCachedSuggestion(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Suggestion error:', error);
        setCachedSuggestion(cacheKey, fallback);
        res.json(fallback);
    }
});

// 10.4 Teacher class obstacles summary
app.get('/api/teacher/class/obstacles/summary', async (req, res) => {
    const teacherId = String(req.query.teacher_id || '').trim();
    const classNameInput = String(req.query.class_name || '').trim();
    const days = parsePositiveInt(req.query.days, 7, 1, 90);

    if (!teacherId) {
        return res.status(400).json({ error: 'Missing teacher_id' });
    }

    try {
        const { data: teacherProfile, error: teacherError } = await supabaseAdmin
            .from('profiles')
            .select('id, role, class_name, school_name')
            .eq('id', teacherId)
            .single();

        if (teacherError) return res.status(500).json({ error: teacherError.message });
        if (!teacherProfile || teacherProfile.role !== 'teacher') {
            return res.status(403).json({ error: '仅老师可查看班级阻碍统计' });
        }

        const effectiveClassName = classNameInput || teacherProfile.class_name || '';
        if (!effectiveClassName) {
            return res.status(400).json({ error: 'Missing class_name' });
        }

        let studentsQuery = supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('role', 'student')
            .eq('class_name', effectiveClassName);

        if (teacherProfile.school_name) {
            studentsQuery = studentsQuery.eq('school_name', teacherProfile.school_name);
        }

        const { data: students, error: studentsError } = await studentsQuery;

        if (studentsError) return res.status(500).json({ error: studentsError.message });

        const studentIds = (students || []).map((item) => item.id).filter(Boolean);
        if (!studentIds.length) {
            return res.json({
                class_name: effectiveClassName,
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
                    class_name: effectiveClassName,
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

        res.json({
            class_name: effectiveClassName,
            days,
            total: (rows || []).length,
            by_type: Array.from(typeMap.entries()).map(([type, count]) => ({ type, count })),
            by_status: Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }))
        });
    } catch (error) {
        console.error('Teacher class obstacles summary error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8.3.1 Get AI Goal Recommendations (for Growth Timeline)
app.get('/api/student/:id/goal-recommendations', async (req, res) => {
    const { id } = req.params;
    const dreamFocus = String(req.query.dream_focus || '').trim();
    const count = Math.max(1, Math.min(4, parseInt(req.query.count) || 3));
    const noCache = count === 1;
    const cacheKey = `${id}::${dreamFocus || 'all'}`;

    if (!noCache) {
        const cached = getCachedGoalRecommendations(cacheKey);
        if (cached) return res.json(cached);
    }

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, dream, bio')
        .eq('id', id)
        .single();

    const { data: goals } = await supabaseAdmin
        .from('student_goals')
        .select('title, status')
        .eq('student_id', id)
        .order('created_at', { ascending: false })
        .limit(8);

    const safeName = profile?.full_name || '同学';
    const { dreams, primaryDream, dreamLine } = buildDreamContext(profile);
    const effectiveDream = dreamFocus && dreams.includes(dreamFocus) ? dreamFocus : primaryDream;
    const effectiveDreamLine = dreamFocus && dreams.includes(dreamFocus) ? dreamFocus : dreamLine;
    const bio = profile?.bio || '';
    const goalsText = (goals || []).map((goal) => `${goal.title}（${goal.status === 'completed' ? '已完成' : '进行中'}）`).join('；');

    const fallback = buildGoalRecommendationFallback(safeName, effectiveDream || primaryDream, count);

    if (!ecnuApiKey) {
        if (!noCache) setCachedGoalRecommendations(cacheKey, fallback);
        return res.json(fallback);
    }

    try {
        const prompt = [
            `学生：${safeName}`,
            effectiveDream ? `当前选中的期待：${effectiveDream}` : (effectiveDreamLine ? `期待：${effectiveDreamLine}` : '期待：未填写'),
            bio ? `特点：${bio}` : '特点：未填写',
            goalsText ? `当前目标：${goalsText}` : '当前目标：暂无'
        ].join('\n');

        const response = await fetch('https://chat.ecnu.edu.cn/open/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ecnuApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'ecnu-max',
                messages: [
                    {
                        role: 'system',
                        content: `你是幼儿成长导师。请输出${count === 1 ? '1个' : count + '个'}适合幼儿/小学低龄学生、和期待相关、可在家庭或校园完成的微目标。只返回JSON，不要解释。格式：{"recommendations":[{"title":"","description":"","days_to_target":7}]}`
                    },
                    {
                        role: 'user',
                        content: `请根据以下信息生成推荐目标：\n${prompt}`
                    }
                ],
                temperature: 0.8,
                max_tokens: count === 1 ? 120 : 320
            })
        });

        if (!response.ok) throw new Error('Goal recommendation API error');

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content?.trim();
        let recommendations = parseGoalRecommendationContent(content);
        if (count < recommendations.length) recommendations = recommendations.slice(0, count);

        const result = {
            title: 'AI目标推荐',
            recommendations: recommendations.length > 0 ? recommendations : fallback.recommendations
        };

        if (!noCache) setCachedGoalRecommendations(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Goal recommendation error:', error);
        if (!noCache) setCachedGoalRecommendations(cacheKey, fallback);
        res.json(fallback);
    }
});

// 8.4 Get AI Encouragement (Teacher Comment)
app.get('/api/student/:id/ai-comment', async (req, res) => {
    const { id } = req.params;

    const cached = getCachedComment(id);
    if (cached) return res.json(cached);

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, dream, bio')
        .eq('id', id)
        .single();

    const { data: goals } = await supabaseAdmin
        .from('student_goals')
        .select('title, description, status, target_date, completed_at')
        .eq('student_id', id)
        .order('created_at', { ascending: false })
        .limit(6);

    const safeName = profile?.full_name || '同学';
    const { dreamLine } = buildDreamContext(profile);
    const bio = profile?.bio || '';
    const goalsText = (goals || [])
        .map((goal) => {
            const status = goal.status === 'completed' ? '已完成' : '进行中';
            return `${goal.title}（${status}）`;
        })
        .join('；');

    const fallback = {
        comment: `${safeName}，你做得很棒！继续保持今天的好状态。`
    };

    if (!ecnuApiKey) {
        setCachedComment(id, fallback);
        return res.json(fallback);
    }

    try {
        const prompt = [
            `学生姓名：${safeName}`,
            dreamLine ? `期待：${dreamLine}` : '期待：未填写',
            bio ? `兴趣/自我描述：${bio}` : '兴趣/自我描述：未填写',
            goalsText ? `成长足迹：${goalsText}` : '成长足迹：暂无目标'
        ].join('\n');

        const response = await fetch('https://chat.ecnu.edu.cn/open/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ecnuApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'ecnu-max',
                messages: [
                    {
                        role: 'system',
                        content: '你是小学成长记录的AI老师，只输出1句简短、积极、温暖的鼓励话语，不要加引号和标题。'
                    },
                    {
                        role: 'user',
                        content: `请根据以下信息给出鼓励的话：\n${prompt}`
                    }
                ],
                temperature: 0.7,
                max_tokens: 80
            })
        });

        if (!response.ok) {
            throw new Error('AI comment API error');
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content?.trim();
        if (!content) throw new Error('Empty AI comment');

        const result = { comment: content };
        setCachedComment(id, result);
        res.json(result);
    } catch (error) {
        console.error('AI comment error:', error);
        setCachedComment(id, fallback);
        res.json(fallback);
    }
});

// 9. Get Random Challenge
app.get('/api/challenge/random', async (req, res) => {
    const category = String(req.query.category || '').trim().toLowerCase();
    const validCategories = ['school', 'home', 'parent_child', 'classmate', 'teacher_student', 'academic'];
    const validCategory = validCategories.includes(category) ? category : '';

    try {
        let query = supabaseAdmin
            .from('tasks')
            .select('*')
            .eq('type', 'challenge');

        if (validCategory) {
            query = query.eq('challenge_category', validCategory);
        }

        const { data, error } = await query;
        if (error) {
            console.error('Challenge random query error:', error);
        }

        const normalizedChallenges = (data || [])
            .map((item) => normalizeChallengeRecord(item))
            .filter((item) => item.title && Array.isArray(item.options) && item.options.length >= 2);

        if (normalizedChallenges.length > 0) {
            const randomChallenge = normalizedChallenges[Math.floor(Math.random() * normalizedChallenges.length)];
            return res.json(randomChallenge);
        }

        return res.json(getFallbackChallenge(validCategory));
    } catch (error) {
        console.error('Challenge random fatal error:', error);
        return res.json(getFallbackChallenge(validCategory));
    }
});

// 10. Submit Challenge Response
app.post('/api/challenge/submit', async (req, res) => {
    const { student_id, challenge_id, option_selected, type } = req.body;

    // 1. Log completion in student_tasks
    // Points logic: Positive = 10xp, Negative = 2xp (encouragement)
    const points = type === 'positive' ? 10 : 2;

    const { data, error } = await supabaseAdmin
        .from('student_tasks')
        .insert([{
            student_id,
            task_id: challenge_id, // Ensure challenge_id maps to a real task ID if possible, or null for mocks
            status: 'completed',
            completed_at: new Date(),
            response_data: { option_selected, type },
            // If we have a points column in student_tasks, store it.
            // For now, we assume points are calculated dynamically or stored here if schema supports.
            // Let's assume we rely on the related Task's points, but for variable points we might need a column.
            // MVP: Just log it.
        }])
        .select();

    if (error) {
        console.error('Error submitting challenge:', error);
        // Don't block UI on error if it's just a mock ID issue
        return res.json({ message: 'Submission logged (mock)', points });
    }

    invalidateStudentCaches(student_id);
    invalidateTeacherCaches();
    res.json({ message: 'Challenge recorded', points, data });
});

// 10.1 Challenge Summary
app.post('/api/challenge/summary', async (req, res) => {
    const { student_id, total, positive, negative, answers } = req.body;

    if (!student_id) {
        return res.status(400).json({ error: 'Missing student_id' });
    }

    const safeTotal = Number.isFinite(total) ? total : 10;
    const safePositive = Number.isFinite(positive) ? positive : 0;
    const safeNegative = Number.isFinite(negative) ? negative : 0;

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, dream, bio')
        .eq('id', student_id)
        .single();

    const safeName = profile?.full_name || '同学';
    const { dreamLine } = buildDreamContext(profile);

    const fallback = {
        summary: `${safeName}，你完成了${safeTotal}道题，积极选择${safePositive}次，继续努力${safeNegative}次。保持这种愿意尝试的态度，你会越来越棒！`
    };

    if (!ecnuApiKey) {
        return res.json(fallback);
    }

    try {
        const response = await fetch('https://chat.ecnu.edu.cn/open/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ecnuApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'ecnu-max',
                messages: [
                    {
                        role: 'system',
                        content: '你是小学成长记录的AI导师，基于答题情况给出1段简短总结和鼓励（2-3句），建议必须与乐观积极的心态相关，避免说教。'
                    },
                    {
                        role: 'user',
                        content: `学生姓名：${safeName}\n期待：${dreamLine || '未填写'}\n答题总数：${safeTotal}\n积极选择：${safePositive}\n消极选择：${safeNegative}\n请给出与乐观积极心态相关的简短总结与建议。`
                    }
                ],
                temperature: 0.7,
                max_tokens: 160
            })
        });

        if (!response.ok) {
            throw new Error('Summary API error');
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content?.trim();
        if (!content) throw new Error('Empty summary');

        res.json({ summary: content });
    } catch (error) {
        console.error('Summary error:', error);
        res.json(fallback);
    }
});

// 11. Get Student Summary (Profile + AI Comment)
app.get('/api/student/:id/summary', async (req, res) => {
    const { id } = req.params;

    // 1. Get Profile
    const [{ data: profile, error }, dreamsResult] = await Promise.all([
        supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', id)
            .single(),
        supabaseAdmin
            .from('student_dreams')
            .select('title, priority, created_at')
            .eq('student_id', id)
            .order('priority', { ascending: true })
            .order('created_at', { ascending: false })
    ]);

    if (error) {
        // Fallback for mock/guest
        return res.json({
            full_name: '同学',
            dream: '成为一名宇航员',
            dreams: ['成为一名宇航员'],
            bio: '快乐的小学生预备队员',
            ai_comment: '今天你表现得真棒！继续保持好奇心哦！'
        });
    }

    // 2. Generate "AI Comment" (Mock logic based on recent moods/tasks)
    // In real app, call LLM here.
    const comments = [
        "你今天的主动性很强，老师为你骄傲！",
        "看到你完成这么多任务，真是一个努力的孩子！",
        "你的笑容很有感染力，继续保持乐观哦！",
        "遇到困难不放弃，这就是成长的样子！"
    ];
    const randomComment = comments[Math.floor(Math.random() * comments.length)];

    const profileDreams = normalizeDreamList(profile?.dream, profile?.dreams);
    const tableDreams = (dreamsResult?.data || [])
        .map((row) => String(row?.title || '').trim())
        .filter(Boolean);
    const dreams = profileDreams.length > 0 ? profileDreams : tableDreams;

    res.json({
        ...profile,
        dream: dreams[0] || profile?.dream || '',
        dreams,
        ai_comment: randomComment
    });
});

// 11.1 Update Student Profile
app.patch('/api/student/:id/profile', async (req, res) => {
    const { id } = req.params;
    const { full_name, dream, dreams, bio, avatar_url } = req.body || {};

    const payload = {
        updated_at: new Date().toISOString()
    };

    if (typeof full_name === 'string') payload.full_name = full_name.trim();
    const normalizedDreams = normalizeDreamList(dream, dreams);
    if (normalizedDreams.length > 0) {
        payload.dream = normalizedDreams.join('\n');
    } else if (dreams !== undefined || (typeof dream === 'string' && !dream.trim())) {
        payload.dream = '';
    } else if (typeof dream === 'string') {
        payload.dream = dream.trim();
    }
    if (typeof bio === 'string') payload.bio = bio.trim();
    if (typeof avatar_url === 'string') payload.avatar_url = avatar_url.trim();

    if (!Object.keys(payload).some((key) => key !== 'updated_at')) {
        return res.status(400).json({ error: '没有可更新的字段' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('profiles')
            .update(payload)
            .eq('id', id)
            .select('id, full_name, dream, bio, avatar_url, role')
            .single();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        // Sync dreams to student_dreams table
        const dreamsOut = normalizeDreamList(data?.dream, data?.dreams);
        try {
            const { data: existingDreams } = await supabaseAdmin
                .from('student_dreams')
                .select('id, title')
                .eq('student_id', id);

            const existingTitles = (existingDreams || []).map(d => d.title);
            const newDreams = dreamsOut.filter(d => !existingTitles.includes(d));
            const dreamsToDelete = (existingDreams || [])
                .filter(d => !dreamsOut.includes(d.title))
                .map(d => d.id);

            if (newDreams.length > 0) {
                await supabaseAdmin
                    .from('student_dreams')
                    .insert(newDreams.map((title, index) => ({
                        student_id: id,
                        title,
                        dream_status: 'active',
                        priority: index === 0 ? 1 : 2,
                        is_focused: index === 0 && existingDreams?.length === 0,
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
            // Ignore sync errors (table might not exist yet)
            console.log('Dreams sync warning:', syncError.message);
        }

        invalidateStudentAiCaches(id);
        invalidateTeacherCaches();
        res.json({
            message: '个人信息已更新',
            data: {
                ...data,
                dream: dreamsOut[0] || data?.dream || '',
                dreams: dreamsOut
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health Check
app.get('/health', cacheMiddleware(10), (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Performance monitoring endpoint (admin only in production)
app.get('/api/admin/performance', (req, res) => {
    // In production, add authentication check here
    res.json(getPerformanceStats());
});

// Start server (only when running directly, not when imported)
if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}

// Export for Vercel serverless function
module.exports = app;

// Export for Vercel serverless function
module.exports = app;
