/**
 * 从子代理持久化输出文件中提取 ```json 代码块并落盘到 lessons 目录。
 * 逻辑：逐行扫描，遇含 /lessons/*.json 的行记为当前文件；遇 ```json 块则解析写盘。
 * 用法：node scripts/extract_agent_json.cjs <persisted-file>
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const src = process.argv[2];
if (!src) { console.error("用法: node scripts/extract_agent_json.cjs <文件>"); process.exit(1); }
const text = fs.readFileSync(src, "utf8");
const ROOT = path.resolve(__dirname, "..");
const LESSONS = path.join(ROOT, "classroom", "data", "lessons");

const lines = text.split(/\r?\n/);
let curPath = null, inBlock = false, buf = [], count = 0, fails = [];

const flush = () => {
  if (!buf.length) return;
  const body = buf.join("\n");
  buf = [];
  if (!curPath) { fails.push("无文件标记的 JSON 块"); return; }
  try {
    const obj = JSON.parse(body);
    if (!obj.id || !Array.isArray(obj.scenes)) throw new Error("缺 id/scenes");
    fs.writeFileSync(path.join(LESSONS, path.basename(curPath)), JSON.stringify(obj, null, 2) + "\n");
    count++;
    console.log("落盘:", path.basename(curPath), "| 幕", obj.scenes.length, "| 题", obj.scenes.reduce((a, s) => a + (s.items || []).length, 0));
  } catch (e) { fails.push(path.basename(curPath) + ": " + e.message.slice(0, 70)); }
};

for (const line of lines) {
  const hit = line.match(/(?:[`*\/\s])([A-Za-z0-9_\-]+\.json)\b/);
  if (hit && !line.trim().startsWith("*") === false) { /* 占位 */ }
  if (hit && /lessons|\.json/.test(line) && !/validate/.test(line)) curPath = hit[1];
  if (line.trim().startsWith("```json")) { flush(); inBlock = true; continue; }
  if (line.trim() === "```") { flush(); inBlock = false; continue; }
  if (inBlock) buf.push(line);
}
flush();
console.log(`完成 ${count} 个文件` + (fails.length ? `；失败: ${fails.join("; ")}` : ""));
