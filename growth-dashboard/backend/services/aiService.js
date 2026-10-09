/**
 * AI Service - AI API 调用封装
 * 从 server.js 提取的 AI 调用逻辑
 */

const fetch = require('node-fetch');
const { supabaseAdmin } = require('../middlewares/auth');
const { buildDreamContext, toFutureDate, normalizeObstacleType } = require('./statsService');
const {
    getCachedSuggestion,
    setCachedSuggestion,
    getCachedComment,
    setCachedComment,
    getCachedGoalRecommendations,
    setCachedGoalRecommendations,
    getCachedObstacleSuggestion,
    setCachedObstacleSuggestion
} = require('./cacheService');

const ecnuApiKey = process.env.ECNU_API_KEY;
const ECNU_API_URL = 'https://chat.ecnu.edu.cn/open/api/v1/chat/completions';
const ECNU_MODEL = 'ecnu-max';

// ============================================
// Fallback Data
// ============================================

const GOAL_FALLBACK_POOL = [
    (safeName, dreamText) => ({
        title: `画一张"${dreamText}"小海报`,
        description: `${safeName}每天用5分钟补充一处内容，和家人分享你的期待故事。`,
        target_date: toFutureDate(7)
    }),
    (safeName, dreamText) => ({
        title: '每天完成一次生活小自理',
        description: '例如自己整理书包、收拾玩具或叠衣服，连续坚持一周。',
        target_date: toFutureDate(10)
    }),
    (safeName, dreamText) => ({
        title: '做一次勇敢表达练习',
        description: '每天对老师或家人说一句积极的话，练习清晰表达和自信。',
        target_date: toFutureDate(14)
    }),
    (safeName, dreamText) => ({
        title: `和家人聊聊"${dreamText}"`,
        description: `${safeName}可以问问家人觉得这个期待需要什么本领。`,
        target_date: toFutureDate(5)
    }),
    (safeName, dreamText) => ({
        title: '帮家人做一件力所能及的小事',
        description: '比如帮忙摆碗筷、浇花、擦桌子，锻炼动手能力。',
        target_date: toFutureDate(3)
    }),
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

const getObstacleFallbackSuggestion = ({ studentName, dream, obstacleType, content }) => {
    const safeName = studentName || '同学';
    const safeDream = dream || '你的期待';
    const safeContent = content || '当前遇到的困难';

    const byType = {
        time: `把"${safeContent}"拆成 10 分钟能完成的小步骤，先做第一步就很棒。`,
        capability: `先找一个最容易练习的小技能，连续练 3 天，你会看到自己进步。`,
        resource: `试着向老师或家人说明你需要什么帮助，他们会更容易支持你。`,
        emotion: `先深呼吸 3 次，再告诉自己"我可以先试一次"，慢慢来就会更有信心。`,
        social: `可以先和一位你信任的人说说这个困难，一起想一个小办法。`,
        other: `把困难写成一句话，再写下一个今天就能做的小行动。`
    };

    const first = `${safeName}，关于"${safeDream}"，你已经在认真面对困难了，这非常了不起。`;
    const second = byType[obstacleType] || byType.other;
    return `${first}${second}`;
};

// ============================================
// AI API Helper
// ============================================

const callEcnuApi = async (messages, options = {}) => {
    const { temperature = 0.7, maxTokens = 120, timeout = 8000 } = options;

    if (!ecnuApiKey) {
        return null;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(ECNU_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ecnuApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: ECNU_MODEL,
                messages,
                temperature,
                max_tokens: maxTokens
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`AI API error: ${response.status}`);
        }

        const data = await response.json();
        return data?.choices?.[0]?.message?.content?.trim() || null;
    } catch (error) {
        console.error('AI API call failed:', error.message);
        return null;
    }
};

// ============================================
// AI Suggestion (Growth Portfolio)
// ============================================

const getSuggestions = async (studentId, dreamFocus = '') => {
    const cacheKey = `${studentId}::${dreamFocus || 'all'}`;
    const cached = getCachedSuggestion(cacheKey);
    if (cached) return cached;

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, dream, bio')
        .eq('id', studentId)
        .single();

    const { data: goals } = await supabaseAdmin
        .from('student_goals')
        .select('title, description, status, target_date, completed_at')
        .eq('student_id', studentId)
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
            effectiveDream
                ? `${safeName}，围绕"${effectiveDream}"每天完成一个小步骤，你会更接近期待。`
                : `${safeName}，给自己一个小目标，慢慢来就会更有信心。`,
            '坚持做一件小事，很快就能看到进步哦！'
        ]
    };

    const prompt = [
        `学生姓名：${safeName}`,
        effectiveDream
            ? `当前选中的期待：${effectiveDream}`
            : (dreamLine ? `期待：${dreamLine}` : '期待：未填写'),
        bio ? `兴趣/自我描述：${bio}` : '兴趣/自我描述：未填写',
        goalsText ? `成长足迹：${goalsText}` : '成长足迹：暂无目标'
    ].join('\n');

    const content = await callEcnuApi([
        {
            role: 'system',
            content: '你是小学成长记录的AI导师，只输出1到2句简短、积极、可执行的小建议，不要加标题。'
        },
        {
            role: 'user',
            content: `请根据以下信息给出小建议：\n${prompt}`
        }
    ]);

    if (content) {
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
        return result;
    }

    setCachedSuggestion(cacheKey, fallback);
    return fallback;
};

