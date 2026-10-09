-- Add challenge category classification for optimism scenarios
ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS challenge_category TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tasks_challenge_category_check'
    ) THEN
        ALTER TABLE public.tasks
        ADD CONSTRAINT tasks_challenge_category_check
        CHECK (challenge_category IN ('school', 'home') OR challenge_category IS NULL);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_type_challenge_category
ON public.tasks (type, challenge_category);
