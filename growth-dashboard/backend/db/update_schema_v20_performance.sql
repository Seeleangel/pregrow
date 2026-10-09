-- ============================================
-- Schema Update V20: 数据库查询性能优化
-- 目的: 添加缺失索引，优化教师端和学生端查询性能
-- ============================================

-- ============================================
-- 1. profiles 表索引优化
-- ============================================

-- 角色单独索引（当只按角色筛选时，如查找所有教师）
CREATE INDEX IF NOT EXISTS idx_profiles_role
ON profiles (role);

-- 更新复合索引：支持按班级+角色查询学生（教师端常用）
-- 注意：v15 已有 idx_profiles_class_id，这里添加更具体的组合
CREATE INDEX IF NOT EXISTS idx_profiles_class_role
ON profiles (class_id, role)
WHERE role = 'student';

-- ============================================
-- 2. tasks 表索引优化
-- ============================================

-- 创建时间倒序索引（getTasks 接口按 created_at DESC 排序）
CREATE INDEX IF NOT EXISTS idx_tasks_created_at_desc
ON tasks (created_at DESC);

-- 任务类型 + 创建时间复合索引（按类型筛选并排序）
CREATE INDEX IF NOT EXISTS idx_tasks_type_created
ON tasks (type, created_at DESC);

-- 挑战分类索引（教师端按 challenge_category 筛选 teacher_assigned）
CREATE INDEX IF NOT EXISTS idx_tasks_challenge_category
ON tasks (challenge_category)
WHERE challenge_category IS NOT NULL;

-- ============================================
-- 3. student_tasks 表索引优化
-- ============================================

-- v15/v16 已有基础索引，添加更优化的组合索引

-- 学生 + 状态 + 完成时间（查询已完成任务的常用模式）
CREATE INDEX IF NOT EXISTS idx_student_tasks_student_status_completed
ON student_tasks (student_id, status, completed_at DESC);

-- 状态 + 创建时间（教师端查询待审核任务）
CREATE INDEX IF NOT EXISTS idx_student_tasks_status_created
ON student_tasks (status, created_at DESC)
WHERE status IN ('submitted', 'pending');

-- 任务ID索引（联表查询优化）
CREATE INDEX IF NOT EXISTS idx_student_tasks_task_id
ON student_tasks (task_id);

-- ============================================
-- 4. student_moods 表索引优化
-- ============================================

-- 学生 + 心情类型 + 创建时间（查询打卡记录）
CREATE INDEX IF NOT EXISTS idx_student_moods_student_mood_created
ON student_moods (student_id, mood, created_at DESC);

-- 心情类型 + 创建时间（统计用）
CREATE INDEX IF NOT EXISTS idx_student_moods_mood_created
ON student_moods (mood, created_at DESC);

-- 情感标签索引（v14 已有，确保它存在）
CREATE INDEX IF NOT EXISTS idx_student_moods_sentiment_label
ON student_moods (sentiment_label)
WHERE sentiment_label IS NOT NULL;

-- ============================================
-- 5. class_moments 表索引优化
-- ============================================

-- v6 已有 idx_class_moments_student_created_at，添加纯时间索引
CREATE INDEX IF NOT EXISTS idx_class_moments_created_at_desc
ON class_moments (created_at DESC);

-- ============================================
-- 6. student_goals 表索引优化
-- ============================================

-- 学生 + 状态 + 创建时间（查询进行中的目标）
CREATE INDEX IF NOT EXISTS idx_student_goals_student_status_created
ON student_goals (student_id, status, created_at DESC);

-- 学生 + 完成时间（查询已完成目标）
CREATE INDEX IF NOT EXISTS idx_student_goals_student_completed
ON student_goals (student_id, completed_at DESC)
WHERE completed_at IS NOT NULL;

-- ============================================
-- 7. student_badges 表索引优化
-- ============================================

-- v15 已有 idx_student_badges_student，添加时间索引
CREATE INDEX IF NOT EXISTS idx_student_badges_awarded
ON student_badges (student_id, awarded_at DESC);

-- ============================================
-- 8. classes 表索引优化
-- ============================================

-- v15 已有基础索引，添加学校名称索引（支持按学校筛选）
CREATE INDEX IF NOT EXISTS idx_classes_school
ON classes (school_name)
WHERE school_name IS NOT NULL;

-- ============================================
-- 9. 分析和统计索引
-- ============================================

-- 如果存在 challenge_submissions 表
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'challenge_submissions') THEN
        CREATE INDEX IF NOT EXISTS idx_challenge_submissions_student_created
        ON challenge_submissions (student_id, created_at DESC);
    END IF;
END $$;

-- ============================================
-- 10. 查询统计和验证
-- ============================================

-- 查看表大小（确认大表）
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;

-- 查看索引使用情况（运行一段时间后查询）
-- SELECT
--     schemaname,
--     tablename,
--     indexname,
--     idx_scan,
--     idx_tup_read,
--     idx_tup_fetch
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public'
-- ORDER BY idx_scan DESC;
