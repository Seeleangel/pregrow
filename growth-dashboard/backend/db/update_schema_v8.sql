-- Add student obstacles table for dream blockers tracking
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.student_obstacles (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    dream_tag TEXT,
    obstacle_type TEXT NOT NULL DEFAULT 'other',
    content TEXT NOT NULL,
    severity INT NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'todo',
    ai_tip TEXT,
    linked_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT student_obstacles_severity_check CHECK (severity >= 1 AND severity <= 5),
    CONSTRAINT student_obstacles_status_check CHECK (status IN ('todo', 'in_progress', 'resolved')),
    CONSTRAINT student_obstacles_type_check CHECK (obstacle_type IN ('time', 'capability', 'resource', 'emotion', 'social', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_obstacles_student_dream_created
ON public.student_obstacles (student_id, dream_tag, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_obstacles_student_status
ON public.student_obstacles (student_id, status);

CREATE INDEX IF NOT EXISTS idx_obstacles_student_updated
ON public.student_obstacles (student_id, updated_at DESC);
