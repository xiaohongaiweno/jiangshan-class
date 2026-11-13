# 江山课堂 · 启动与使用说明

本仓库有两种运行形态，**同一套页面**自动适配：

| 形态 | 启动方式 | 账号体系 | 适用场景 |
|---|---|---|---|
| 服务端模式（推荐） | `npm start` | 有（登录、班级、在线成绩） | 真实课堂布置作业、收成绩 |
| 纯静态模式 | 任意静态服务器 | 无（本机离线包） | 只看课件/地图/题池，或无法部署 Node |

判断依据：页面会请求 `/api/health`，通则走账号版，不通自动回落离线版（不会白屏报错）。

要部署到公网、比较 Cloudflare / Vercel / 云主机的成本与改造量，直接看第 7 节。

---

## 1. 环境要求

- **Node.js ≥ 22**（服务端用内置 `node:sqlite`，因此**零依赖**，不需要 `npm install`）
- 或 **Docker**（不想装 Node 时）
- 纯静态模式：任何静态文件服务器即可（如 `python3`）

检查版本：

```bash
node -v      # 需要 v22 及以上
```

---

## 2. 启动

### 方式 A：服务端模式（含账号体系）

```bash
cd jiangshan-map
npm start
```

等价命令：`npm run server` 或 `node --no-warnings=ExperimentalWarning server/index.js`。

启动后访问：

- 课堂首页：`http://localhost:8090/classroom/`
- 登录页：`http://localhost:8090/classroom/login.html`
- 主地图：`http://localhost:8090/`

说明：

- 服务端**同时托管整站静态文件**，所以只需这一个进程，不用另外起 nginx/python。
- 首次启动自动建库：`server/data/app.db`（SQLite，已在 `.gitignore` 中）。
- 换端口：`PORT=8080 npm start`。
- 停止：终端 `Ctrl + C`。

### 方式 B：纯静态模式（无账号）

```bash
cd jiangshan-map
python3 -m http.server 8000
```

访问 `http://localhost:8000/classroom/`。

此时登录页会提示「未检测到服务端」，请改用离线模式：

- 教师：`classroom/teacher.html`（数据存浏览器本机 localStorage）
- 学生：老师发的 `task.html?t=...` 链接，交卷后**下载结果 JSON** 回传，教师在工作台导入汇总

### 方式 C：Docker

```bash
# 带账号体系（推荐）
docker compose up -d --build jiangshan-classroom
# → http://localhost:8090/classroom/ ，数据存在 jiangshan-data 卷中

# 仅静态站点（无账号）
docker compose up -d --build jiangshan-map
# → http://localhost:8008
```

---

## 3. 教师怎么用

1. 打开 `http://localhost:8090/classroom/login.html`，选「**教师注册**」。
   - 用户名：3–40 位字母、数字或 `_ . -`（不区分大小写）
   - 姓名：显示用，如「王老师」；密码：至少 6 位
2. 进入**教师工作台**，在左侧「新建」一个班级（如 `八(3)班`）。班级会自动获得一个 **6 位加入码**（如 `9RF2BW`），显示在班级名下方。
3. 布置任务：
   - 选册 → 单元 → 课（三级联动），页面提示「该范围共 N 题」
   - 设题量（1–50）、模式（不限时 / 每题 30 秒限时）、截止日期、老师说明
   - 点「生成任务链接」：**云端模式**生成 `task.html?id=...`，全班同一套题（seed 固定）
4. 把**加入码**发给学生，或直接把任务链接/加入码一起发到班级群。
5. 收成绩：任务行点「**查看成绩**」→ 实时表格（姓名、学号、得分、正确率、用时、提交时间、是否逾期）+ 统计卡（提交人数、平均分、最高分、及格率、逾期数）→「导出 CSV」（Excel 可直接打开）。
6. 删除任务/班级会连带删除其成绩与班级内学生账号（有确认弹窗）。

> 教师注册默认开放。若部署在公网并希望关闭自助注册：**先注册好账号**，再用 `ALLOW_TEACHER_REGISTER=0 npm start` 启动。

---

## 4. 学生怎么用

1. 打开老师给的链接（或 `http://<服务器地址>:8090/classroom/login.html`）。
2. 首次使用选「**学生加入**」：填班级码、姓名、学号（建议填）、自设密码（至少 4 位）→ 直接进入「我的任务」。
3. 点任务「**开始作答**」→ 逐题作答（限时模式每题 30 秒自动判错）→ 交卷（还有未答题会二次确认）。
4. 提交后立即出分并显示排名；该任务**只能提交一次**，不能重做。
5. 以后再登录：选「**学生登录**」，用「班级码 + 学号/姓名 + 密码」。
6. 「我的任务」列表会显示每个任务的提交状态与得分。

