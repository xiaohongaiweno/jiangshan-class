#!/usr/bin/env node
/**
 * 课件剧本校验：node classroom/validate_lessons.cjs
 * 校验项：
 *  1. manifest 中 status=ready 的课均有对应剧本文件；剧本未被 manifest 引用则告警
 *  2. 必填字段 id/textbook/grade/unit/lesson/title/scenes
 *  3. 场景类型合法；map/journey/timeline 必须有 link
 *  4. 年份在 -403..2026 且不为 0（无公元 0 年）
 *  5. quiz 题：2 个以上选项、answer 下标合法、有解析
 *  6. 深链参数白名单，防止拼错参数导致地图无反应
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const LESSON_DIR = path.join(ROOT, "data", "lessons");
const MANIFEST = path.join(ROOT, "data", "manifest.json");

const SCENE_TYPES = new Set(["map", "journey", "timeline", "quiz", "activity"]);
const LINK_KEYS = new Set([
  "year", "place", "person", "journey", "hover", "zoom", "polity", "trace",
  "from", "to", "lang", "stop", "lng", "lat", "center", "lock", "autoplay", "quiz"
]);
const MIN_YEAR = -403;
const MAX_YEAR = 2026;
const CMP_MIN = -800; // 对照轴起点（春秋），早于疆域数据起点

const errors = [];
const warnings = [];

function err(file, msg) { errors.push(`${file}: ${msg}`); }
function warn(file, msg) { warnings.push(`${file}: ${msg}`); }

function checkYear(file, label, value) {
  const num = Number(value);
  if (!Number.isInteger(num)) return err(file, `${label} 不是整数年份：${value}`);
  if (num === 0) return err(file, `${label} 不能为 0（历史纪年无公元 0 年）`);
  if (num < MIN_YEAR || num > MAX_YEAR) err(file, `${label} 超出范围 ${MIN_YEAR}..${MAX_YEAR}：${num}`);
}

function checkLink(file, link, sceneTitle) {
  if (!link || typeof link !== "object") return err(file, `场景「${sceneTitle}」缺少 link`);
  Object.keys(link).forEach((k) => {
    if (!LINK_KEYS.has(k)) err(file, `场景「${sceneTitle}」含未知深链参数 ${k}`);
  });
  if (link.year !== undefined) String(link.year).split(/[,，;；]/).forEach((y) => checkYear(file, `year`, y.trim()));
  if (link.from !== undefined) checkYear(file, "from", link.from);
  if (link.to !== undefined) checkYear(file, "to", link.to);
  if (link.place !== undefined && !String(link.place).trim()) err(file, `场景「${sceneTitle}」place 为空`);
  if (link.zoom !== undefined) {
    const z = Number(link.zoom);
    if (!(z >= 1 && z <= 8)) err(file, `场景「${sceneTitle}」zoom 超出 1..8：${link.zoom}`);
  }
  if (link.lock !== undefined && ![1, "1"].includes(link.lock)) warn(file, `场景「${sceneTitle}」lock 一般为 1`);
  if (link.autoplay !== undefined && ![1, "1"].includes(link.autoplay)) warn(file, `场景「${sceneTitle}」autoplay 一般为 1`);
}

function checkQuiz(file, scene) {
  const items = scene.items;
  if (!Array.isArray(items) || !items.length) return err(file, `快测场景「${scene.title}」缺少 items`);
  items.forEach((item, i) => {
    const tag = `第 ${i + 1} 题`;
    if (!item.q) err(file, `${tag} 缺少题干`);
    if (!Array.isArray(item.options) || item.options.length < 2) err(file, `${tag} 选项少于 2 个`);
    if (!Number.isInteger(item.answer) || item.answer < 0 || item.answer >= (item.options || []).length) {
      err(file, `${tag} answer 下标非法：${item.answer}`);
    }
    if (!item.explain) warn(file, `${tag} 缺少解析（explain）`);
    if (item.link) checkLink(file, item.link, `${scene.title} · ${tag}`);
  });
}

function checkLesson(file, lesson) {
  ["id", "textbook", "grade", "unit", "title"].forEach((k) => {
    if (!lesson[k]) err(file, `缺少字段 ${k}`);
  });
  if (!Number.isInteger(lesson.lesson)) err(file, "lesson 课次必须为整数");
  if (!Array.isArray(lesson.scenes) || lesson.scenes.length < 3) err(file, "scenes 少于 3 幕");
  const types = new Set();
  (lesson.scenes || []).forEach((scene, i) => {
    const tag = `第 ${i + 1} 幕`;
    if (!scene.title) err(file, `${tag} 缺少 title`);
    if (!SCENE_TYPES.has(scene.type)) err(file, `${tag} 未知类型 ${scene.type}`);
    types.add(scene.type);
    if (scene.type === "quiz") checkQuiz(file, scene);
    else if (scene.type === "activity") { if (!scene.link && !scene.narration) err(file, `${tag} 活动场景需 link 或 narration`); if (scene.link) checkLink(file, scene.link, scene.title); }
    else {
      if (!scene.narration) warn(file, `${tag} 缺少旁白 narration`);
      checkLink(file, scene.link, scene.title);
    }
  });
  if (!types.has("quiz")) warn(file, "本课没有课堂快测场景");
  (lesson.explore || []).forEach((ex, i) => {
    if (!ex.title || !ex.url) err(file, `explore 第 ${i + 1} 条缺 title/url`);
  });
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const ready = new Map();
  manifest.textbooks.forEach((book) => book.units.forEach((unit) => unit.lessons.forEach((l) => {
    if (l.status === "ready" && l.id) ready.set(l.id, `${book.name} · ${unit.name} · ${l.title}`);
  })));

  const bankStats = { questions: 0, lessons: new Set(), withLink: 0 };
  const stems = new Map();

  const files = fs.existsSync(LESSON_DIR)
    ? fs.readdirSync(LESSON_DIR).filter((f) => f.endsWith(".json"))
    : [];
  const fileIds = new Set();

  files.forEach((f) => {
    const file = `data/lessons/${f}`;
    let lesson;
    try {
      lesson = JSON.parse(fs.readFileSync(path.join(LESSON_DIR, f), "utf8"));
    } catch (e) {
      return err(file, `JSON 解析失败：${e.message}`);
    }
    fileIds.add(lesson.id);
    if (f !== `${lesson.id}.json`) err(file, `文件名应与 id 一致：${lesson.id}.json`);
    if (!ready.has(lesson.id)) warn(file, `剧本 id=${lesson.id} 未在 manifest 标记 ready 或不存在`);
    if (!lesson.textbook.includes("统编")) warn(file, "textbook 应标注统编版与版本年份");
    checkLesson(file, lesson);

    // 题池统计：统计可用题量与地图锚点覆盖（含课程级兜底锚点）
    const fallback = (lesson.scenes || []).find((s) => s.type !== "quiz" && s.link && s.link.year !== undefined);
    (lesson.scenes || []).forEach((scene) => {
      if (scene.type !== "quiz") return;
      (scene.items || []).forEach((item) => {
        bankStats.questions += 1;
        bankStats.lessons.add(lesson.id);
        if (item.link || fallback) bankStats.withLink += 1;
        if (item.q) {
          const key = String(item.q).trim();
          if (stems.has(key)) warn(file, `题干与其他课重复：${key.slice(0, 18)}…（另见 ${stems.get(key)}）`);
          else stems.set(key, file);
        }
      });
    });
  });

  ready.forEach((desc, id) => {
    if (!bankStats.lessons.has(id)) warn("data/manifest.json", `ready 课没有可用快测题，题池将缺失该课：${id}`);
  });

  ready.forEach((desc, id) => {
    if (!fileIds.has(id)) err("data/manifest.json", `ready 课无剧本文件：${id}（${desc}）`);
  });

  // 中西对照轴数据校验
  const COMPARE = path.join(ROOT, "data", "compare.json");
  let compareCount = 0;
  if (fs.existsSync(COMPARE)) {
    const file = "data/compare.json";
    let cmp;
    try {
      cmp = JSON.parse(fs.readFileSync(COMPARE, "utf8"));
    } catch (e) {
      err(file, `JSON 解析失败：${e.message}`);
    }
    if (cmp) {
      const cats = new Set(["政治", "经济", "文化", "科技", "军事", "交流", "社会"]);
      const segments = Array.isArray(cmp.cn) ? cmp.cn : [];
      const events = Array.isArray(cmp.world) ? cmp.world : [];
      if (!segments.length) err(file, "缺少 cn 朝代段落");
      if (!events.length) err(file, "缺少 world 世界史节点");

      segments.forEach((s, i) => {
        const tag = `cn 第 ${i + 1} 段「${s.name || "未命名"}」`;
        if (!s.name || !s.note) err(file, `${tag} 缺 name/note`);
        [["from", s.from], ["to", s.to]].forEach(([k, v]) => {
          if (!Number.isInteger(v) || v === 0 || v < CMP_MIN || v > MAX_YEAR) err(file, `${tag} ${k} 非法：${v}`);
        });
        if (Number.isInteger(s.from) && Number.isInteger(s.to) && s.from >= s.to) err(file, `${tag} from 应小于 to`);
      });

      for (let i = 1; i < segments.length; i++) {
        if (segments[i].from > segments[i - 1].to + 2) {
          warn(file, `朝代段落不连续：${segments[i - 1].name} 止于 ${segments[i - 1].to}，${segments[i].name} 起于 ${segments[i].from}`);
        }
      }

      events.forEach((e, i) => {
        const tag = `world 第 ${i + 1} 条「${(e.title || "").slice(0, 12)}」`;
        if (!e.title || !e.note) err(file, `${tag} 缺 title/note`);
        if (!Number.isInteger(e.year) || e.year === 0 || e.year < CMP_MIN || e.year > MAX_YEAR) err(file, `${tag} year 非法：${e.year}`);
        if (!cats.has(e.cat)) err(file, `${tag} cat 未知：${e.cat}`);
      });

      const sorted = events.every((e, i) => i === 0 || events[i - 1].year <= e.year);
      if (!sorted) warn(file, "world 节点未按年份升序排列（不影响显示）");
      compareCount = events.length;
    }
  }

  const ok = errors.length === 0;
  if (warnings.length) {
    console.log(`\n⚠ 告警 ${warnings.length} 条：`);
    warnings.forEach((w) => console.log("  - " + w));
  }
  if (!ok) {
    console.log(`\n✗ 校验失败 ${errors.length} 条：`);
    errors.forEach((e) => console.log("  - " + e));
    process.exit(1);
  }
  console.log(`\n✓ 校验通过：${files.length} 份剧本，${ready.size} 课标记 ready。`);
  console.log(`  题池：${bankStats.questions} 题 / ${bankStats.lessons.size} 课，${bankStats.withLink} 题可回看地图（含课程级兜底锚点）。`);
  if (compareCount) console.log(`  中西对照轴：${compareCount} 个世界史节点。`);
}

main();
