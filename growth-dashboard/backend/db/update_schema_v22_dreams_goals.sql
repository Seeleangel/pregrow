-- ============================================
-- Schema Update V22: 分离梦想(Dream)和目标(Goal)表
-- ============================================

-- ============================================
-- 1. 创建梦想表 (student_dreams) - 长期愿景
-- ============================================
CREATE TABLE IF NOT EXISTS public.student_dreams (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,                          -- 梦想标题，如"成为摄影师"
    description TEXT,                             -- 梦想描述
    dream_status TEXT DEFAULT 'active'           -- 状态：active, paused, completed
        CHECK (dream_status IN ('active', 'paused', 'completed')),
    priority INTEGER DEFAULT 2                   -- 优先级：1=重点，2=普通，3=低
        CHECK (priority >= 1 AND priority <= 3),
    is_focused BOOLEAN DEFAULT FALSE,            -- 是否为当前专注梦想
    weekly_hours INTEGER DEFAULT 0               -- 每周投入小时数
        CHECK (weekly_hours >= 0 AND weekly_hours <= 40),
    progress INTEGER DEFAULT 0                   -- 进度百分比 0-100
        CHECK (progress >= 0 AND progress <= 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_student_dreams_student_id
    ON student_dreams(student_id);
CREATE INDEX IF NOT EXISTS idx_student_dreams_status
    ON student_dreams(student_id, dream_status);
CREATE INDEX IF NOT EXISTS idx_student_dreams_focused
    ON student_dreams(student_id, is_focused)
    WHERE is_focused = TRUE;

-- ============================================
-- 2. 修改目标表 (student_goals) - 添加梦想外键
-- ============================================
-- 添加 dream_id 外键，关联到 student_dreams
ALTER TABLE student_goals
ADD COLUMN IF NOT EXISTS dream_id UUID REFERENCES student_dreams(id) ON DELETE SET NULL;

-- 添加目标完成状态（与梦想状态区分）
ALTER TABLE student_goals
ADD COLUMN IF NOT EXISTS goal_status TEXT DEFAULT 'active'
    CHECK (goal_status IN ('active', 'completed', 'cancelled'));

-- 添加目标进度
ALTER TABLE student_goals
ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0
    CHECK (progress >= 0 AND progress <= 100);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_student_goals_dream_id
    ON student_goals(dream_id);
CREATE INDEX IF NOT EXISTS idx_student_goals_student_status
    ON student_goals(student_id, goal_status);

-- ============================================
-- 3. 限制：最多同时激活3个梦想
-- ============================================
CREATE OR REPLACE FUNCTION check_active_dreams_limit()
RETURNS TRIGGER AS $$
DECLARE
    active_count INTEGER;
BEGIN
    IF NEW.dream_status = 'active' THEN
        SELECT COUNT(*) INTO active_count
        FROM student_dreams
        WHERE student_id = NEW.student_id
        AND dream_status = 'active';

        IF TG_OP = 'INSERT' AND active_count >= 3 THEN
            RAISE EXCEPTION '最多只能同时激活3个梦想';
        ELSIF TG_OP = 'UPDATE' AND OLD.dream_status != 'active' AND active_count >= 3 THEN
            RAISE EXCEPTION '最多只能同时激活3个梦想';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_check_active_dreams_limit'
    ) THEN
        CREATE TRIGGER trigger_check_active_dreams_limit
        BEFORE INSERT OR UPDATE ON student_dreams
        FOR EACH ROW
        EXECUTE FUNCTION check_active_dreams_limit();
    END IF;
END $$;

-- ============================================
-- 4. 限制：只能有一个专注梦想
-- ============================================
CREATE OR REPLACE FUNCTION ensure_single_focused_dream()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_focused = TRUE THEN
        UPDATE student_dreams
        SET is_focused = FALSE
        WHERE student_id = NEW.student_id
        AND id != NEW.id
        AND is_focused = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_single_focused_dream'
    ) THEN
        CREATE TRIGGER trigger_single_focused_dream
        BEFORE INSERT OR UPDATE ON student_dreams
        FOR EACH ROW
        EXECUTE FUNCTION ensure_single_focused_dream();
    END IF;