// ============================================
// AI Goal Recommendations
// ============================================

const getGoalRecommendations = async (studentId, dreamFocus = '', count = 3) => {
    const noCache = count === 1;
    const cacheKey = `${studentId}::${dreamFocus || 'all'}`;

    if (!noCache) {
        const cached = getCachedGoalRecommendations(cacheKey);
        if (cached) return cached;
    }

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, dream, bio')
        .eq('id', studentId)
        .single();

    const { data: goals } = await supabaseAdmin
        .from('student_goals')
        .select('title, status')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(8);

    // 获取梦想时间分配数据
    const { data: dreamsData } = await supabaseAdmin
        .from('student_dreams')
        .select('title, weekly_hours, is_focused, dream_status')
        .eq('student_id', studentId)
        .eq('dream_status', 'active')
        .order('is_focused', { ascending: false })
        .order('weekly_hours', { ascending: false });

    const safeName = profile?.full_name || '同学';
    const { dreams, primaryDream, dreamLine } = buildDreamContext(profile);
    const effectiveDream = dreamFocus && dreams.includes(dreamFocus) ? dreamFocus : primaryDream;
    const effectiveDreamLine = dreamFocus && dreams.includes(dreamFocus) ? dreamFocus : dreamLine;
    const bio = profile?.bio || '';
    const goalsText = (goals || [])
        .map((goal) => `${goal.title}（${goal.status === 'completed' ? '已完成' : '进行中'}）`)
        .join('；');

    // 构建时间分配文本
    const timeBudgetText = (dreamsData || [])
        .map(d => `${d.title}:${d.weekly_hours}小时/周${d.is_focused ? '(专注)' : ''}`)
        .join('、');
    const focusedDream = (dreamsData || []).find(d => d.is_focused)?.title || '';
    const totalHours = (dreamsData || []).reduce((sum, d) => sum + (d.weekly_hours || 0), 0);

    const fallback = buildGoalRecommendationFallback(safeName, effectiveDream || primaryDream, count);

    const prompt = [
        `学生：${safeName}`,
        effectiveDream
            ? `当前选中的期待：${effectiveDream}`
            : (effectiveDreamLine ? `期待：${effectiveDreamLine}` : '期待：未填写'),
        bio ? `特点：${bio}` : '特点：未填写',
        goalsText ? `当前目标：${goalsText}` : '当前目标：暂无',
        timeBudgetText ? `时间分配：${timeBudgetText}（共${totalHours}小时/周）` : '',
        focusedDream ? `重点期待：${focusedDream}` : ''
    ].filter(Boolean).join('\n');

    const content = await callEcnuApi([
        {
            role: 'system',
            content: `你是幼儿成长导师。请输出${count === 1 ? '1个' : count + '个'}适合幼儿/小学低龄学生、和期待相关、可在家庭或校园完成的微目标。

【重要规则】
1. 优先推荐"重点期待"和"时间分配多"的期待相关目标
2. 如果时间分配显示某个期待只有1-2小时/周，推荐简单快速的小目标（5-10分钟完成）
3. 如果时间分配显示某个期待有5+小时/周，推荐需要持续投入的目标（20-30分钟完成）
4. 目标必须匹配对应期待主题

只返回JSON，不要解释。格式：{"recommendations":[{"title":"","description":"","days_to_target":7}]}`
        },
        {
            role: 'user',
            content: `请根据以下信息生成推荐目标：\n${prompt}`
        }
    ], { maxTokens: count === 1 ? 120 : 320, temperature: 0.8 });

    if (content) {
        let recommendations = parseGoalRecommendationContent(content);
        if (count < recommendations.length) recommendations = recommendations.slice(0, count);

        const result = {
            title: 'AI目标推荐',
            recommendations: recommendations.length > 0 ? recommendations : fallback.recommendations
        };

        if (!noCache) setCachedGoalRecommendations(cacheKey, result);
        return result;
    }

    if (!noCache) setCachedGoalRecommendations(cacheKey, fallback);
    return fallback;
};

// ============================================
// AI Comment (Teacher-style encouragement)
// ============================================

