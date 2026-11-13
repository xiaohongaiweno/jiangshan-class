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
