/**
 * Validator Middleware
 * 输入验证中间件
 */

const { body, param, query, validationResult } = require('express-validator');

const VALID_MOOD_VALUES = [
    'joy', 'surprise', 'sadness', 'anger', 'disgust', 'fear', 'interest', 'contempt', 'distress',
    'happy', 'calm', 'neutral', 'sad', 'angry', 'anxious'
];

/**
 * 验证结果处理中间件
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: '输入验证失败',
            details: errors.array().map(e => ({
                field: e.path,
                message: e.msg
            }))
        });
    }
    next();
};

/**
 * 常用验证规则
 */
const rules = {
    // UUID 验证
    uuid: (field = 'id') => param(field)
        .isUUID()
        .withMessage(`${field} 格式无效`),

    // 可选 UUID
    optionalUuid: (field = 'id') => param(field)
        .optional()
        .isUUID()
        .withMessage(`${field} 格式无效`),

    // 邮箱验证
    email: body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('邮箱格式无效'),

    // 密码验证
    password: body('password')
        .isLength({ min: 6, max: 128 })
        .withMessage('密码长度需在 6-128 个字符之间'),

    // 姓名验证
    name: body('name')
        .trim()
        .notEmpty()
        .withMessage('姓名不能为空'),

    // 邀请码验证
    inviteCode: body('inviteCode')
        .optional()
        .trim()
        .isLength({ min: 6, max: 6 })
        .isAlphanumeric()
        .withMessage('邀请码必须是 6 位字母或数字'),

    // 内容验证
    content: (field = 'content', maxLen = 500) => body(field)
        .optional()
        .trim()
        .isLength({ max: maxLen })
        .withMessage(`${field} 长度不能超过 ${maxLen} 个字符`),

    // 学生 ID 验证
    studentId: body('student_id')
        .isUUID()
        .withMessage('学生 ID 格式无效'),

    // 分页参数
    pagination: [
        query('limit')
            .optional()
            .isInt({ min: 1, max: 500 })
            .toInt(),
        query('offset')
            .optional()
            .isInt({ min: 0 })
            .toInt()
    ],

    // 角色验证
    role: body('role')
        .isIn(['student', 'teacher'])
        .withMessage('角色必须是 student 或 teacher')
};

/**
 * 注册验证规则
 */
const registerRules = [
    rules.email,
    rules.password,
    rules.name,
    body('role').isIn(['student', 'teacher']).withMessage('角色必须是 student 或 teacher'),
    body('schoolName').optional().trim().isLength({ max: 100 }),
    body('className').optional().trim().isLength({ max: 50 }),
    validate
];

/**
 * 登录验证规则
 */
const loginRules = [
    rules.email,
    body('password').notEmpty().withMessage('密码不能为空'),
    validate
];

/**
 * 创建目标验证规则
 */
const createGoalRules = [
    rules.uuid('id'),
    body('title').trim().isLength({ min: 1, max: 100 }).withMessage('目标标题长度需在 1-100 个字符之间'),
    body('description').optional().trim().isLength({ max: 500 }),
    body('target_date').optional().isISO8601().withMessage('目标日期格式无效'),
    validate
];

/**
 * 创建阻碍验证规则
 */
const createObstacleRules = [
    rules.uuid('id'),
    body('content').trim().isLength({ min: 1, max: 300 }).withMessage('阻碍描述长度需在 1-300 个字符之间'),
    body('obstacle_type').optional().isIn(['time', 'capability', 'resource', 'emotion', 'social', 'other']),
    body('severity').optional().isInt({ min: 1, max: 5 }).toInt(),
    validate
];

/**
 * 创建班级动态验证规则
 */
const createMomentRules = [
    rules.studentId,
    body('content').optional().trim().isLength({ max: 500 }),
    body('type').optional().isIn(['share', 'achievement', 'daily']),
    // 至少需要内容或媒体
    body().custom((value) => {
        if (!value.content?.trim() && !value.media_url) {
            throw new Error('请输入动态内容或上传媒体');
        }
        return true;
    }),
    validate
];

/**
 * 引导步骤验证规则
 */
const onboardingStepRules = [
    rules.uuid('id'),
    body('step').isInt({ min: 1, max: 5 }).withMessage('步骤编号必须在 1-5 之间'),
    body('data').optional().isObject(),
    validate
];

/**
 * 引导完成验证规则
 */
const onboardingCompleteRules = [
    rules.uuid('id'),
    body('class_invite_code').optional().trim().isLength({ min: 6, max: 6 }).isAlphanumeric(),
    validate
];

/**
 * 更新个人资料验证规则
 */
const updateProfileRules = [
    rules.uuid('id'),
    body('full_name').optional().trim().isLength({ min: 1, max: 50 }),
    body('school_name').optional().trim().isLength({ max: 100 }),
    body('class_name').optional().trim().isLength({ max: 50 }),
    body('bio').optional().trim().isLength({ max: 200 }).withMessage('个人简介不能超过 200 字'),
    body('dream').optional().trim().isLength({ max: 200 }).withMessage('期待描述不能超过 200 字'),
    validate
];

/**
 * 提交心情验证规则
 */
const submitMoodRules = [
    body().custom((value) => {
        const moodValue = String(value?.mood ?? value?.mood_type ?? '').trim().toLowerCase();
        if (!VALID_MOOD_VALUES.includes(moodValue)) {
            throw new Error('心情类型无效');
        }
        return true;
    }),
    body('note').optional().trim().isLength({ max: 200 }),
    validate
];

module.exports = {
    validate,
    rules,
    registerRules,
    loginRules,
    createGoalRules,
    createObstacleRules,
    createMomentRules,
    onboardingStepRules,
    onboardingCompleteRules,
    updateProfileRules,
    submitMoodRules
};
