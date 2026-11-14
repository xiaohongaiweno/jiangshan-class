/**
 * 江山课堂 · 服务端（零依赖）
 *
 * 单一用户账号系统（不分教师/学生）：注册 / 登录 / 会话 / 改密 + 站长统计。
 * 班级、任务、提交功能已移除；课件与题池全部前端开放，不依赖登录。
 * 同时托管仓库静态文件（/classroom/*、/*.html 等），一条命令即可跑起整套产品。
 *
 * 依赖：Node >= 22（使用内置 node:sqlite）。
 * 启动：node --no-warnings=ExperimentalWarning server/index.js
 * 环境变量：PORT（默认 8090）、DB_PATH（默认 server/data/app.db）、
 *          COOKIE_SECURE=1（HTTPS 部署时）、ADMIN_TOKEN（站长统计口令，可选）
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8090);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "app.db");
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const SESSION_TTL = 7 * 24 * 3600 * 1000;
const MAX_BODY = 1024 * 1024;

/* ---------------- 数据库 ---------------- */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    name TEXT NOT NULL,
    email TEXT,
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

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,              -- 登录用户 id（未登录为 NULL）
    visitor_id TEXT,           -- 匿名访客 cookie（随机 id，不采集指纹/IP）
    event TEXT NOT NULL,       -- pageview / lesson_open / quiz_answer
    detail TEXT,               -- 页面路径 / 课件 id / 答题正误
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
  CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitor_id);

  DROP TABLE IF EXISTS classes;
  DROP TABLE IF EXISTS tasks;
  DROP TABLE IF EXISTS submissions;
