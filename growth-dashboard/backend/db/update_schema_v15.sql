-- ============================================
-- Schema Update V15: Teacher API performance indexes
-- ============================================

-- Teacher class/student lookups
CREATE INDEX IF NOT EXISTS idx_profiles_role_class_fullname
ON profiles (role, class_id, full_name);

CREATE INDEX IF NOT EXISTS idx_profiles_class_id
ON profiles (class_id);

-- Teacher submissions and review queues
CREATE INDEX IF NOT EXISTS idx_student_tasks_student_completed_at
ON student_tasks (student_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_tasks_student_status
ON student_tasks (student_id, status);

-- Teacher obstacle summary
CREATE INDEX IF NOT EXISTS idx_student_obstacles_student_created_at
ON student_obstacles (student_id, created_at DESC);

-- Analytics distribution queries
CREATE INDEX IF NOT EXISTS idx_goals_student_status
ON goals (student_id, status);

CREATE INDEX IF NOT EXISTS idx_student_badges_student
ON student_badges (student_id);

CREATE INDEX IF NOT EXISTS idx_checkins_student
ON checkins (student_id);

-- Teacher class reads and invite updates
CREATE INDEX IF NOT EXISTS idx_classes_teacher
ON classes (teacher_id);

CREATE INDEX IF NOT EXISTS idx_classes_invite_code
ON classes (invite_code);