规则说明：

- 得分由**服务端按题库答案重算**，前端上报的分数不作数；题量必须与任务一致，否则拒绝提交。
- 截止日按当天 23:59:59 计算，之后仍可提交，但成绩标记为「逾期」。
- 同一班级内姓名/学号重复时无法重复加入，请直接用「学生登录」。

---

## 5. 数据、备份与重置

- 数据库：`server/data/app.db`（SQLite，WAL 模式，已排除在版本库外）。
- 备份：停止服务后整目录拷贝 `server/data/`（含 `app.db-wal`、`app.db-shm`）。
- 重置：停止服务，删除 `server/data/` 目录，重启即得到空库（**所有账号、班级、任务、成绩都会清空**）。
- 迁移：把 `server/data/` 一起拷到新机器，或 Docker 场景保留 `jiangshan-data` 卷。

---

## 6. 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8090` | 监听端口 |
| `DB_PATH` | `server/data/app.db` | SQLite 文件路径（Docker 中为 `/data/app.db`） |
| `ALLOW_TEACHER_REGISTER` | `1` | 设为 `0` 关闭教师自助注册 |
| `COOKIE_SECURE` | 未设置 | 设为 `1` 时会话 Cookie 带 `Secure`，**仅在 HTTPS 下开启** |

示例：

```bash
PORT=8080 ALLOW_TEACHER_REGISTER=0 COOKIE_SECURE=1 npm start
```

---

## 7. 部署方案与成本（Cloudflare / Vercel / 云主机）

一句话结论：**静态部分（课件、地图、题池、对照轴）Cloudflare Pages 完全免费且额度比 Vercel 宽松；带账号的服务端不能原样上传，要么改代码上 Cloudflare/Vercel，要么用境内轻量云主机（约百元级一年）零改造部署。**

### 7.1 服务端的三项硬依赖（为什么不能直接部署）

| 依赖 | 现状 | Cloudflare Workers | Vercel Functions |
|---|---|---|---|
| 长驻 `http.createServer().listen()` | 有 | 不支持（只有 `fetch` 模型） | 不支持（每请求起一个函数） |
| 本地 SQLite 文件（`node:sqlite`） | `server/data/app.db` | 无文件系统，需改 D1 | 文件系统只读，需改 Turso/Neon |
| `crypto.scryptSync` 密码哈希 | 有 | 无 scrypt，只能 PBKDF2；免费版 10ms CPU/请求 易超限 | Node runtime 支持，无影响 |
| 读本地文件托管静态页 | 有 | 由 Pages 托管，更省事 | 由静态部署托管 |

改造面：`server/index.js` 约 835 行、43 处 `db.prepare`。**前端无需改动**——所有请求都是同源 `/api/*`，同域部署天然可用。

### 7.2 平台对比

| 方案 | 费用（以官网为准） | 能否零改造 | 在线收卷 | 国内访问 |
|---|---|---|---|---|
| Cloudflare Pages（纯静态） | 免费，带宽/请求不计量 | 能 | 不支持，走离线 JSON 回传 | 一般，`pages.dev` 域名常被干扰 |
| Cloudflare Pages + Functions + D1 | 免费额度约 10 万请求/天、D1 5GB | 需改造 0.5–1 天 | 支持 | 同上 |
| Vercel Hobby + Turso/Neon | 免费，约 100GB 流量/月 | 需改造 | 支持 | 一般；Hobby 条款限个人非商业，学校用途建议申请教育计划 |
| 境内轻量云主机 + Docker | 新用户约 ¥50–100/年，常规 2C2G 约 ¥300–600/年；域名 ¥30–80/年 | **能** | 支持 | 最快；绑定域名需备案（1–2 周） |
| 香港/新加坡 VPS | $3–6/月 | 能 | 支持 | 延迟 30–100ms，可接受；免备案 |

### 7.3 体积与带宽实测

- 站点静态体积约 **53MB**（`data` 24MB、`assets` 24MB、`js` 4.5MB），但按需加载，不是每次全下。
- 首屏约 `index.html` 84KB + `app.js` 628KB + `map_data.js` 556KB + 单个朝代 geojson 约 900KB，Brotli 压缩后约 **0.6–1MB**；两个 6.5MB 演示视频不在首屏。
- 每天 500 次页面访问约 **1–2GB/天**：Cloudflare 无压力，Vercel 100GB/月也够。
- **裸云主机的带宽才是瓶颈**：3Mbps ≈ 375KB/s，40 人同时开页面（人均 ~2MB）要几分钟。云主机路线务必把 `data/`、`assets/`、`js/` 放 OSS/COS + CDN，主机只跑 `/api` 和 HTML。
- 账号服务端负载极小：50 人 × 10 次任务 = 500 行写入，SQLite WAL 足够，**不需要上 Postgres**。