`);

/* 存量库补列（新库由上方 CREATE TABLE 建立） */
for (const ddl of [
  "ALTER TABLE users ADD COLUMN last_login_at INTEGER",
  "ALTER TABLE users ADD COLUMN login_count INTEGER DEFAULT 0"
]) {
  try { db.exec(ddl); } catch (e) { /* 列已存在则忽略 */ }
}

/* ---------------- 工具 ---------------- */
const uid = (p) => p + crypto.randomBytes(9).toString("hex");
const now = () => Date.now();

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, s, 64).toString("hex");
  return { hash, salt: s };
}

function verifyPassword(password, salt, expected) {
  const got = crypto.scryptSync(password, salt, 64);
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function str(v, max = 200) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s.length > max ? s.slice(0, max) : s;
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  raw.split(";").forEach((pair) => {
    const i = pair.indexOf("=");
    if (i < 0) return;
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  }, extraHeaders || {}));
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("请求体过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(Object.assign(new Error("请求体不是合法 JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

/* ---------------- 账号 / 会话 ---------------- */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now(), now() + SESSION_TTL);
  return token;
}

function sessionCookie(token, maxAgeSec) {
  const parts = [
    `sid=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSec}`
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  return parts.join("; ");
}

function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const row = db.prepare(
    "SELECT s.token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"
  ).get(token);
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email || ""
  };
}

/* ---------------- 路由 ---------------- */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

/* 健康检查：前端据此决定「云端 / 离线」模式 */
route("GET", /^\/api\/health$/, (req, res) => {
  sendJson(res, 200, { ok: true, service: "jiangshan-classroom", time: now() });
});

/* --- 站长统计（仅站长：请求头 x-admin-token 与 ADMIN_TOKEN 比对，不落库不记日志） --- */
route("GET", /^\/api\/admin\/stats$/, (req, res) => {
  const token = req.headers["x-admin-token"] || new URL(req.url, "http://x").searchParams.get("token") || "";
  if (!ADMIN_TOKEN) return sendError(res, 404, "未启用管理端点");
  if (token.length !== ADMIN_TOKEN.length || token !== ADMIN_TOKEN) {
    return sendError(res, 403, "口令不正确");
  }
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const users = db.prepare(
    "SELECT username, name, email, created_at, last_login_at, login_count FROM users ORDER BY created_at DESC LIMIT 1000"
  ).all();
  const weekAgo = now() - 7 * 86400000;
  const totals = {
    users: users.length,
    today: users.filter((u) => u.created_at >= dayStart.getTime()).length,
    sessions: db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
    visitors7d: db.prepare(
      "SELECT COUNT(DISTINCT COALESCE(user_id, visitor_id)) AS n FROM events WHERE created_at >= ?"
    ).get(weekAgo).n,
    usersActive7d: db.prepare(
      "SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE created_at >= ? AND user_id IS NOT NULL"
    ).get(weekAgo).n,
    pageviews7d: db.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE event = 'pageview' AND created_at >= ?"
    ).get(weekAgo).n,
    pageviewsToday: db.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE event = 'pageview' AND created_at >= ?"
    ).get(dayStart.getTime()).n
  };
  /* 近 14 天每日浏览（d = UTC 天序号，JS 侧转日期） */
  const daily = db.prepare(
    "SELECT created_at/86400000 AS d, COUNT(*) AS n FROM events WHERE event = 'pageview' AND created_at >= ? GROUP BY d ORDER BY d"
  ).all(now() - 14 * 86400000).map((r) => ({
    date: new Date(r.d * 86400000).toISOString().slice(0, 10), n: r.n
  }));
  const topLessons = db.prepare(
    "SELECT detail, COUNT(*) AS n FROM events WHERE event = 'lesson_open' AND created_at >= ? AND detail GROUP BY detail ORDER BY n DESC LIMIT 8"
  ).all(weekAgo);
  const recent = db.prepare(
    `SELECT e.event, e.detail, e.created_at, u.username
       FROM events e LEFT JOIN users u ON u.id = e.user_id
      ORDER BY e.created_at DESC LIMIT 30`
  ).all();
  sendJson(res, 200, { totals, users, daily, topLessons, recent });
});

/* --- 使用统计上报（匿名/登录皆可；只记事件与随机访客 id，不记 IP 与指纹） --- */
const TRACK_EVENTS = new Set(["pageview", "lesson_open", "quiz_answer", "person_open"]);
route("POST", /^\/api\/track$/, (req, res) => {
  readBody(req).then((body) => {
    const event = str(body.event, 30);
    if (!TRACK_EVENTS.has(event)) return sendError(res, 400, "未知事件");
    const detail = str(body.detail, 120) || null;
    const cookies = parseCookies(req);
    let userId = null;
    if (cookies.sid) {
      const s = db.prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?").get(cookies.sid);
      if (s && s.expires_at > now()) userId = s.user_id;
    }
    let vid = cookies.vid || null;
    const headers = {};
    if (!vid) {
      vid = uid("v");
      const parts = [`vid=${vid}`, "Path=/", "Max-Age=31536000", "HttpOnly", "SameSite=Lax"];
      if (COOKIE_SECURE) parts.push("Secure");
      headers["Set-Cookie"] = parts.join("; ");
    }
    db.prepare(
      "INSERT INTO events (user_id, visitor_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(userId, vid, event, detail, now());
    sendJson(res, 200, { ok: true }, headers);
  }).catch(() => sendError(res, 400, "请求体无效"));
});

/* --- 注册 / 登录 --- */
route("POST", /^\/api\/auth\/register$/, async (req, res) => {
  const body = await readBody(req);
  const username = str(body.username, 40).toLowerCase();
  const name = str(body.name, 30);
  const email = str(body.email, 100).toLowerCase();
  const password = String(body.password || "");
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) return sendError(res, 400, "用户名需为 3–40 位字母、数字或 _ . -");
  if (!name) return sendError(res, 400, "请填写姓名");
  if (!email) return sendError(res, 400, "请填写邮箱");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, "邮箱格式不正确");
  if (password.length < 6) return sendError(res, 400, "密码至少 6 位");
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) {
    return sendError(res, 409, "用户名已被占用");
  }
  const { hash, salt } = hashPassword(password);
  const id = uid("u");
  db.prepare(`INSERT INTO users (id, username, name, email, pass_hash, pass_salt, created_at, last_login_at, login_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(id, username, name, email, hash, salt, now(), now());
  const token = createSession(id);
  sendJson(res, 200, { user: { id, username, name, email } },
    { "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000) });
});

route("POST", /^\/api\/auth\/login$/, async (req, res) => {
  const body = await readBody(req);
  const username = str(body.username, 40).toLowerCase();
  const password = String(body.password || "");
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!row || !verifyPassword(password, row.pass_salt, row.pass_hash)) {
    return sendError(res, 401, "用户名或密码不正确");
  }
  db.prepare("UPDATE users SET last_login_at = ?, login_count = login_count + 1 WHERE id = ?").run(now(), row.id);
  const token = createSession(row.id);
  const user = { id: row.id, username: row.username, name: row.name, email: row.email || "" };
  sendJson(res, 200, { user }, { "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000) });
});

route("POST", /^\/api\/auth\/logout$/, (req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  sendJson(res, 200, { ok: true }, { "Set-Cookie": "sid=; HttpOnly; Path=/; Max-Age=0" });
});

route("GET", /^\/api\/auth\/me$/, (req, res) => {
  sendJson(res, 200, { user: currentUser(req) });
});

/* 修改密码：验证原密码，改毕吊销全部旧会话并重发新 Cookie */
route("POST", /^\/api\/auth\/password$/, async (req, res) => {
  const user = currentUser(req);
  if (!user) return sendError(res, 401, "请先登录");
  const body = await readBody(req);
  const current = String(body.current || "");
  const next = String(body.next || "");
  if (next.length < 6) return sendError(res, 400, "新密码至少 6 位");
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  if (!row || !verifyPassword(current, row.pass_salt, row.pass_hash)) {
    return sendError(res, 401, "原密码不正确");
  }
  const { hash, salt } = hashPassword(next);
  db.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").run(hash, salt, row.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
  const token = createSession(row.id);
  sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000) });
});

