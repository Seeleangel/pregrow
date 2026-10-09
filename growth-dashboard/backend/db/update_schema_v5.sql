-- Class moments social features: likes + comments
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.class_moment_comments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    moment_id UUID REFERENCES public.class_moments(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.class_moment_likes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    moment_id UUID REFERENCES public.class_moments(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT class_moment_likes_unique UNIQUE (moment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_class_moment_comments_moment_id ON public.class_moment_comments(moment_id);
CREATE INDEX IF NOT EXISTS idx_class_moment_likes_moment_id ON public.class_moment_likes(moment_id);