END $$;

-- ============================================
-- 5. 自动更新目标进度到梦想进度
-- ============================================
CREATE OR REPLACE FUNCTION update_dream_progress()
RETURNS TRIGGER AS $$
DECLARE
    dream_id_val UUID;
    total_goals INTEGER;
    completed_goals INTEGER;
    new_progress INTEGER;
BEGIN
    -- 获取关联的梦想ID
    dream_id_val := COALESCE(NEW.dream_id, OLD.dream_id);

    IF dream_id_val IS NULL THEN
        RETURN NEW;
    END IF;

    -- 计算该梦想下的目标统计
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE goal_status = 'completed')
    INTO total_goals, completed_goals
    FROM student_goals
    WHERE dream_id = dream_id_val;

    -- 计算进度
    IF total_goals > 0 THEN
        new_progress := (completed_goals * 100 / total_goals);
    ELSE
        new_progress := 0;
    END IF;

    -- 更新梦想进度
    UPDATE student_dreams
    SET progress = new_progress,
        dream_status = CASE
            WHEN new_progress = 100 THEN 'completed'
            WHEN dream_status = 'completed' AND new_progress < 100 THEN 'active'
            ELSE dream_status
        END,
        completed_at = CASE
            WHEN new_progress = 100 AND completed_at IS NULL THEN NOW()
            WHEN new_progress < 100 THEN NULL
            ELSE completed_at
        END,
        updated_at = NOW()
    WHERE id = dream_id_val;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_update_dream_progress'
    ) THEN
        CREATE TRIGGER trigger_update_dream_progress
        AFTER INSERT OR UPDATE OR DELETE ON student_goals
        FOR EACH ROW
        EXECUTE FUNCTION update_dream_progress();
    END IF;
END $$;

-- ============================================
-- 6. 迁移现有数据
-- ============================================
-- 将现有的 student_goals 中带有 dream 字段的数据迁移到 student_dreams
-- 注意：这需要根据实际数据结构调整，这里提供示例逻辑

-- 如果 profiles 表有 dream 字段，迁移到 student_dreams
DO $$
BEGIN
    -- 为每个有 dream 字段的学生创建默认梦想
    INSERT INTO student_dreams (student_id, title, dream_status, priority, is_focused)
    SELECT
        p.id,
        COALESCE(NULLIF(p.dream, ''), '我的成长梦想'),
        'active',
        2,
        TRUE
    FROM profiles p
    WHERE p.dream IS NOT NULL
    AND p.dream != ''
    AND NOT EXISTS (
        SELECT 1 FROM student_dreams d WHERE d.student_id = p.id
    );
EXCEPTION WHEN OTHERS THEN
    -- 如果 profiles 没有 dream 字段，忽略
    NULL;
END $$;

-- ============================================
-- 7. 更新 student_goals 中旧数据的关联
-- ============================================
-- 将没有 dream_id 的 goals 关联到该学生的第一个梦想
UPDATE student_goals g
SET dream_id = (
    SELECT id FROM student_dreams
    WHERE student_id = g.student_id
    ORDER BY created_at DESC
    LIMIT 1
)
WHERE dream_id IS NULL
AND EXISTS (
    SELECT 1 FROM student_dreams
    WHERE student_id = g.student_id
);

-- ============================================
-- 8. RLS 策略（如果启用）
-- ============================================
ALTER TABLE student_dreams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own dreams" ON student_dreams;
CREATE POLICY "Users can view own dreams" ON student_dreams
    FOR SELECT USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Users can insert own dreams" ON student_dreams;
CREATE POLICY "Users can insert own dreams" ON student_dreams
    FOR INSERT WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "Users can update own dreams" ON student_dreams;
CREATE POLICY "Users can update own dreams" ON student_dreams
    FOR UPDATE USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Users can delete own dreams" ON student_dreams;
CREATE POLICY "Users can delete own dreams" ON student_dreams
    FOR DELETE USING (auth.uid() = student_id);
