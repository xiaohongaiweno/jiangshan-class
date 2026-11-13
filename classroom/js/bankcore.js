/* 江山课堂 · 共享题库内核（无依赖）
 * 供题池复用：加载全部 ready 课件的快测题，并统一深链与纪年格式。
 */
(function () {
  "use strict";

  const LINK_KEYS = ["year", "place", "person", "hover", "from", "to", "polity", "zoom", "lock"];

  function fmtYear(y) {
    const n = Number(y);
    if (!Number.isFinite(n) || n === 0) return "";
    return n < 0 ? `前 ${Math.abs(n)} 年` : `${n} 年`;
  }

  function deepLink(link, embed) {
    if (!link) return null;
    const p = new URLSearchParams();
    if (embed) p.set("embed", "1");
    LINK_KEYS.forEach((k) => {
      if (link[k] !== undefined && link[k] !== null && link[k] !== "") p.set(k, link[k]);
    });
    if (![...p.keys()].length) return null;
    return "../index.html?" + p.toString();
  }

  /**
   * 载入题库。
   * @returns {Promise<{items:Array, manifest:Object}>}
   */
  async function loadAll() {
    const manifest = await fetch("data/manifest.json").then((r) => r.json());
    const tasks = [];
    manifest.textbooks.forEach((book) => book.units.forEach((unit) => unit.lessons.forEach((l) => {
      if (l.status !== "ready" || !l.id) return;
      tasks.push(
        fetch("data/lessons/" + l.id + ".json")
          .then((r) => (r.ok ? r.json() : null))
          .then((lesson) => (lesson ? { book, unit, meta: l, lesson } : null))
          .catch(() => null)
      );
    })));

    const loaded = (await Promise.all(tasks)).filter(Boolean);
    const items = [];

    loaded.forEach(({ book, unit, meta, lesson }) => {
      // 课程级兜底锚点：优先取带地名的主地图画面
      const scenes = lesson.scenes || [];
      const fallback = scenes.find((s) => s.type !== "quiz" && s.link && s.link.place)
        || scenes.find((s) => s.type !== "quiz" && s.link && s.link.year !== undefined);

      let n = 0;
      scenes.forEach((scene) => {
        if (scene.type !== "quiz") return;
        (scene.items || []).forEach((item) => {
          const anchor = item.link || (fallback ? fallback.link : null);
          items.push({
            id: `${lesson.id}#${n++}`,
            bookId: book.id,
            bookName: book.name,
            version: book.version || "",
            unitName: unit.name,
            no: meta.no,
            lessonTitle: lesson.title,
            lessonId: lesson.id,
            q: item.q,
            options: item.options || [],
            answer: item.answer,
            explain: item.explain || "",
            link: anchor,
            place: anchor && anchor.place ? anchor.place : null,
            year: anchor && anchor.year !== undefined ? anchor.year : null,
            ownLink: !!item.link
          });
        });
      });
    });

    return { items, manifest };
  }

  /** 按任务范围过滤题目 */
  function filterPool(items, scope) {
    return items.filter((b) => {
      if (!scope) return true;
      if (scope.bookId && b.bookId !== scope.bookId) return false;
      if (scope.unitName && b.unitName !== scope.unitName) return false;
      if (Array.isArray(scope.lessonIds) && scope.lessonIds.length && !scope.lessonIds.includes(b.lessonId)) return false;
      return true;
    });
  }

  /** 可复现的伪随机（同一任务同一套题） */
  function seededShuffle(arr, seed) {
    let s = 0;
    for (let i = 0; i < String(seed).length; i++) s = (s * 31 + String(seed).charCodeAt(i)) >>> 0;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------- 任务链接编解码（UTF-8 安全的 base64url） ---------- */
  function encodeJSON(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeJSON(str) {
    const pad = String(str).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  window.ClassroomBank = { loadAll, filterPool, seededShuffle, deepLink, fmtYear, encodeJSON, decodeJSON };
})();
