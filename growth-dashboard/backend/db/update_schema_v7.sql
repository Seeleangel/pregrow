-- Add dream_tag column to student_goals for per-dream growth tracking
ALTER TABLE public.student_goals ADD COLUMN IF NOT EXISTS dream_tag TEXT;

-- Index for efficient filtering by student + dream
CREATE INDEX IF NOT EXISTS idx_student_goals_dream_tag
ON public.student_goals (student_id, dream_tag);
