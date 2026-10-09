-- Add image_url and options to tasks table
ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS options JSONB;