const getAIComment = async (studentId) => {
    const cached = getCachedComment(studentId);
    if (cached) return cached;

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, dream, bio')
        .eq('id', studentId)
        .single();

    const { data: goals } = await supabaseAdmin
        .from('student_goals')
        .select('title, description, status, target_date, completed_at')
        .eq('student_id', studentId)
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

    const prompt = [
        `学生姓名：${safeName}`,
        dreamLine ? `期待：${dreamLine}` : '期待：未填写',
        bio ? `兴趣/自我描述：${bio}` : '兴趣/自我描述：未填写',
        goalsText ? `成长足迹：${goalsText}` : '成长足迹：暂无目标'
    ].join('\n');

    const content = await callEcnuApi([
        {
            role: 'system',
            content: '你是小学成长记录的AI老师，只输出1句简短、积极、温暖的鼓励话语，不要加引号和标题。'
        },
        {
            role: 'user',
            content: `请根据以下信息给出鼓励的话：\n${prompt}`
        }
    ], { maxTokens: 80 });

    if (content) {
        const result = { comment: content };
        setCachedComment(studentId, result);
        return result;
    }

    setCachedComment(studentId, fallback);
    return fallback;
};

// ============================================
// Obstacle Suggestion
// ============================================

const getObstacleSuggestion = async (studentId, dreamFocus = '') => {
    const cacheKey = `${studentId}::${dreamFocus}`;
    const cached = getCachedObstacleSuggestion(cacheKey);
    if (cached) return cached;

    const [{ data: profile }, { data: obstacleRows, error: obstacleError }] = await Promise.all([
        supabaseAdmin
            .from('profiles')
            .select('full_name, dream')
            .eq('id', studentId)
            .single(),
        supabaseAdmin
            .from('student_obstacles')
            .select('id, dream_tag, obstacle_type, content, severity, status')
            .eq('student_id', studentId)
            .in('status', ['todo', 'in_progress'])
            .order('severity', { ascending: false })
            .order('updated_at', { ascending: false })
            .limit(5)
    ]);

    if (obstacleError && obstacleError.code !== '42P01') {
        throw obstacleError;
    }

    if (!obstacleRows || obstacleRows.length === 0) {
        const noObstacleResult = {
            suggestion: dreamFocus
                ? `围绕"${dreamFocus}"写下一个当前阻碍，AI会给你小建议。`
                : '先写下一条你今天最想突破的小阻碍吧。',
            obstacle: null
        };
        return noObstacleResult;
    }

    const { dreams } = buildDreamContext(profile || {});
    const scopedRows = (obstacleRows || []).filter((row) => {
        if (!dreamFocus) return true;
        if (!dreams.includes(dreamFocus)) return false;
        return row.dream_tag === dreamFocus;
    });

    const obstacle = scopedRows[0] || null;
    if (!obstacle) {
        const noObstacleResult = {
            suggestion: dreamFocus
                ? `围绕"${dreamFocus}"写下一个当前阻碍，AI会给你小建议。`
                : '先写下一条你今天最想突破的小阻碍吧。',
            obstacle: null
        };
        return noObstacleResult;
    }

    const safeName = profile?.full_name || '同学';
    const safeDream = obstacle.dream_tag || dreamFocus || dreams[0] || '你的期待';
    const fallbackSuggestion = getObstacleFallbackSuggestion({
        studentName: safeName,
        dream: safeDream,
        obstacleType: obstacle.obstacle_type,
        content: obstacle.content
    });

    const content = await callEcnuApi([
        {
            role: 'system',
            content: '你是小学成长导师。请根据学生阻碍给出1-2句温暖、可执行、不过度说教的建议。不要使用列表。'
        },
        {
            role: 'user',
            content: `学生：${safeName}\n期待：${safeDream}\n阻碍类型：${obstacle.obstacle_type}\n阻碍描述：${obstacle.content}\n严重度：${obstacle.severity}/5\n请给出简短建议。`
        }
    ]);

    const suggestion = content || fallbackSuggestion;
    const result = { suggestion, obstacle };
    setCachedObstacleSuggestion(cacheKey, result);
    return result;
};

// ============================================
// Challenge Summary
// ============================================

const getChallengeSummary = async (studentId, challengeData) => {
    const { challengeTitle, selectedOption, isPositive } = challengeData;

    const fallbackSummary = isPositive
        ? '你选择了积极面对挑战，这种心态很棒！继续保持！'
        : '每个挑战都是成长的机会，下次试试换个角度想一想。';

    const content = await callEcnuApi([
        {
            role: 'system',
            content: '你是小学成长导师。根据学生对挑战的回答给出简短总结和鼓励。'
        },
        {
            role: 'user',
            content: `挑战题目：${challengeTitle}\n学生选择：${selectedOption}\n是否积极回答：${isPositive ? '是' : '否'}\n请给出简短总结。`
        }
    ], { maxTokens: 80 });

    return content || fallbackSummary;
};

