-- ============================================
-- Schema Update V23: 添加时间追踪功能
-- ============================================

-- ============================================
-- 1. 为目标表添加实际投入时间记录
-- ============================================
ALTER TABLE student_goals
ADD COLUMN IF NOT EXISTS actual_hours INTEGER DEFAULT 0
    CHECK (actual_hours >= 0 AND actual_hours <= 1000);

-- 添加最后记录时间，用于追踪本周投入
ALTER TABLE student_goals
ADD COLUMN IF NOT EXISTS last_logged_at TIMESTAMP WITH TIME ZONE;

-- ============================================
-- 2. 为梦想表添加本周实际投入统计
-- ============================================
ALTER TABLE student_dreams
ADD COLUMN IF NOT EXISTS actual_weekly_hours INTEGER DEFAULT 0
    CHECK (actual_weekly_hours >= 0 AND actual_weekly_hours <= 168);

-- 添加本周投入更新时间
ALTER TABLE student_dreams
ADD COLUMN IF NOT EXISTS weekly_updated_at TIMESTAMP WITH TIME ZONE;

-- ============================================
-- 3. 创建时间记录表（详细记录每次投入）
-- ============================================
CREATE TABLE IF NOT EXISTS public.goal_time_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    goal_id UUID REFERENCES public.student_goals(id) ON DELETE CASCADE,
    dream_id UUID REFERENCES public.student_dreams(id) ON DELETE SET NULL,
    minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 480),  -- 单次最多8小时
    log_date DATE DEFAULT CURRENT_DATE,  -- 记录日期
    note TEXT,  -- 备注（可选）
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_goal_time_logs_student_id
    ON goal_time_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_goal_time_logs_goal_id
    ON goal_time_logs(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_time_logs_date
    ON goal_time_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_goal_time_logs_student_date
    ON goal_time_logs(student_id, log_date);

-- ============================================
-- 4. 自动更新目标实际时间的函数
-- ============================================
CREATE OR REPLACE FUNCTION update_goal_actual_hours()
RETURNS TRIGGER AS $$
BEGIN
    -- 更新目标的实际时间
    UPDATE student_goals
    SET actual_hours = COALESCE(actual_hours, 0) + NEW.minutes / 60.0,
        last_logged_at = NOW()
    WHERE id = NEW.goal_id;

    -- 更新梦想的实际时间（本周）
    UPDATE student_dreams
    SET actual_weekly_hours = COALESCE(actual_weekly_hours, 0) + NEW.minutes / 60.0,
        weekly_updated_at = NOW()
    WHERE id = NEW.dream_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器
DROP TRIGGER IF EXISTS trigger_update_goal_actual_hours ON goal_time_logs;
CREATE TRIGGER trigger_update_goal_actual_hours
    AFTER INSERT ON goal_time_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_goal_actual_hours();

-- ============================================
-- 5. 每周自动重置梦想实际时间（可选，通过cron或应用层调用）
-- ============================================
CREATE OR REPLACE FUNCTION reset_weekly_actual_hours()
RETURNS void AS $$
BEGIN
    UPDATE student_dreams
    SET actual_weekly_hours = 0,
        weekly_updated_at = NOW()
    WHERE weekly_updated_at < DATE_TRUNC('week', NOW());
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. RLS 策略
-- ============================================
ALTER TABLE goal_time_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own time logs" ON goal_time_logs;
CREATE POLICY "Users can view own time logs" ON goal_time_logs
    FOR SELECT USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Users can insert own time logs" ON goal_time_logs;
CREATE POLICY "Users can insert own time logs" ON goal_time_logs
    FOR INSERT WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "Users can update own time logs" ON goal_time_logs;
CREATE POLICY "Users can update own time logs" ON goal_time_logs
    FOR UPDATE USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Users can delete own time logs" ON goal_time_logs;
CREATE POLICY "Users can delete own time logs" ON goal_time_logs
    FOR DELETE USING (auth.uid() = student_id);
