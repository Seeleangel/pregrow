-- ============================================
-- Schema Update V21: 多梦想管理字段
-- ============================================

-- 为 student_goals 表添加梦想状态管理字段
ALTER TABLE student_goals
ADD COLUMN IF NOT EXISTS dream_status TEXT DEFAULT 'active'
CHECK (dream_status IN ('active', 'paused', 'completed'));

-- 优先级：1=重点，2=普通
ALTER TABLE student_goals
ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 2
CHECK (priority IN (1, 2));

-- 是否为当前专注梦想
ALTER TABLE student_goals
ADD COLUMN IF NOT EXISTS is_focused BOOLEAN DEFAULT FALSE;

-- 每周投入小时数（用于时间预算）
ALTER TABLE student_goals
ADD COLUMN IF NOT EXISTS weekly_hours INTEGER DEFAULT 0
CHECK (weekly_hours >= 0 AND weekly_hours <= 40);

-- 多梦想总数量限制检查函数
CREATE OR REPLACE FUNCTION check_active_dreams_limit()
RETURNS TRIGGER AS $$
DECLARE
    active_count INTEGER;
BEGIN
    -- 只检查激活状态下的限制
    IF NEW.dream_status = 'active' THEN
        SELECT COUNT(*) INTO active_count
        FROM student_goals
        WHERE student_id = NEW.student_id
        AND dream_status = 'active';

        -- 如果插入/更新后是激活状态，且已有3个或更多激活梦想，则拒绝
        IF TG_OP = 'INSERT' AND active_count >= 3 THEN
            RAISE EXCEPTION '最多只能同时激活3个梦想';
        ELSIF TG_OP = 'UPDATE' AND OLD.dream_status != 'active' AND active_count >= 3 THEN
            RAISE EXCEPTION '最多只能同时激活3个梦想';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_check_active_dreams_limit'
    ) THEN
        CREATE TRIGGER trigger_check_active_dreams_limit
        BEFORE INSERT OR UPDATE ON student_goals
        FOR EACH ROW
        EXECUTE FUNCTION check_active_dreams_limit();
    END IF;
END $$;

-- 确保只有一个专注梦想的触发器
CREATE OR REPLACE FUNCTION ensure_single_focused_dream()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_focused = TRUE THEN
        UPDATE student_goals
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
        BEFORE INSERT OR UPDATE ON student_goals
        FOR EACH ROW
        EXECUTE FUNCTION ensure_single_focused_dream();
    END IF;
END $$;

-- 为现有数据设置默认值
UPDATE student_goals
SET dream_status = 'active'
WHERE dream_status IS NULL;

UPDATE student_goals
SET priority = 2
WHERE priority IS NULL;

-- 添加索引优化多梦想查询
CREATE INDEX IF NOT EXISTS idx_student_goals_status_priority
ON student_goals(student_id, dream_status, priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_goals_focused
ON student_goals(student_id, is_focused)
WHERE is_focused = TRUE;
