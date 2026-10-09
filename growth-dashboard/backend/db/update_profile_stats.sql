-- Add stats columns to profiles for easier prototyping
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS streak INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS radar_stats JSONB DEFAULT '[80, 80, 80, 80, 80]';

-- Ensure we have some tasks with categories if we want to get fancy later,
-- but for now we will rely on the profiles.radar_stats for the chart.
