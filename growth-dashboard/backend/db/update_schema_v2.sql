-- Update Schema V2
-- Run this in Supabase SQL Editor

-- 1. Add fields to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS dream TEXT,
ADD COLUMN IF NOT EXISTS bio TEXT;

-- 2. Add metadata field to student_tasks for storing challenge responses
ALTER TABLE public.student_tasks
ADD COLUMN IF NOT EXISTS response_data JSONB;

-- 3. ensure tasks has a type for challenge
-- (Already exists in V1, but reinforcing)
-- ALTER TABLE public.tasks ALTER COLUMN type SET DEFAULT 'daily';

-- 4. Add Unique Constraint to Badges (for Seeding)
ALTER TABLE public.badges ADD CONSTRAINT badges_name_key UNIQUE (name);
