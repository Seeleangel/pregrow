-- =============================================
-- v17: 教师日程安排表
-- =============================================

CREATE TABLE IF NOT EXISTS teacher_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 按教师+日期查询的索引
CREATE INDEX IF NOT EXISTS idx_teacher_schedules_teacher_date
    ON teacher_schedules (teacher_id, scheduled_date);

-- RLS 策略
ALTER TABLE teacher_schedules ENABLE ROW LEVEL SECURITY;

-- 教师只能操作自己的日程
CREATE POLICY teacher_schedules_select ON teacher_schedules
    FOR SELECT USING (auth.uid() = teacher_id);

CREATE POLICY teacher_schedules_insert ON teacher_schedules
    FOR INSERT WITH CHECK (auth.uid() = teacher_id);

CREATE POLICY teacher_schedules_update ON teacher_schedules
    FOR UPDATE USING (auth.uid() = teacher_id);

CREATE POLICY teacher_schedules_delete ON teacher_schedules
    FOR DELETE USING (auth.uid() = teacher_id);
