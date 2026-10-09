-- ============================================
-- Schema Update v14: Add Sentiment Analysis Fields
-- 为心情记录添加情感分析字段
-- ============================================

-- 为 student_moods 表添加情感分析字段
ALTER TABLE student_moods
ADD COLUMN IF NOT EXISTS sentiment_score float DEFAULT 0.5,
ADD COLUMN IF NOT EXISTS sentiment_label text DEFAULT 'neutral';

-- 添加索引以提高情感分析查询性能
CREATE INDEX IF NOT EXISTS student_moods_sentiment_label_idx ON student_moods(sentiment_label);

-- 注释说明字段用途
COMMENT ON COLUMN student_moods.sentiment_score IS '情感得分: 0-1之间，0最消极，1最积极';
COMMENT ON COLUMN student_moods.sentiment_label IS '情感标签: positive/negative/neutral';
