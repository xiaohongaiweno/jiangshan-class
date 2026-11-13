#!/usr/bin/env node
/**
 * 江山课堂 · Cloudflare D1 版用户密码重置
 *
 * 与 Node 版 scripts/reset_teacher_password.js 等价，但目标是 Cloudflare D1：
 * 本脚本计算 PBKDF2 哈希并生成 SQL，再用 wrangler 在远程 D1 上执行。
 *
 * 用法：
 *   node scripts/cf_reset_teacher_password.mjs <用户名>            # 自动生成随机密码并打印
 *   node scripts/cf_reset_teacher_password.mjs <用户名> <新密码>   # 手动指定（至少 6 位）
 *
 * 实际执行（脚本会打印）：
 *   wrangler d1 execute jiangshan-classroom --remote --command "<SQL>"
 */
"use strict";

import crypto from "node:crypto";

const username = String(process.argv[2] || "").trim().toLowerCase();
const newPass = process.argv[3] !== undefined ? String(process.argv[3]) : null;

if (!username) {
  console.error("用法：node scripts/cf_reset_teacher_password.mjs <用户名> [新密码]");
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
const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha256").toString("hex");

const sql =
  `UPDATE users SET pass_hash='${hash}', pass_salt='${salt}' WHERE username='${username}'; ` +
  `DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username='${username}');`;

console.log(`已为「${username}」生成新密码：${password}`);
if (!newPass) console.log("（随机密码，请立即转告本人并提醒其登录后自行改密）");
console.log("\n请执行以下命令使其生效：\n");
console.log(`wrangler d1 execute jiangshan-classroom --remote --command "${sql}"`);
