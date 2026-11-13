/**
 * 江山课堂 · Cloudflare Pages Functions 版 API
 *
 * 单一用户账号系统（不分教师/学生）：注册 / 登录 / 会话 / 改密 + 站长统计。
 * 班级、任务、提交功能已移除；课件与题池全部前端开放，不依赖登录。
 *
 * 绑定：
 *   env.DB     D1 数据库（jiangshan-classroom，schema 见 server/schema.sql）
 * 变量：
 *   env.COOKIE_SECURE  "0" 关闭 Secure Cookie（本地 http 调试用，线上默认开启）
 *   env.ADMIN_TOKEN    站长统计口令（未设置则 /api/admin/stats 返回 404）
 *
 * 与 Node 版差异：node:sqlite → D1；scrypt → PBKDF2-SHA256（100k 次迭代，64 字节）；
 * node:crypto 随机数 → crypto.getRandomValues。
 */
"use strict";

const SESSION_TTL = 7 * 24 * 3600 * 1000;
const MAX_BODY = 1024 * 1024;
const PBKDF2_ITER = 100000;

/* ---------------- 基础工具 ---------------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const err = (status, message) => { throw new HttpError(status, message); };

function json(obj, status = 200, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }, extraHeaders || {})
  });
}

function str(v, max = 200) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s.length > max ? s.slice(0, max) : s;
}

function parseCookies(request) {
  const out = {};
  const raw = request.headers.get("Cookie") || "";
  raw.split(";").forEach((pair) => {
    const i = pair.indexOf("=");
    if (i < 0) return;
    out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

function sessionCookie(token, maxAgeSec, secure) {
  const parts = [
    `sid=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSec}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) err(413, "请求体过大");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    err(400, "请求体不是合法 JSON");
  }
}

const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const uid = (p) => p + bytesToHex(rand(9));
const now = () => Date.now();

/* ---------------- 密码：PBKDF2-SHA256（Web Crypto） ---------------- */
async function hashPassword(password, salt) {
  const s = salt || bytesToHex(rand(16));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(s), iterations: PBKDF2_ITER },
    key, 512
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: s };
}

