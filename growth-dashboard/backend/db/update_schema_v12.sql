-- ============================================
-- Schema Update v12: Add Onboarding Fields
-- 为用户引导系统添加新字段
-- ============================================

-- 添加用户引导相关字段到 profiles 表
alter table profiles add column if not exists onboarding_completed boolean default false;
alter table profiles add column if not exists onboarding_step integer default 0;
alter table profiles add column if not exists bio text;
alter table profiles add column if not exists dream text;

-- 为新用户设置默认值
-- 注意：现有用户的 onboarding_completed 会是 false，会在下次登录时触发引导流程
