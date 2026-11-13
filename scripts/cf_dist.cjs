/**
 * 江山时序 · Cloudflare Pages 部署产物构建（零依赖）
 *
 * 按白名单把「站点运行时真正需要的文件」复制到 dist/，
 * 排除 data/（24MB 教研数据）、docs/、scripts/、skills/、server/ 等
 * 仓库内容，控制首次上传体积与后续增量。
 *
 * 运行：node scripts/cf_dist.cjs   （产物目录 dist/，随 wrangler pages deploy 上传）
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

/* 允许上传的文件（文件或目录，相对仓库根） */
const ALLOW = [
  "index.html",
  "sw.js",
  "manifest.webmanifest",
  "llms.txt",
  "robots.txt",
  "sitemap.xml",
  "LICENSE",
  "css",
  "js",
  "assets",
  "classroom",
  "topics",
  "geojson"
];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let files = 0;
function copy(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copy(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.copyFileSync(src, dest);
    files++;
  }
}

for (const name of ALLOW) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) {
    console.warn(`[warn] 跳过不存在的条目：${name}`);
    continue;
  }
  copy(src, path.join(DIST, name));
}

console.log(`dist/ 构建完成：${files} 个文件`);
