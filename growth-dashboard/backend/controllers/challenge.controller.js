/**
 * Challenge Controller
 * 挑战系统控制器
 */

const { supabaseAdmin } = require('../middlewares/auth');
const aiService = require('../services/aiService');
const { invalidateStudentCaches, invalidateStudentAiCaches } = require('../services/cacheService');
const { getImageUrl } = require('../supabase_storage_helper');

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

// ============================================
// Get Random Challenge
// ============================================

const getRandomChallenge = async (req, res) => {
    const category = String(req.query.category || '').trim();
    const excludeIds = req.query.exclude ? String(req.query.exclude).split(',').filter(Boolean) : [];
    const validCategories = ['school', 'home', 'parent_child', 'teacher_student', 'classmate', 'academic'];
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

        if (data && data.length > 0) {
            // 过滤掉已出现过的题目
            let availableChallenges = data.filter(c => !excludeIds.includes(c.id));

            // 如果所有题目都已出现过，重置为全部题目（允许重新开始）
            if (availableChallenges.length === 0) {
                availableChallenges = data;
            }

            const randomChallenge = availableChallenges[Math.floor(Math.random() * availableChallenges.length)];

            // 转换图片 URL 为 Supabase Storage URL
            if (randomChallenge.image_url) {
                const normalizedPath = normalizeChallengeImagePath(randomChallenge.image_url);
                randomChallenge.image_url = getImageUrl(normalizedPath);
            }

            return res.json(randomChallenge);
        }

        // Fallback Mock Challenge
        res.json({
            id: '00000000-0000-0000-0000-000000000000',
            title: '你搭了好久的积木塔突然倒了。',
            description: '你会怎么想？',
            challenge_category: 'home',
            image_url: getImageUrl(normalizeChallengeImagePath('/img/challenges/h_3.png')),
            options: [
                { id: 'A', text: '我再也不玩积木了，我太笨了。', type: 'negative', feedback: '失败是成功之母，再试一次吧！' },
                { id: 'B', text: '没关系，我可以重新搭一个更棒的！', type: 'positive', feedback: '太棒了！这种积极的心态会让你越来越强！' }
            ]
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Submit Challenge
// ============================================

const submitChallenge = async (req, res) => {
    const { student_id, challenge_id, option_selected, type } = req.body;

    // 积分逻辑: Positive = 10xp, Negative = 2xp
    const points = type === 'positive' ? 10 : 2;

    try {
        if (!student_id || !challenge_id || !option_selected || !type) {
            return res.status(400).json({ error: 'Missing required challenge submission fields' });
        }

        const insertBase = {
            student_id,
            task_id: challenge_id,
            status: 'completed',
            completed_at: new Date(),
            notes: `选项: ${option_selected}, 类型: ${type}`
        };

        let insertResult = await supabaseAdmin
            .from('student_tasks')
            .insert([insertBase])
            .select();

        if (insertResult.error && String(insertResult.error.code || '') === '42703') {
            const { notes, ...fallbackInsert } = insertBase;
            insertResult = await supabaseAdmin
                .from('student_tasks')
                .insert([fallbackInsert])
                .select();
        }

        if (insertResult.error) {
            throw insertResult.error;
        }

        if (student_id) {
            invalidateStudentCaches(student_id);
            invalidateStudentAiCaches(student_id);
        }

        res.json({
            message: 'Challenge completed',
            points,
            recorded: true,
            data: insertResult.data || []
        });
    } catch (error) {
        console.error('Challenge submit error:', error);
        res.status(500).json({ error: error.message });
    }
};

// ============================================
// Challenge Summary (AI)
// ============================================

const getChallengeSummary = async (req, res) => {
    const { challenge_title, selected_option, is_positive, student_id } = req.body;

    try {
        const summary = await aiService.getChallengeSummary(student_id, {
            challengeTitle: challenge_title,
            selectedOption: selected_option,
            isPositive: is_positive
        });

        res.json({ summary });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getRandomChallenge,
    submitChallenge,
    getChallengeSummary
};
