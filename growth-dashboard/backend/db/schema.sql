-- Create a table for public profiles
create table profiles (
  id uuid references auth.users not null primary key,
  updated_at timestamp with time zone,
  role text check (role in ('student', 'teacher')),
  full_name text,
  school_name text,
  class_name text,
  invite_code text,
  avatar_url text,

  -- 用户引导相关字段
  onboarding_completed boolean default false,
  onboarding_step integer default 0,
  bio text,
  dream text
);

-- Set up Row Level Security (RLS)
-- See https://supabase.com/docs/guides/auth/row-level-security for more details.
alter table profiles enable row level security;

create policy "Public profiles are viewable by everyone." on profiles
  for select using (true);

create policy "Users can insert their own profile." on profiles
  for insert with check (auth.uid() = id);

create policy "Users can update own profile." on profiles
  for update using (auth.uid() = id);
