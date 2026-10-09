-- Performance indexes for high-frequency dashboard queries
-- Run after update_schema.sql + v4 + v5 scripts

-- Tasks: list by type / owner / newest first
CREATE INDEX IF NOT EXISTS idx_tasks_type_created_at
ON public.tasks (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_created_by_type_created_at
ON public.tasks (created_by, type, created_at DESC);

-- Student tasks: progress, streak, recent activity
CREATE INDEX IF NOT EXISTS idx_student_tasks_student_created_at
ON public.student_tasks (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_tasks_student_status_completed_at
ON public.student_tasks (student_id, status, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_tasks_student_task_created_at
ON public.student_tasks (student_id, task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_tasks_task_id
ON public.student_tasks (task_id);

-- Moods / check-in
CREATE INDEX IF NOT EXISTS idx_student_moods_student_mood_created_at
ON public.student_moods (student_id, mood, created_at DESC);

-- Badges / goals
CREATE INDEX IF NOT EXISTS idx_student_badges_student_id
ON public.student_badges (student_id);

CREATE INDEX IF NOT EXISTS idx_student_goals_student_status_created_at
ON public.student_goals (student_id, status, created_at DESC);

-- Class moments feed
CREATE INDEX IF NOT EXISTS idx_class_moments_created_at
ON public.class_moments (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_class_moments_student_created_at
ON public.class_moments (student_id, created_at DESC);

-- Social actions
CREATE INDEX IF NOT EXISTS idx_class_moment_likes_student_id
ON public.class_moment_likes (student_id);

CREATE INDEX IF NOT EXISTS idx_class_moment_comments_moment_created_at
ON public.class_moment_comments (moment_id, created_at ASC);
