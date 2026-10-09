-- ============================================
-- Schema Update v13: Add Notifications Table
-- 添加通知系统表
-- ============================================

-- 创建通知表
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  type text not null,
  title text not null,
  content text,
  data jsonb,
  is_read boolean default false,
  created_at timestamp with time zone default now()
);

-- 添加索引以提高查询性能
create index if not exists notifications_user_id_idx on notifications(user_id);
create index if not exists notifications_is_read_idx on notifications(is_read);
create index if not exists notifications_created_at_idx on notifications(created_at desc);

-- 设置 RLS
alter table notifications enable row level security;

-- 用户只能查看自己的通知
create policy "Users can view own notifications" on notifications
  for select using (auth.uid() = user_id);

-- 用户只能更新自己的通知（标记已读）
create policy "Users can update own notifications" on notifications
  for update using (auth.uid() = user_id);

-- 用户可以删除自己的通知
create policy "Users can delete own notifications" on notifications
  for delete using (auth.uid() = user_id);

-- 服务端可以通过 service role 插入通知
-- (使用 supabaseAdmin 可以绕过 RLS)