/* ---------------- 静态文件 ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".md": "text/plain; charset=utf-8"
};

const DENY_PREFIX = [
  "/server", "/scripts", "/deploy", "/docs", "/skills", "/functions", "/dist",
  "/node_modules", "/.git", "/.codebuddy", "/.env", "/.wrangler", "/.planning",
  "/.idea", "/.rankup", "/.ph-assets", "/.trae-html-share-packages"
];

/* 永不对外提供的文件（basename 精确匹配）与扩展名黑名单 */
const DENY_FILES = new Set([
  "package.json", "package-lock.json", "wrangler.toml", "docker-compose.yml",
  "Dockerfile", ".gitignore", ".dockerignore", "spec.md", "start.md", "tasks.md",
  "README.md", "CONTRIBUTING.md", "CONTRIBUTING_ZH.md", "CODE_OF_CONDUCT.md",
  "LICENSE", "sitemap-gen.md"
]);
const DENY_SUFFIX = [".md", ".yml", ".yaml", ".toml", ".log", ".sqlite", ".sqlite-shm", ".sqlite-wal"];

/* 归一化路径：折叠连续斜杠，避免 //js/app.js 这类变体 404 或绕过检查 */
function normalizePathname(p) {
  return p.replace(/\/{2,}/g, "/");
}

async function serveStatic(req, res, pathname) {
  if (DENY_PREFIX.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return sendError(res, 404, "Not found");
  }
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const seg = rel.split("/").pop();
  if (
    seg.startsWith(".") ||
    DENY_FILES.has(seg) ||
    DENY_SUFFIX.some((s) => seg.toLowerCase().endsWith(s))
  ) {
    return sendError(res, 404, "Not found");
  }
  const file = path.resolve(ROOT, "." + rel);
  if (!file.startsWith(ROOT)) return sendError(res, 403, "Forbidden");

  let stat;
  try {
    stat = await fsp.stat(file);
    if (stat.isDirectory()) {
      return serveStatic(req, res, pathname.replace(/\/?$/, "/") + "index.html");
    }
  } catch (e) {
    return sendError(res, 404, "Not found");
  }

  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=600",
    ETag: etag
  });
  fs.createReadStream(file).pipe(res);
}

/* ---------------- 服务器 ---------------- */
const attempts = new Map();   // 简单登录限流：IP -> {count, resetAt}

function throttled(req) {
  const ip = req.socket.remoteAddress || "?";
  const t = attempts.get(ip);
  const time = now();
  if (!t || t.resetAt < time) {
    attempts.set(ip, { count: 1, resetAt: time + 60_000 });
    return false;
  }
  t.count += 1;
  return t.count > 20;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  /* 手动切分路径：new URL 会把 //js/app.js 误判为协议相对地址（host=js） */
  const qIdx = req.url.indexOf("?");
  const rawPath = qIdx === -1 ? req.url : req.url.slice(0, qIdx);
  const pathname = normalizePathname(rawPath.startsWith("/") ? rawPath : url.pathname);

  try {
    if (pathname.startsWith("/api/")) {
      if (req.method === "POST" && pathname.startsWith("/api/auth/") && throttled(req)) {
        return sendError(res, 429, "尝试过于频繁，请稍后再试");
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(pathname);
        if (!m) continue;
        return await r.handler(req, res, m.slice(1));
      }
      return sendError(res, 404, "接口不存在");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendError(res, 405, "静态资源仅支持 GET");
    }
    return await serveStatic(req, res, pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error("[error]", e);
    if (!res.headersSent) sendError(res, status, e.message || "服务器错误");
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`江山课堂 服务端已启动： http://localhost:${PORT}/classroom/`);
  console.log(`  数据库：${DB_PATH}`);
});

process.on("SIGINT", () => {
  server.close(() => {
    try { db.close(); } catch (e) { /* ignore */ }
    process.exit(0);
  });
});