// ============================================
// Sentiment Analysis (情感分析)
// ============================================

const analyzeSentiment = async (text) => {
    if (!text || typeof text !== 'string') {
        return { score: 0.5, label: 'neutral', emotions: [] };
    }

    const fallback = { score: 0.5, label: 'neutral', emotions: ['平静'] };

    try {
        const content = await callEcnuApi([
            {
                role: 'system',
                content: `你是一个情感分析助手。分析文本的情感倾向，返回JSON格式：{"score":0.8,"label":"positive","emotions":["快乐","满足"]}
- score: 0-1之间，0最消极，1最积极，0.5为中性
- label: positive/negative/neutral
- emotions: 主要情绪关键词数组（最多3个）`
            },
            {
                role: 'user',
                content: `分析以下文本的情感：\n${text.substring(0, 500)}`
            }
        ], { maxTokens: 100, temperature: 0.3 });

        if (content) {
            const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleaned);
            return {
                score: typeof parsed.score === 'number' ? parsed.score : 0.5,
                label: ['positive', 'negative', 'neutral'].includes(parsed.label) ? parsed.label : 'neutral',
                emotions: Array.isArray(parsed.emotions) ? parsed.emotions.slice(0, 3) : []
            };
        }

        return fallback;
    } catch (error) {
        console.error('Sentiment analysis error:', error);
        return fallback;
    }
};

// ============================================
// AI Chat (智能问答)
// ============================================

const chat = async (studentId, question, context = {}) => {
    if (!question || typeof question !== 'string') {
        return { answer: '请问有什么可以帮助你的？' };
    }

    try {
        // 获取学生上下文信息
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('full_name, dream, bio')
            .eq('id', studentId)
            .single();

        const { data: goals } = await supabaseAdmin
            .from('goals')
            .select('title, status')
            .eq('student_id', studentId)
            .order('created_at', { ascending: false })
            .limit(5);

        const safeName = profile?.full_name || '同学';
        const dream = profile?.dream || '';
        const bio = profile?.bio || '';
        const goalsText = (goals || [])
            .map(g => `${g.title}（${g.status === 'completed' ? '已完成' : '进行中'}）`)
            .join('、');

        const systemPrompt = `你是一位友善、耐心的小学成长导师${safeName ? `，正在和${safeName}聊天` : ''}。
回答要求：
1. 语气亲切，像一位关心学生的老师
2. 回答简短（不超过100字），适合小学生理解
3. 多用鼓励和引导，不要说教
4. 如果学生遇到困难，给出具体可行的建议
5. 适当关联学生的期待和目标进行鼓励`;

        const contextInfo = [
            dream ? `学生期待：${dream}` : '',
            bio ? `学生特点：${bio}` : '',
            goalsText ? `学生当前目标：${goalsText}` : ''
        ].filter(Boolean).join('\n');

        const userPrompt = contextInfo
            ? `背景信息：\n${contextInfo}\n\n学生问题：${question}`
            : `学生问题：${question}`;

        const content = await callEcnuApi([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], { maxTokens: 200, temperature: 0.7 });

        return {
            answer: content || '这个问题很有意思！你可以和老师或家长讨论一下，听听他们的想法。'
        };
    } catch (error) {
        console.error('AI chat error:', error);
        return {
            answer: '抱歉，我现在有点忙，稍后再和你聊天吧！'
        };
    }
};

// ============================================
// Batch Sentiment Analysis for Mood Records
// ============================================

const analyzeMoodSentiment = async (studentId) => {
    try {
        // 获取最近的心情记录
        const { data: moods, error } = await supabaseAdmin
            .from('student_moods')
            .select('*')
            .eq('student_id', studentId)
            .is('sentiment_score', null)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error || !moods || moods.length === 0) {
            return { analyzed: 0 };
        }

        let analyzed = 0;
        for (const mood of moods) {
            if (mood.note) {
                const sentiment = await analyzeSentiment(mood.note);
                await supabaseAdmin
                    .from('student_moods')
                    .update({
                        sentiment_score: sentiment.score,
                        sentiment_label: sentiment.label
                    })
                    .eq('id', mood.id);
                analyzed++;
            }
        }

        return { analyzed };
    } catch (error) {
        console.error('Batch mood sentiment analysis error:', error);
        return { analyzed: 0, error: error.message };
    }
};

module.exports = {
    getSuggestions,
    getGoalRecommendations,
    getAIComment,
    getObstacleSuggestion,
    getChallengeSummary,
    analyzeSentiment,
    chat,
    analyzeMoodSentiment,
    // Helpers
    buildGoalRecommendationFallback,
    getObstacleFallbackSuggestion,
    // Public AI call used by controllers
    callEcnuApiPublic: callEcnuApi
};
