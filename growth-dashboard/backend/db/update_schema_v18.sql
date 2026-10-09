-- =============================================
-- v18: 学生提交材料审核链路
-- =============================================

ALTER TABLE public.student_tasks
  ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES public.student_goals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proof_note TEXT;

CREATE INDEX IF NOT EXISTS idx_student_tasks_goal_id
  ON public.student_tasks(goal_id);

CREATE INDEX IF NOT EXISTS idx_student_tasks_student_status_completed
  ON public.student_tasks(student_id, status, completed_at DESC);

DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'student_tasks'
      AND c.contype = 'c'
  LOOP
    IF constraint_record.def ILIKE '%status%' THEN
      EXECUTE format('ALTER TABLE public.student_tasks DROP CONSTRAINT %I', constraint_record.conname);
    END IF;
  END LOOP;

  ALTER TABLE public.student_tasks
    ADD CONSTRAINT student_tasks_status_check
    CHECK (status IN ('pending', 'submitted', 'completed', 'verified', 'rejected', 'removed', 'active'));
END
$$;
