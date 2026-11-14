-- 江山课堂 · Cloudflare D1 数据库 schema（与 server/index.js 内嵌 schema 一致）
-- 单一用户账号系统（不分教师/学生）：仅 users + sessions 两张表。
-- 应用：wrangler d1 execute jiangshan-classroom --remote --file server/schema.sql
-- 本地：wrangler d1 execute jiangshan-classroom --local --file server/schema.sql
-- 存量库清理（旧版班级/任务/提交）：
--   DROP TABLE IF EXISTS submissions; DROP TABLE IF EXISTS tasks;
--   DROP TABLE IF EXISTS classes; DROP TABLE IF EXISTS users;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT,                -- 注册必填（仅存量用户可能为 NULL）
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 使用统计（匿名访客以随机 cookie vid 计数，不记录 IP 与指纹）
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,              -- 登录用户 id（未登录为 NULL）
  visitor_id TEXT,           -- 匿名访客随机 id
  event TEXT NOT NULL,       -- pageview / lesson_open / quiz_answer / person_open
  detail TEXT,               -- 页面路径 / 课件 id / 答题正误
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitor_id);

-- 存量库补列（重复执行报 duplicate column 可忽略）：
--   ALTER TABLE users ADD COLUMN last_login_at INTEGER;
--   ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0;
