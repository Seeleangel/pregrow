-- ==============================================================================
-- 1. Create function to generate 6-character random invite code
-- ==============================================================================
CREATE OR REPLACE FUNCTION generate_invite_code() RETURNS text AS $$
DECLARE
    chars text[] := '{A,B,C,D,E,F,G,H,J,K,M,N,P,Q,R,S,T,U,V,W,X,Y,Z,2,3,4,5,6,7,8,9}'; -- exclude I,O,L,1,0 for readability
    result text := '';
    i integer := 0;
BEGIN
    FOR i IN 1..6 LOOP
        result := result || chars[1+floor(random()*(array_length(chars, 1)))]::text;
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 2. Create the `classes` table
-- ==============================================================================
CREATE TABLE public.classes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    school_name text NOT NULL,
    invite_code text UNIQUE NOT NULL,
    teacher_id uuid REFERENCES public.profiles(id) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- 3. Add `class_id` column to existing tables
-- ==============================================================================
ALTER TABLE public.profiles ADD COLUMN class_id uuid REFERENCES public.classes(id);
ALTER TABLE public.class_moments ADD COLUMN class_id uuid REFERENCES public.classes(id);

-- ==============================================================================
-- 4. Automatic Data Migration (Smooth transition for existing users)
-- ==============================================================================

-- 4.1 Create classes for all existing teachers
INSERT INTO public.classes (name, school_name, invite_code, teacher_id)
SELECT
    COALESCE(class_name, '默认班级'),
    COALESCE(school_name, '默认学校'),
    generate_invite_code(),
    id
FROM public.profiles
WHERE role = 'teacher';

-- 4.2 Link teachers to their own class
UPDATE public.profiles p
SET class_id = c.id
FROM public.classes c
WHERE c.teacher_id = p.id;

-- 4.3 Link students to classes based on matching school_name and class_name
UPDATE public.profiles p
SET class_id = c.id
FROM public.classes c
WHERE p.role = 'student'
  AND p.school_name = c.school_name
  AND p.class_name = c.name;

-- 4.4 Link existing moments to the creator's class_id
UPDATE public.class_moments cm
SET class_id = p.class_id
FROM public.profiles p
WHERE cm.student_id = p.id;

-- ==============================================================================
-- 5. Enable RLS and setup policies for classes
-- ==============================================================================
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Classes are viewable by everyone" ON public.classes
    FOR SELECT USING (true);

CREATE POLICY "Teachers can insert their own classes" ON public.classes
    FOR INSERT WITH CHECK (auth.uid() = teacher_id);

CREATE POLICY "Teachers can update their own classes" ON public.classes
    FOR UPDATE USING (auth.uid() = teacher_id);
