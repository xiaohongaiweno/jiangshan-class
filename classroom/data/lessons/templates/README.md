# 八下第 18–23 课 · 剧本填写模板

这些模板**不会**被校验器、题池、服务端题库读取（校验器只扫描 lessons/ 顶层文件，本目录是子目录）。
填写完成后请把文件**移动到 lessons/ 顶层**再走上线流程。

## 每课要填什么

| 字段 | 说明 | 示例（参照 q8x-u5-l17） |
|---|---|---|
| title | 教材课题原文，逐字核对 | 推进国防和军队现代化建设 |
| scenes[].narration | 旁白：时间 + 事件 + 一句意义 | 2012 年 9 月，辽宁舰交付海军… |
| scenes[].board | 板书要点，每幕 1–2 条 | 2012 年辽宁舰交付海军 |
| scenes[].link | 地图锚点：year（公元前用负数）、place（地名）、zoom、lock | {"year":2012,"place":"大连","zoom":2,"lock":1} |
| scenes[timeline].from/to | 时间轴区间（公元前用负数） | 2012 / 2022 |
| scenes[quiz].items | 2–3 题：q、options、answer（下标）、explain | 见第 17 课 |
| explore | 课后探索深链，可复用快测里的年份/地名 | ../index.html?year=2012&place=大连 |

## 上线三步

1. 填完内容并删除文件里的 `_note` 字段，把文件移到 `classroom/data/lessons/` 顶层；
2. `classroom/data/manifest.json` 中把该课 `status` 改为 `ready`、填准 `title`；
3. 运行 `npm run validate`，全部通过后重启服务端（题目会被服务端读取用于计分）。
