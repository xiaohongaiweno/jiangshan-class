# 外链提交剩余工作 Spec（查重优先）

日期：2026-11-09
范围：santawheel.com、snapbyface.com 的目录/外链提交
硬约束：提交邮箱 `dengxiaohongaikimi@gmail.com`；不购买付费档；不碰 Reddit；遇登录/验证码交用户手动处理；**每次提交前先查重**。

## 1. 已完成（本轮及既有）

| 站点 | 目录 | 状态 | 证据 |
|---|---|---|---|
| SnapByFace | Fazier | 既有，非新增 | `https://fazier.com/launches/snapbyface` 页面存在 |
| SnapByFace | SaaSHub | 既有 | Footer.astro 中 `saashub.com/snapbyface?badge_kind=approved` |
| SnapByFace | dev.to | 既有 2 篇 | dev.to 文章 URL 可访问 |
| SnapByFace | AllAboutAI | 已提交，审核中 | 提交后出现 `?submitted=1` / "Submission Received!" |
| SnapByFace | Tap4 AI | 已提交，审核中 | 页面返回 `success` |
| SnapByFace | GoodAITools / Twelve / Findly / Launchstag / tools.cafe / GetBannerBid | 既有 | Footer.astro badge + goodaitools sitemap 含 `/ai/snapbyface` |
| SantaWheel | Fazier | 本轮新增 | `https://fazier.com/launches/santawheel`，Free 档，排期 2026-11-10 |
| SantaWheel | noisedaohang | 本轮新增 | 投稿页留言数 7952→7953，内容含 SantaWheel，时间“0 秒前发布” |
| SantaWheel | Product Hunt / AlternativeTo / SaaSHub / HN 等 | 既有 | `.backlink/ledger.json` 记录 |
| 两站 | Wired.business | 放弃 | 需要 Stripe 实付，已撤掉回链 |

## 2. 查重判据（三项命中任一即跳过）

1. 目标站 sitemap / 站内搜索存在该产品页；
2. 我方站点页脚已有该目录 badge；
3. `.backlink/ledger.json` 已有 `state=submitted` 记录。

## 3. 查重结论

| 目录 | SantaWheel | SnapByFace | 判定 |
|---|---|---|---|
| noisedaohang | 已提交 | 未提交 | SnapByFace 可另行提交（非重复） |
| AllAboutAI | 未提交 | 审核中 | **不提交 SantaWheel**：该站为 AI 目录，非 AI 工具必被拒 |
| GoodAITools | 未提交 | 已收录 | SantaWheel 需登录，暂缓 |
| ShowMeBest.ai | 不适用（AI 目录） | sitemap 840 条无此站 | 可提交 SnapByFace，但当前表单点击 Submit 未产生网络请求，需先定位原因 |
| Sellwithboost | 未提交 | 未提交 | `/submit` 跳转 `/login`，需登录 |
| ToolFame | 未提交 | 未提交 | `/submit` 为登录页，需登录 |
| Turbo0 | 未提交 | 未提交 | 需登录 |
| Peerlist | 未提交 | 未提交 | 需登录 |
| Twelve.tools | 未提交 | 已有 badge | SantaWheel 需先在页脚挂 badge 再提交 |
| Findly | 未提交 | 已有 badge | SantaWheel 需先在页脚挂 badge 再提交 |

## 4. 决策（按推荐默认值执行）

- **D1**：仅为 SantaWheel 页脚增加 3 个互链 badge：twelve.tools、findly.tools、showmebest.ai；不继续增加，避免页脚膨胀。
- **D2**：不向 AllAboutAI 提交 SantaWheel（相关性不符）。
- **D3**：所有需要登录的目录（Turbo0、Peerlist、ToolFame、GoodAITools、Sellwithboost、ShowMeBest）统一等用户登录后一次性批量处理，不做绕过尝试。
- **D4**：SnapByFace 不再向 Fazier、SaaSHub、GoodAITools、Twelve、Findly、dev.to 重复提交。
- **D5**：ShowMeBest 的免费提交需先把 badge 放到 snapbyface.com 页脚；表单无响应的原因定位后再决定是否继续。

## 5. 实施步骤（精确到文件）

### 5.1 修改 SantaWheel 页脚
文件：`/Users/workspace/ai_workspace/santawheel/components/layout/Footer.tsx`

在现有第二个 badge 容器（第 73–88 行，含 Fazier badge）内追加三项：

1. ShowMeBest（badge 地址已确认）：
```tsx
<a href="https://showmebest.ai" target="_blank" rel="noopener" aria-label="Featured on ShowMeBestAI">
  <img src="https://showmebest.ai/badge/feature-badge-white.webp" alt="Featured on ShowMeBestAI" width={220} height={60} loading="lazy" />
</a>
```
2. Twelve.tools：从 `https://twelve.tools/badge` 复制官方 badge 代码（外链必须指向 `https://twelve.tools`）。
3. Findly：从 `https://findly.tools` 的 badge 区块复制官方代码（外链必须指向 `https://findly.tools`）。

约束：只用 `<a>` + `<img>`，不改布局类名以外的样式；保持 `target="_blank" rel="noopener" loading="lazy"`。

### 5.2 构建验证
```bash
cd /Users/workspace/ai_workspace/santawheel
npm run build
```
通过标准：构建退出码 0；`/` 页面 HTML 中出现 3 个新 badge 的 `img src`。

### 5.3 部署
使用现有 Vercel 流程部署（`git push` 或 `vercel --prod`）。部署后验证：
```bash
curl -s https://santawheel.com/ | grep -c -i -E "twelve.tools|findly.tools|showmebest.ai"
```
期望：≥3。

### 5.4 提交 Twelve.tools（SantaWheel）
入口：`https://twelve.tools/submit-your-tool`
流程：填 `https://santawheel.com` → 上传截图 → Review 填写 → Badge 步骤验证页脚已挂 → 发布。
去重前置：先访问 `https://twelve.tools` 站内搜索 `santawheel`，命中则跳过。

### 5.5 提交 Findly（SantaWheel）
入口：`https://findly.tools` 的 Submit。
去重前置：站内搜索 `santawheel`，命中则跳过。

### 5.6 ShowMeBest（SnapByFace）
先排查 5.1 已观察到的“点击 Submit 无网络请求”问题：打开 DevTools Network 后点击，若为 Clerk 登录门禁，则归入 D3 登录批次；若为前端校验，补齐字段后再提交。
提交成功后把 badge 加到 `snapbyface.com` 页脚（文件 `/Users/workspace/py_workspace/facematch/web/src/components/Footer.astro`）并 `npx wrangler deploy`。

### 5.7 台账
更新 `/Users/workspace/ai_workspace/santawheel/.backlink/ledger.json`：新增 SantaWheel→noisedaohang（submitted，含留言页 URL）；标注 SnapByFace→Fazier 为既有；记录本轮 blocked 目录及原因。
该文件在 workspace 之外，写入前需用户批准。

## 6. 验收标准

- SantaWheel 页脚三个 badge 在线上可见且链接为 dofollow。
- Twelve.tools、Findly 提交后获得 listing URL 或明确的“审核中”回执。
- 台账中每条记录都有 `evidence` 字段。
- 未发生任何重复提交；未产生任何付费。

## 7. 需要审批

批准后执行 5.1–5.7。若不在本机部署 Vercel，则 5.1 只提交代码改动，等待用户部署后再执行 5.4/5.5（badge 校验依赖线上页脚）。
