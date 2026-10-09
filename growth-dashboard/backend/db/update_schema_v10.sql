-- Drop the previous constraint on challenge_category if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tasks_challenge_category_check'
    ) THEN
        ALTER TABLE public.tasks
        DROP CONSTRAINT tasks_challenge_category_check;
    END IF;
END $$;
