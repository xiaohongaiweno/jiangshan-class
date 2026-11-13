# Tasks — 外链提交剩余工作

- [x] T1 在 `santawheel/components/layout/Footer.tsx` 增加 twelve.tools / findly.tools / showmebest.ai 三个互链 badge（优先级：高）
  - 验收：文件内出现 3 个新 `<a href>` 与对应 `<img>`
- [x] T2 `npm run build` 通过，且产物 HTML 含 3 个新 badge（优先级：高）
- [x] T3 部署 santawheel 到线上，`curl https://santawheel.com/` 命中 3 个域名（优先级：高，依赖 T2）
- [x] T4 站内搜索确认 `twelve.tools` 未收录 santawheel 后提交（优先级：高，依赖 T3）→ listing: https://twelve.tools/santawheel，管理链接 hash=aigylbw0182bp7tb069g
- [ ] T5 站内搜索确认 `findly.tools` 未收录 santawheel 后提交（优先级：高，依赖 T3）
  - 阻塞：`https://findly.tools/santawheel` 返回 404（未收录），但 `/submit` 跳转 `/sign-in`，需用户登录后才能提交
- [x] T6 定位 ShowMeBest 免费表单 Submit 无响应的原因；若为登录门禁则转入登录批次（优先级：中）
- [x] T7 登录批次：Turbo0、Peerlist、ToolFame、GoodAITools、Sellwithboost（优先级：中，依赖用户登录）
- [x] T8 更新 `.backlink/ledger.json`：noisedaohang=submitted、Fazier(SnapByFace)=既有、blocked 目录记录（优先级：中，需批准 workspace 外写入）
- [x] T9 已完成事实归档：SantaWheel→Fazier 已上线（2026-11-10）、SantaWheel→noisedaohang 已发留言（优先级：低，无代码改动）
