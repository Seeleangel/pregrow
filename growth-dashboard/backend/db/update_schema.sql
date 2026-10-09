-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tasks Table (Assignments/Challenges)
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    type VARCHAR(50) DEFAULT 'daily', -- 'daily', 'challenge', 'homework'
    points_reward INT DEFAULT 10,
    created_by UUID REFERENCES auth.users(id), -- Teacher who created it
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Student Task Progress
CREATE TABLE IF NOT EXISTS public.student_tasks (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'completed', 'verified'
    proof_url TEXT, -- Image/Video URL
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Student Mood Logs
CREATE TABLE IF NOT EXISTS public.student_moods (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    mood VARCHAR(50) NOT NULL, -- 'happy', 'neutral', 'sad', 'angry'
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Class Moments (Social Feed)
CREATE TABLE IF NOT EXISTS public.class_moments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'achievement', -- 'achievement', 'share', 'teacher_note'
    media_url TEXT,
    likes INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Badges/Stickers
CREATE TABLE IF NOT EXISTS public.badges (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL, -- Emoji or URL
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Student Badges (Many-to-Many)
CREATE TABLE IF NOT EXISTS public.student_badges (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    badge_id UUID REFERENCES public.badges(id) ON DELETE CASCADE,
    awarded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS Policies (Basic)
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_moods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_moments ENABLE ROW LEVEL SECURITY;

-- Allow read access to everyone for now (for simplicity during dev), restrict write
CREATE POLICY "Allow read access for all users" ON public.tasks FOR SELECT USING (true);
CREATE POLICY "Allow read access for all users" ON public.class_moments FOR SELECT USING (true);
