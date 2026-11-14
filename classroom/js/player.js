/* 江山课堂 · 课件播放器
 * 通过同源 iframe + embed URL 参数驱动舆图（embed 期一次性解析参数，
 * 项目无 postMessage 通道，改 src 重新加载是官方驱动方式）。
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    tree: $("lesson-tree"),
    welcome: $("welcome"),
    player: $("player"),
    crumb: $("lesson-crumb"),
    title: $("lesson-title"),
    frame: $("map-frame"),
    sceneBar: $("scene-bar"),
    sceneIndex: $("scene-index"),
    sceneTitle: $("scene-title"),
    narration: $("scene-narration"),
    board: $("scene-board"),
    quizMount: $("quiz-mount"),
    activityMount: $("activity-mount"),
    btnPrev: $("btn-prev"),
    btnNext: $("btn-next"),
    btnReplay: $("btn-replay"),
    btnCinema: $("btn-cinema"),
    btnFont: $("btn-font"),
    btnCustom: $("btn-custom"),
    customPanel: $("custom-panel"),
    customScenes: $("custom-scenes"),
    btnExport: $("btn-custom-export"),
    btnReset: $("btn-custom-reset"),
    explorePanel: $("explore-panel"),
    exploreList: $("explore-list"),
    btnTool: $("btn-tool"),
    btnStudent: $("btn-student"),
    toolPanel: $("tool-panel"),
    btnToolClose: $("btn-tool-close")
  };

  const LS_CUSTOM = "jc-custom:";
  const LS_PROGRESS = "jc-progress:";
  const LS_FONT = "jc-font-scale";

  const state = {
    manifest: null,
    lesson: null,
    scenes: [],          // 生效场景（官方或自定义）
    sceneIdx: -1,
    custom: null,        // { included: {i:bool}, narration: {i:string} } 或 null
    customMode: false
  };

  /* ---------- URL 构造：link 对象 → embed 深链 ---------- */
  function buildAtlasUrl(link) {
    if (!link) return "../index.html?embed=1";
    const q = new URLSearchParams();
    q.set("embed", "1");
    const map = {
      year: "year", place: "place", person: "person", journey: "journey",
      hover: "hover", zoom: "zoom", polity: "polity", trace: "trace",
      from: "from", to: "to", lang: "lang", stop: "stop", lng: "lng", lat: "lat",
      center: "center", lock: "lock", autoplay: "autoplay"
    };
    Object.keys(map).forEach((k) => {
      if (link[k] !== undefined && link[k] !== null && link[k] !== "") {
        q.set(map[k], String(link[k]));
      }
    });
    if (link.quiz) q.set("quiz", "1");
    return "../index.html?" + q.toString();
  }

  function openTrace(link) {
    if (!link) return;
    els.frame.src = buildAtlasUrl(link);
    const target = state.scenes[state.sceneIdx];
    if (target) {
      // 回跳后保留本幕参数（地图重载即回放本幕），便于继续讲述
      markSceneCurrent(state.sceneIdx);
    }
  }

  /* ---------- 教材目录 ---------- */
  async function loadManifest() {
    const res = await fetch("data/manifest.json");
    state.manifest = await res.json();
    renderTree();
    const want = new URLSearchParams(location.search).get("lesson");
    if (want) openLessonById(want);
  }

  function renderTree() {
    els.tree.innerHTML = "";
    state.manifest.textbooks.forEach((book) => {
      const bookEl = document.createElement("div");
      bookEl.className = "book";
      const nameEl = document.createElement("div");
      nameEl.className = "book-name";
      nameEl.innerHTML = `<span>${book.name}</span><span class="ver">${book.version}</span>`;
      nameEl.addEventListener("click", () => {
        const body = bookEl.querySelector(".book-body");
        body.hidden = !body.hidden;
      });
      bookEl.appendChild(nameEl);

      const body = document.createElement("div");
      body.className = "book-body";
      book.units.forEach((unit) => {
        const u = document.createElement("div");
        u.className = "unit-name";
        u.textContent = unit.name;
        body.appendChild(u);
        unit.lessons.forEach((l) => {
          const item = document.createElement("div");
          item.className = "lesson-item" + (l.status === "ready" ? "" : " pending");
          item.dataset.lessonId = l.id || "";
          const ready = l.status === "ready";
          item.innerHTML = `<span class="no">${l.no ? "第" + l.no + "课" : ""}</span>
            <span class="t">${l.title}</span>
            <span class="tag">${ready ? (l.tag || "课件") : (l.tag || "筹备中")}</span>`;
          if (ready) {
            item.addEventListener("click", () => openLessonById(l.id, item));
          }
          body.appendChild(item);
        });
      });
      bookEl.appendChild(body);
      els.tree.appendChild(bookEl);
    });
  }

  /* ---------- 课件加载与场景渲染 ---------- */
  async function openLessonById(id, itemEl) {
    if (!id) return;
    try {
      const res = await fetch(`data/lessons/${id}.json`);
      if (!res.ok) throw new Error(res.status);
      const lesson = await res.json();
      if (window.jsTrack) jsTrack("lesson_open", id);
      showLesson(lesson);
      document.querySelectorAll(".lesson-item.active").forEach((n) => n.classList.remove("active"));
      const target = itemEl || document.querySelector(`.lesson-item[data-lesson-id="${id}"]`);
      if (target) target.classList.add("active");
    } catch (e) {
      console.warn("课件加载失败:", id, e);
    }
  }

  function showLesson(lesson) {
    state.lesson = lesson;
    state.custom = loadCustom(lesson.id);
    state.scenes = effectiveScenes(lesson.scenes, state.custom);
    state.sceneIdx = -1;
    if (state.customMode) renderCustomPanel();

    els.welcome.hidden = true;
    els.player.hidden = false;
    els.crumb.textContent = `${lesson.grade} · ${lesson.unit}（${lesson.textbook}）`;
    els.title.textContent = `第${lesson.lesson}课 ${lesson.title}`;

    // 课后探索
    els.exploreList.innerHTML = "";
    (lesson.explore || []).forEach((ex) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = ex.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = ex.title;
      li.appendChild(a);
      els.exploreList.appendChild(li);
    });
    els.explorePanel.hidden = !(lesson.explore || []).length;

    renderSceneBar();
    renderCustomPanel();
    gotoScene(loadProgress(lesson.id));
  }

  function effectiveScenes(scenes, custom) {
    if (!custom) return scenes.map((s, i) => ({ scene: s, i, included: true }));
    return scenes.map((s, i) => ({
      scene: custom.narration && custom.narration[i] != null
        ? Object.assign({}, s, { narration: custom.narration[i] }) : s,
      i,
      included: custom.included ? custom.included[i] !== false : true
    }));
  }

  function renderSceneBar() {
    els.sceneBar.innerHTML = "";
    state.scenes.forEach((entry, idx) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `${idx + 1} ${entry.scene.title}`;
      if (!entry.included) btn.classList.add("skipped");
      btn.addEventListener("click", () => gotoScene(idx));
      li.appendChild(btn);
      els.sceneBar.appendChild(li);
    });
  }

  function markSceneCurrent(idx) {
    [...els.sceneBar.querySelectorAll("button")].forEach((b, i) => {
      b.classList.toggle("current", i === idx);
    });
  }

  function gotoScene(idx) {
    if (!state.scenes.length) return;
    idx = Math.max(0, Math.min(idx, state.scenes.length - 1));
    // 自定义模式跳过被移除的场景
    let next = idx;
    while (next < state.scenes.length && !state.scenes[next].included) next += 1;
    if (next >= state.scenes.length) next = idx;
    state.sceneIdx = next;
    saveProgress(state.lesson.id, next);

    const entry = state.scenes[next];
    const s = entry.scene;
    els.sceneIndex.textContent = `第 ${next + 1} / ${state.scenes.length} 幕`;
    els.sceneTitle.textContent = s.title || "";
    els.narration.textContent = s.narration || "";
    els.board.innerHTML = "";
    (s.board || []).forEach((b) => {
      const li = document.createElement("li");
      li.textContent = b;
      els.board.appendChild(li);
    });

    els.quizMount.innerHTML = "";
    els.activityMount.innerHTML = "";

    if (s.type === "quiz") {
      window.ClassroomQuiz.render(els.quizMount, s.items || [], { onTrace: openTrace });
    } else if (s.type === "activity") {
      renderActivity(s);
    } else {
      els.frame.src = buildAtlasUrl(s.link);
    }

    markSceneCurrent(next);
    els.btnPrev.disabled = next <= 0;
    els.btnNext.disabled = next >= state.scenes.length - 1;
  }

  function renderActivity(s) {
    const box = document.createElement("div");
    box.className = "activity-box";
    if (s.link) {
      const a = document.createElement("a");
      a.className = "quiz-trace-link";
      a.href = "#";
      a.textContent = "→ 打开舆图实战";
      a.addEventListener("click", (e) => { e.preventDefault(); openTrace(s.link); });
      box.appendChild(a);
    }
    els.activityMount.appendChild(box);
  }

  function step(delta) {
    let next = state.sceneIdx + delta;
    while (next >= 0 && next < state.scenes.length && !state.scenes[next].included) {
      next += delta > 0 ? 1 : -1;
    }
    if (next >= 0 && next < state.scenes.length) gotoScene(next);
  }

  /* ---------- 持久化 ---------- */
  function loadCustom(id) {
    try { return JSON.parse(localStorage.getItem(LS_CUSTOM + id) || "null"); } catch (e) { return null; }
  }
  function saveCustom(id, custom) {
    try { localStorage.setItem(LS_CUSTOM + id, JSON.stringify(custom)); } catch (e) { /* ignore */ }
  }
  function loadProgress(id) {
    const v = parseInt(localStorage.getItem(LS_PROGRESS + id) || "0", 10);
    return isNaN(v) ? 0 : v;
  }
  function saveProgress(id, idx) {
    try { localStorage.setItem(LS_PROGRESS + id, String(idx)); } catch (e) { /* ignore */ }
  }

  /* ---------- 自定义 ---------- */
  function renderCustomPanel() {
    els.customScenes.innerHTML = "";
    state.lesson.scenes.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "custom-scene";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = (state.custom && state.custom.included)
        ? state.custom.included[i] !== false : true;
      cb.addEventListener("change", () => {
        state.custom = state.custom || { included: {}, narration: {} };
        state.custom.included[i] = cb.checked;
        saveCustom(state.lesson.id, state.custom);
        state.scenes = effectiveScenes(state.lesson.scenes, state.custom);
        renderSceneBar();
        gotoScene(Math.min(state.sceneIdx, state.scenes.length - 1));
      });

      const t = document.createElement("div");
      t.className = "cs-title";
      t.textContent = `${i + 1}. ${s.title}`;

      const ta = document.createElement("textarea");
      ta.value = (state.custom && state.custom.narration && state.custom.narration[i] != null)
        ? state.custom.narration[i] : (s.narration || "");
      ta.addEventListener("change", () => {
        state.custom = state.custom || { included: {}, narration: {} };
        state.custom.narration[i] = ta.value;
        saveCustom(state.lesson.id, state.custom);
        state.scenes = effectiveScenes(state.lesson.scenes, state.custom);
        if (state.sceneIdx === i) els.narration.textContent = ta.value;
      });

      row.appendChild(cb); row.appendChild(t); row.appendChild(ta);
      els.customScenes.appendChild(row);
    });
  }

  function exportCustom() {
    const included = state.scenes.filter((e) => e.included).map((e) => e.scene);
    const out = Object.assign({}, state.lesson, { scenes: included });
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.lesson.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- 交互绑定 ---------- */
  els.btnPrev.addEventListener("click", () => step(-1));
  els.btnNext.addEventListener("click", () => step(1));
  els.btnReplay.addEventListener("click", () => gotoScene(state.sceneIdx));

  /* 字号：投屏模式额外放大 1.25 倍，退出时还原 */
  let scaleBeforeCinema = null;
  function getScale() {
    return parseFloat(getComputedStyle(document.body).getPropertyValue("--font-scale")) || 1;
  }
  function setScale(v) {
    const clamped = Math.max(0.9, Math.min(2, Math.round(v * 100) / 100));
    document.body.style.setProperty("--font-scale", clamped);
    try { localStorage.setItem(LS_FONT, String(clamped)); } catch (e) { /* ignore */ }
    return clamped;
  }

  els.btnCinema.addEventListener("click", () => {
    const on = document.body.classList.toggle("cinema");
    els.btnCinema.classList.toggle("active", on);
    if (on) {
      scaleBeforeCinema = getScale();
      setScale(scaleBeforeCinema * 1.25);
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      if (scaleBeforeCinema != null) setScale(scaleBeforeCinema);
      scaleBeforeCinema = null;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  });

  els.btnFont.addEventListener("click", () => {
    const cur = getScale();
    setScale(cur >= 1.5 ? 1 : cur + 0.15);
  });

  els.btnCustom.addEventListener("click", () => {
    state.customMode = !state.customMode;
    els.btnCustom.classList.toggle("active", state.customMode);
    els.customPanel.hidden = !state.customMode;
  });

  els.btnExport.addEventListener("click", exportCustom);
  els.btnReset.addEventListener("click", () => {
    localStorage.removeItem(LS_CUSTOM + state.lesson.id);
    state.custom = null;
    state.scenes = effectiveScenes(state.lesson.scenes, null);
    renderSceneBar();
    renderCustomPanel();
    gotoScene(state.sceneIdx);
  });

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
      document.body.classList.remove("cinema");
      els.btnCinema.classList.remove("active");
      if (scaleBeforeCinema != null) {
        setScale(scaleBeforeCinema);
        scaleBeforeCinema = null;
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "input" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault(); step(1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault(); step(-1);
    } else if (e.key === "Escape" && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  });

  /* ---------- 学史方法工具箱：纪年换算 ---------- */
  const YEAR_MIN = -403;
  const YEAR_MAX = 2026;

  function fmtYear(y) {
    if (y === 0) return "（无公元 0 年）";
    return y < 0 ? `公元前 ${Math.abs(y)} 年` : `公元 ${y} 年`;
  }

  function centuryOf(y) {
    if (y === 0) return "无公元 0 年";
    const n = Math.ceil(Math.abs(y) / 100);
    return y < 0 ? `公元前 ${n} 世纪` : `公元 ${n} 世纪`;
  }

  function spanYears(a, b) {
    // 含首尾的年数：同符号 |a-b|+1；跨公元 |a|+b（无公元 0 年）
    if (a < 0 && b > 0) return Math.abs(a) + b;
    if (a > 0 && b < 0) return a + Math.abs(b);
    return Math.abs(a - b) + 1;
  }

  function bindTool() {
    const out1 = $("tool-out1"), out2 = $("tool-out2"), out3 = $("tool-out3");

    $("tool-calc1").addEventListener("click", () => {
      const start = parseInt($("tool-start").value, 10);
      const n = parseInt($("tool-n").value, 10);
      if (isNaN(start) || isNaN(n) || n < 1) { out1.textContent = "请输入有效的年号起始年与年数。"; return; }
      const year = start + n - 1;
      out1.textContent = `${fmtYear(start)}为元年，第 ${n} 年 = ${fmtYear(year)}（${centuryOf(year)}）`;
    });

    $("tool-calc2").addEventListener("click", () => {
      const y = parseInt($("tool-year").value, 10);
      if (isNaN(y) || y === 0) { out2.textContent = "请输入有效年份（公元前用负数，且没有公元 0 年）。"; return; }
      const inRange = y >= YEAR_MIN && y <= YEAR_MAX;
      out2.textContent = `${fmtYear(y)} 属于${centuryOf(y)}` + (inRange ? "（在舆图数据范围内）" : "（超出舆图 前403—2026 年范围）");
    });

    $("tool-calc3").addEventListener("click", () => {
      const a = parseInt($("tool-a").value, 10);
      const b = parseInt($("tool-b").value, 10);
      if (isNaN(a) || isNaN(b) || a === 0 || b === 0) { out3.textContent = "请输入有效年份（无公元 0 年）。"; return; }
      const n = spanYears(a, b);
      out3.textContent = `从${fmtYear(a)}到${fmtYear(b)}，共 ${n} 年（含首尾，已扣除不存在的公元 0 年）`;
    });
  }

  els.btnTool.addEventListener("click", () => {
    const show = els.toolPanel.hidden;
    els.toolPanel.hidden = !show;
    els.btnTool.classList.toggle("active", show);
    if (show) els.toolPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  els.btnToolClose.addEventListener("click", () => {
    els.toolPanel.hidden = true;
    els.btnTool.classList.remove("active");
  });
  bindTool();

  /* ---------- 复习模式 ---------- */
  function applyStudentMode(on) {
    document.body.classList.toggle("student", on);
    els.btnStudent.classList.toggle("active", on);
    if (on) {
      els.customPanel.hidden = true;
      els.btnCustom.classList.remove("active");
      state.customMode = false;
    }
    const url = new URL(location.href);
    if (on) url.searchParams.set("mode", "student");
    else url.searchParams.delete("mode");
    history.replaceState(null, "", url.toString());
  }

  els.btnStudent.addEventListener("click", () => {
    applyStudentMode(!document.body.classList.contains("student"));
  });

  /* ---------- 启动 ---------- */
  try {
    const fs = localStorage.getItem(LS_FONT);
    if (fs) document.body.style.setProperty("--font-scale", fs);
  } catch (e) { /* ignore */ }

  if (new URLSearchParams(location.search).get("mode") === "student") applyStudentMode(true);

  loadManifest();
})();
