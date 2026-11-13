#!/usr/bin/env node
/**
 * 江山课堂 · 生成服务端计分答案表 classroom/data/answers.json
 *
 * Cloudflare 免费版 Workers 单次请求限 50 个 subrequest，无法逐个抓取 90+ 课件 JSON，
 * 故构建期把全部题目答案打成单文件，供 functions/api/[[route]].js 一次 ASSETS.fetch 加载。
 *
 * 课件变更后重新生成：npm run build:answers（deploy 脚本已自动串联）。
 * 键与 Node 版 server/index.js 一致："课件id#序号" → 答案索引。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "classroom", "data", "lessons");
const OUT = path.join(ROOT, "classroom", "data", "answers.json");

const answers = {};
let lessons = 0;
let count = 0;

for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
  try {
    const lesson = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    let n = 0;
    (lesson.scenes || []).forEach((scene) => {
      if (scene.type !== "quiz") return;
      (scene.items || []).forEach((item) => {
        answers[`${lesson.id}#${n++}`] = item.answer;
      });
    });
    lessons++;
  } catch (e) { /* 跳过坏文件 */ }
}
count = Object.keys(answers).length;

fs.writeFileSync(OUT, JSON.stringify(answers));
console.log(`answers.json 已生成：${lessons} 份课件 / ${count} 题（${fs.statSync(OUT).size} 字节）`);