async function verifyPassword(password, salt, expected) {
  const { hash } = await hashPassword(password, salt);
  if (hash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/* ---------------- 会话（D1 存储） ---------------- */
async function createSession(db, userId) {
  const token = bytesToHex(rand(32));
  await db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, userId, now(), now() + SESSION_TTL).run();
  return token;
}

async function currentUser(request, db, secure) {
  const token = parseCookies(request).sid;
  if (!token) return null;
  const row = await db.prepare(
    "SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at < now()) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email || "",
    _token: token,
    _secure: secure
  };
}

async function requireUser(c) {
  const user = await currentUser(c.request, c.env.DB, c.secure);
  if (!user) err(401, "请先登录");
  return user;
}

/* ---------------- 登录限流（isolate 级，尽力而为） ---------------- */
const attempts = new Map();

function throttled(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "?";
  const t = attempts.get(ip);
  const time = now();
  if (!t || t.resetAt < time) {
    attempts.set(ip, { count: 1, resetAt: time + 60000 });
    return false;
  }
  t.count += 1;
  return t.count > 20;
}

/* ---------------- 路由 ---------------- */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

/* 健康检查：前端据此决定「云端 / 离线」模式 */
route("GET", /^\/api\/health$/, async (c) => {
  return json({ ok: true, service: "jiangshan-classroom", time: now() });
});

/* --- 站长统计（仅站长：请求头 x-admin-token 与 env.ADMIN_TOKEN 比对，不落库不记日志） --- */
route("GET", /^\/api\/admin\/stats$/, async (c) => {
  const token = c.request.headers.get("x-admin-token")
    || new URL(c.request.url).searchParams.get("token") || "";
  if (!c.env.ADMIN_TOKEN) err(404, "未启用管理端点");
  const expected = String(c.env.ADMIN_TOKEN);
  if (token.length !== expected.length || token !== expected) err(403, "口令不正确");
  const db = c.env.DB;
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const users = await db.prepare(
    "SELECT username, name, email, created_at FROM users ORDER BY created_at DESC LIMIT 1000"
  ).all();
  const totals = {
    users: users.results.length,
    today: users.results.filter((u) => u.created_at >= dayStart.getTime()).length,
    sessions: (await db.prepare("SELECT COUNT(*) AS n FROM sessions").first()).n
  };
  return json({ totals, users: users.results });
});

/* --- 注册 / 登录 --- */
route("POST", /^\/api\/auth\/register$/, async (c) => {
  const body = await readBody(c.request);
  const username = str(body.username, 40).toLowerCase();
  const name = str(body.name, 30);
  const email = str(body.email, 100).toLowerCase();
  const password = String(body.password || "");
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) err(400, "用户名需为 3–40 位字母、数字或 _ . -");
  if (!name) err(400, "请填写姓名");
  if (!email) err(400, "请填写邮箱");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(400, "邮箱格式不正确");
  if (password.length < 6) err(400, "密码至少 6 位");
  const db = c.env.DB;
  if (await db.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first()) {
    err(409, "用户名已被占用");
  }
  const { hash, salt } = await hashPassword(password);
  const id = uid("u");
  await db.prepare(`INSERT INTO users (id, username, name, email, pass_hash, pass_salt, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, username, name, email, hash, salt, now()).run();
  const token = await createSession(db, id);
  return json({ user: { id, username, name, email } },
    200, { "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000, c.secure) });
});

route("POST", /^\/api\/auth\/login$/, async (c) => {
  const body = await readBody(c.request);
  const username = str(body.username, 40).toLowerCase();
  const password = String(body.password || "");
  const row = await c.env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  if (!row || !(await verifyPassword(password, row.pass_salt, row.pass_hash))) {
    err(401, "用户名或密码不正确");
  }
  const token = await createSession(c.env.DB, row.id);
  const user = { id: row.id, username: row.username, name: row.name, email: row.email || "" };
  return json({ user }, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000, c.secure) });
});

route("POST", /^\/api\/auth\/logout$/, async (c) => {
  const token = parseCookies(c.request).sid;
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true }, 200, { "Set-Cookie": "sid=; HttpOnly; Path=/; Max-Age=0" });
});

route("GET", /^\/api\/auth\/me$/, async (c) => {
  const user = await currentUser(c.request, c.env.DB, c.secure);
  if (!user) return json({ user: null });
  return json({ user: { id: user.id, username: user.username, name: user.name, email: user.email } });
});

/* 修改密码：验证原密码，改毕吊销全部旧会话并重发新 Cookie */
route("POST", /^\/api\/auth\/password$/, async (c) => {
  const user = await requireUser(c);
  const body = await readBody(c.request);
  const current = String(body.current || "");
  const next = String(body.next || "");
  if (next.length < 6) err(400, "新密码至少 6 位");
  const db = c.env.DB;
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
  if (!row || !(await verifyPassword(current, row.pass_salt, row.pass_hash))) {
    err(401, "原密码不正确");
  }
  const { hash, salt } = await hashPassword(next);
  await db.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").bind(hash, salt, row.id).run();
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id).run();
  const token = await createSession(db, row.id);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token, SESSION_TTL / 1000, c.secure) });
});

/* ---------------- 入口 ---------------- */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const secure = env.COOKIE_SECURE !== "0";
  const c = { request, env, secure, params: [] };
  try {
    if (request.method === "POST" && url.pathname.startsWith("/api/auth/") && throttled(request)) {
      return json({ error: "尝试过于频繁，请稍后再试" }, 429);
    }
    for (const r of routes) {
      if (r.method !== request.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      c.params = m.slice(1);
      return await r.handler(c);
    }
    return json({ error: "接口不存在" }, 404);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[api]", url.pathname, e);
    return json({ error: e.message || "服务器错误" }, status);
  }
}
