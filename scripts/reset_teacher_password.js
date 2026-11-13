#!/usr/bin/env node
/**
 * 江山课堂 · 教师密码找回（管理员 CLI）
 *
 * 服务端不存明文密码也不接邮件，教师忘记密码时，请在**部署服务器的本机**运行本脚本重置：
 *
 *   node scripts/reset_teacher_password.js <用户名>            # 自动生成随机新密码并打印
 *   node scripts/reset_teacher_password.js <用户名> <新密码>   # 手动指定新密码（至少 6 位）
 *
 * 环境变量：DB_PATH（默认 server/data/app.db，需与 server/index.js 一致）
 * 依赖：Node >= 22（内置 node:sqlite），零第三方依赖。
 */
"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "server", "data", "app.db");
const username = String(process.argv[2] || "").trim().toLowerCase();
const newPass = process.argv[3] !== undefined ? String(process.argv[3]) : null;

if (!username) {
  console.error("用法：node scripts/reset_teacher_password.js <用户名> [新密码]");
  process.exit(1);
}

let db;
try {
  db = new DatabaseSync(DB_PATH);
} catch (e) {
  console.error(`无法打开数据库 ${DB_PATH}：${e.message}`);
  process.exit(1);
}

const row = db.prepare("SELECT id, username, name FROM users WHERE username = ?").get(username);
if (!row) {
  console.error(`用户「${username}」不存在。`);
  process.exit(1);
}

const password = newPass || (() => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let p = "";
  for (let i = 0; i < 10; i++) p += alphabet[crypto.randomInt(alphabet.length)];
  return p;
})();

if (password.length < 6) {
  console.error("新密码至少 6 位。");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(password, salt, 64).toString("hex");
db.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").run(hash, salt, row.id);
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);

console.log(`已重置用户「${username}」（${row.name}）的密码：${password}`);
if (!newPass) console.log("（随机密码，请立即转告本人并提醒其登录后自行改密）");
console.log("该账号的全部旧会话已吊销。");
