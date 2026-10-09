-- ==============================================================================
-- Update Schema V16: Indexes for Teacher Dashboard Optimizations
-- ==============================================================================

-- 1. 优化提交记录查询 (近期完成的任务)
-- 经常使用的条件: in('student_id', ...) & gte('completed_at', ...) & order('completed_at', { ascending: false })
CREATE INDEX IF NOT EXISTS idx_student_tasks_student_completed ON public.student_tasks (student_id, completed_at DESC);

-- 2. 优化任务状态查询
-- 经常使用的条件: in('id', ...) & in('student_id', ...)
CREATE INDEX IF NOT EXISTS idx_student_tasks_status ON public.student_tasks (student_id, status);

-- 3. 优化学生学习障碍 / 困难度查询
-- 经常使用的条件: in('student_id', ...) & gte('created_at', ...)
CREATE INDEX IF NOT EXISTS idx_student_obstacles_student_created ON public.student_obstacles (student_id, created_at DESC);

-- 4. 优化特定状态的障碍查询
CREATE INDEX IF NOT EXISTS idx_student_obstacles_status ON public.student_obstacles (status);