### 7.4 合规提醒

学生「姓名 + 学号 + 成绩」属于未成年人个人信息。部署到 Cloudflare/Vercel 意味着**数据出境**，学校通常有顾虑；境内云主机 + 备案域名在合规沟通上更稳妥。另外免费平台无 SLA、默认域名可能被干扰，课堂中途打不开的风险要计入。

### 7.5 三条可选路线

**路线 1：零成本、零改造（今天可上线）** — Cloudflare Pages 静态部署 + 离线任务包
教师本机建班建任务 → 发链接 → 学生作答 → 下载结果 JSON → 教师导入汇总/导出 CSV。唯缺“在线自动收卷”。

**路线 2：零现金、要在线收卷** — Cloudflare Pages + Pages Functions + D1
改造清单：路由改 `fetch` handler、`db.prepare` 改 D1 异步 API、`scrypt` 换 PBKDF2、题库答案改为 `import` 打包、保留 Cookie 会话。约半天到一天；密码哈希要更稳可上 Workers Paid（$5/月）。

**路线 3：正式课堂推荐** — 境内轻量云主机 + 现有 Docker（零代码改动）

```bash
docker compose up -d --build jiangshan-classroom
# Caddy/Nginx 反代 8090 + HTTPS，运行时加 COOKIE_SECURE=1
```

静态资源同步到对象存储 + CDN，主机仅保留 API 与 HTML。

### 7.6 上线前检查清单

- 用 HTTPS 访问，并设置 `COOKIE_SECURE=1`
- 已注册好教师账号后，再设 `ALLOW_TEACHER_REGISTER=0` 关闭公开注册
- 确认 `server/data/` 不可通过 URL 访问（服务端已禁止该路径）
- 定时备份 `server/data/`（含 `-wal`、`-shm` 文件）
- 手机端走一遍「扫码 → 加入 → 作答 → 交卷 → 看成绩」，确认学校网络可访问

---

## 8. 常见问题

**端口被占用（`EADDRINUSE`）**
```bash
lsof -ti tcp:8090 | xargs kill      # macOS / Linux
npm start                            # 或换端口：PORT=8091 npm start
```

**打开页面正常，但登录页提示未检测到服务端**
说明当前是静态托管（python/nginx），或后端没起。检查 `http://localhost:8090/api/health` 是否返回 `{"ok":true,...}`。

**学生说提交了，老师看不到**
确认三点：师生连的是**同一个服务端地址/端口**；学生填的是**本班加入码**；任务确属该班级（任务列表「已收 N 份」应增加）。

**忘记密码**
当前版本没有自助找回。可先确认大小写与班级码；确实遗忘时只能删除 `server/data/` 重建（会清空全部数据），建议建号时统一登记。

**只想离线用，不想跑 Node**
直接用方式 B，或把 `classroom/` 部署到任意静态托管。离线模式下任务链接里的 `t=` 参数即任务本体，结果通过 JSON 回传。

**想加题/改解析**
题目来自 `classroom/data/lessons/*.json` 的 `quiz` 场景，改完运行校验：

```bash
npm run validate      # 校验 86 课剧本、175 题、对照轴数据
```

服务端启动时会读取同一批题目作为计分依据，改题后需重启服务端。

**部署到公网**
建议用 nginx/Caddy 反向代理到 `8090` 并启用 HTTPS，同时设 `COOKIE_SECURE=1`；**不要把 `server/data/` 暴露为静态目录**（服务端已禁止访问该路径）。登录接口有每 IP 20 次/分钟的限流。

---

## 9. 目录速查

```
server/index.js            服务端：账号/班级/任务/成绩 API + 静态托管
server/data/app.db         数据库（运行时生成，勿提交）
classroom/login.html       教师注册登录 / 学生加入登录
classroom/my.html          学生「我的任务」
classroom/teacher.html     教师工作台（云端/离线双模式）
classroom/task.html        作答页（?id= 云端任务，?t= 离线任务）
classroom/index.html       课件播放器
classroom/bank.html        舆图寻址题池
classroom/compare.html     中西对照时间轴
package.json               启动脚本（start / server / validate）
docker-compose.yml         静态站点 8008 + 服务端 8090
```

更多产品细节见 `README_ZH.md` 与 `docs/k12-product-plan.md`。
