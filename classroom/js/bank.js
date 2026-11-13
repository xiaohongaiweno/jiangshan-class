/* 江山课堂 · 舆图寻址课本题池（无依赖） */
(function () {
  "use strict";

  const LS_KEY = "jsmap_bank_v1";
  const TIMED_SECONDS = 30;
  const $ = (id) => document.getElementById(id);

  const state = {
    bank: [],
    pool: [],
    queue: [],
    idx: 0,
    answered: false,
    correct: 0,
    roundWrong: [],
    mode: "practice",
    timer: null,
    deadline: 0,
    store: { wrong: {}, stats: { answered: 0, correct: 0, byBook: {} } }
  };

  /* ---------- 存储 ---------- */
  function loadStore() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.wrong && data.stats) state.store = data;
    } catch (e) { /* ignore */ }
  }

  function saveStore() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.store)); } catch (e) { /* ignore */ }
  }

  /* ---------- 共享内核 ---------- */
  const { deepLink, fmtYear } = window.ClassroomBank;

  /* ---------- 载入题库 ---------- */
  async function boot() {
    loadStore();
    renderStats();
    renderWrong();

    let items = [];
    let manifest = null;
    try {
      ({ items, manifest } = await window.ClassroomBank.loadAll());
    } catch (e) {
      $("quiz-stem").textContent = "题库载入失败：无法读取 manifest.json，请通过本地静态服务器访问。";
      return;
    }
    state.bank = items;

    buildFilters(manifest);
    state.pool = state.bank.slice();
    $("pool-info").textContent = `题库共 ${state.bank.length} 题，覆盖 ${new Set(state.bank.map((b) => b.lessonId)).size} 课。`;
    $("quiz-stem").textContent = "选择题池范围与模式，点击「开始练习」。";
    $("quiz-meta").textContent = "尚未开始 · 支持键盘 1–4 选项、← → 翻题";
    bindEvents();
  }

  function buildFilters(manifest) {
    const bookSel = $("f-book");
    bookSel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "全部册";
    bookSel.appendChild(all);

    const bookIds = [...new Set(state.bank.map((b) => b.bookId))];
    manifest.textbooks.forEach((book) => {
      if (!bookIds.includes(book.id)) return;
      const opt = document.createElement("option");
      opt.value = book.id;
      opt.textContent = book.name;
      bookSel.appendChild(opt);
    });

    bookSel.addEventListener("change", () => { fillUnits(manifest); applyFilter(); });
    $("f-unit").addEventListener("change", () => { fillLessons(manifest); applyFilter(); });
    $("f-lesson").addEventListener("change", applyFilter);
    $("f-kw").addEventListener("input", applyFilter);
    $("f-place").addEventListener("change", applyFilter);
    fillUnits(manifest);
  }

  function fillUnits(manifest) {
    const bookId = $("f-book").value;
    const unitSel = $("f-unit");
    unitSel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "全部单元";
    unitSel.appendChild(all);

    const units = [...new Set(
      state.bank.filter((b) => !bookId || b.bookId === bookId).map((b) => b.unitName)
    )];
    units.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      unitSel.appendChild(opt);
    });
    fillLessons(manifest);
  }

  function fillLessons() {
    const bookId = $("f-book").value;
    const unitName = $("f-unit").value;
    const lessonSel = $("f-lesson");
    lessonSel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "全部课";
    lessonSel.appendChild(all);

    const seen = new Set();
    state.bank.forEach((b) => {
      if (bookId && b.bookId !== bookId) return;
      if (unitName && b.unitName !== unitName) return;
      if (seen.has(b.lessonId)) return;
      seen.add(b.lessonId);
      const opt = document.createElement("option");
      opt.value = b.lessonId;
      opt.textContent = `第${b.no || "-"}课 ${b.lessonTitle}`;
      lessonSel.appendChild(opt);
    });
  }

  function applyFilter() {
    const bookId = $("f-book").value;
    const unitName = $("f-unit").value;
    const lessonId = $("f-lesson").value;
    const kw = $("f-kw").value.trim().toLowerCase();
    const placeOnly = $("f-place").checked;

    state.pool = state.bank.filter((b) => {
      if (bookId && b.bookId !== bookId) return false;
      if (unitName && b.unitName !== unitName) return false;
      if (lessonId && b.lessonId !== lessonId) return false;
      if (placeOnly && !b.place) return false;
      if (kw && !(b.q + " " + b.explain + " " + b.lessonTitle).toLowerCase().includes(kw)) return false;
      return true;
    });

    const wrongN = state.pool.filter((b) => state.store.wrong[b.id]).length;
    const located = state.pool.filter((b) => b.place).length;
    $("pool-info").textContent = `当前范围 ${state.pool.length} 题（可定位地名 ${located} 题，错题 ${wrongN} 题）。`;
    $("quiz-stem").textContent = "点击「开始练习」按当前范围出题。";
    $("quiz-meta").textContent = "未开始";
    $("quiz-opts").innerHTML = "";
    $("quiz-explain").hidden = true;
    $("quiz-progress").firstElementChild.style.width = "0";
    $("report").hidden = true;
    $("quiz-card").hidden = false;
  }

  /* ---------- 出题 ---------- */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startRound() {
    stopTimer();
    const mode = $("f-mode").value;
    state.mode = mode;
    let queue = state.pool.slice();

    if (mode === "random10") queue = shuffle(queue).slice(0, 10);
    else if (mode === "random20") queue = shuffle(queue).slice(0, 20);
    else if (mode === "timed") queue = shuffle(queue).slice(0, 15);
    else if (mode === "wrong") queue = queue.filter((b) => state.store.wrong[b.id]);

    if (!queue.length) {
      $("quiz-stem").textContent = mode === "wrong"
        ? "错题本是空的：先做几轮练习，答错的题会自动收进来。"
        : "当前范围没有题目，请调整册/单元/课或清空检索词。";
      $("quiz-opts").innerHTML = "";
      $("quiz-explain").hidden = true;
      return;
    }

    state.queue = queue;
    state.idx = 0;
    state.correct = 0;
    state.roundWrong = [];
    $("report").hidden = true;
    $("quiz-card").hidden = false;
    renderQuestion();
  }

  function current() { return state.queue[state.idx]; }

  function renderQuestion() {
    const item = current();
    if (!item) return;
    state.answered = false;

    $("quiz-meta").textContent =
      `${item.bookName} · ${item.unitName} · 第${item.no || "-"}课 ${item.lessonTitle} · 第 ${state.idx + 1}/${state.queue.length} 题`;
    if (item.place) {
      const chip = document.createElement("span");
      chip.className = "anchor";
      chip.textContent = `📍 ${item.place}` +
        (item.year === null ? "" : (item.year === -403 ? "（今地对照）" : ` · ${fmtYear(item.year)}`));
      $("quiz-meta").appendChild(chip);
    }
    $("quiz-stem").textContent = item.q;

    const opts = $("quiz-opts");
    opts.innerHTML = "";
    item.options.forEach((text, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "q-opt";
      btn.innerHTML = `<b>${"ABCDEFGH"[i]}</b>`;
      btn.appendChild(document.createTextNode(text));
      btn.addEventListener("click", () => answer(i));
      opts.appendChild(btn);
    });

    $("quiz-explain").hidden = true;
    $("quiz-explain").innerHTML = "";
    $("quiz-progress").firstElementChild.style.width = `${(state.idx / state.queue.length) * 100}%`;
    $("btn-prev").disabled = state.idx === 0;
    $("btn-next").textContent = state.idx === state.queue.length - 1 ? "完成本轮" : "下一题";
    updateMap(item);

    if (state.mode === "timed") startTimer();
    else stopTimer();
  }

  function answer(choice) {
    if (state.answered) return;
    const item = current();
    state.answered = true;
    stopTimer();

    const ok = choice === item.answer;
    if (ok) state.correct += 1;
    else {
      state.roundWrong.push(item);
      state.store.wrong[item.id] = {
        id: item.id, bookName: item.bookName, unitName: item.unitName,
        no: item.no, lessonTitle: item.lessonTitle, lessonId: item.lessonId,
        q: item.q, options: item.options, answer: item.answer,
        explain: item.explain, link: item.link, ts: Date.now()
      };
    }

    state.store.stats.answered += 1;
    if (ok) state.store.stats.correct += 1;
    const byBook = state.store.stats.byBook[item.bookId] || { answered: 0, correct: 0 };
    byBook.answered += 1;
    if (ok) byBook.correct += 1;
    state.store.stats.byBook[item.bookId] = byBook;
    saveStore();
    renderStats();
    renderWrong();

    [...$("quiz-opts").children].forEach((btn, i) => {
      btn.disabled = true;
      if (i === item.answer) btn.classList.add("correct");
      else if (i === choice) btn.classList.add("wrong");
    });

    const box = $("quiz-explain");
    box.hidden = false;
    const head = document.createElement("p");
    head.textContent = ok ? "✓ 正确" : (choice < 0 ? "⏱ 超时未答，正确答案：" : "✗ 答错，正确答案：") + `${"ABCDEFGH"[item.answer]}`;
    head.style.margin = "0 0 6px";
    head.style.color = ok ? "var(--ok)" : "var(--cinnabar)";
    box.appendChild(head);

    if (item.explain) {
      const p = document.createElement("p");
      p.style.margin = "0";
      p.textContent = item.explain;
      box.appendChild(p);
    }

    const href = deepLink(item.link, false);
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = "→ 在地图上回看史实";
      a.style.display = "inline-block";
      a.style.marginTop = "8px";
      a.addEventListener("click", (e) => { e.preventDefault(); updateMap(item); });
      box.appendChild(a);
    }
  }

  function nextQuestion() {
    if (state.mode === "timed" && !state.answered) answer(-1);
    if (state.idx >= state.queue.length - 1) return finishRound();
    state.idx += 1;
    renderQuestion();
  }

  function prevQuestion() {
    if (state.idx === 0) return;
    state.idx -= 1;
    renderQuestion();
  }

  function finishRound() {
    stopTimer();
    const total = state.queue.length;
    const answeredN = state.idx + (state.answered ? 1 : 0);
    const pct = answeredN ? Math.round((state.correct / answeredN) * 100) : 0;

    $("quiz-card").hidden = true;
    $("report").hidden = false;
    $("report-summary").textContent =
      `本轮共 ${total} 题，作答 ${answeredN} 题，答对 ${state.correct} 题，正确率 ${pct}%。` +
      (state.roundWrong.length ? `错题 ${state.roundWrong.length} 题已收入错题本。` : "全部答对，很稳。");

    const list = $("report-list");
    list.innerHTML = "";
    state.roundWrong.forEach((item) => {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = `第${item.no || "-"}课 `;
      li.appendChild(b);
      li.appendChild(document.createTextNode(item.q));
      list.appendChild(li);
    });

    $("btn-redo-wrong").style.display = state.roundWrong.length ? "" : "none";
    $("report").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- 计时 ---------- */
  function startTimer() {
    stopTimer();
    state.deadline = Date.now() + TIMED_SECONDS * 1000;
    const el = $("quiz-timer");
    el.hidden = false;
    el.textContent = `${TIMED_SECONDS}s`;
    state.timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
      el.textContent = `${left}s`;
      if (left <= 0) {
        stopTimer();
        if (!state.answered) answer(-1);
      }
    }, 200);
  }

  function stopTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    const el = $("quiz-timer");
    if (el) el.hidden = true;
  }

  /* ---------- 地图回看 ---------- */
  function updateMap(item) {
    const src = deepLink(item && item.link, true);
    if (!src) {
      $("map-hint").textContent = "本题没有地图锚点，可换一道带地名的题试试。";
      $("map-hint").hidden = false;
      $("map-frame").removeAttribute("src");
      $("map-open").removeAttribute("href");
      return;
    }
    $("map-hint").hidden = true;
    $("map-frame").src = src;
    $("map-open").href = deepLink(item.link, false) || "#";
  }

  /* ---------- 记录 ---------- */
  function renderStats() {
    const s = state.store.stats;
    const rate = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
    const dl = $("stats");
    dl.innerHTML = "";
    [["累计作答", s.answered], ["累计答对", s.correct], ["总正确率", rate + "%"], ["错题本", Object.keys(state.store.wrong).length]]
      .forEach(([k, v]) => {
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = v;
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
  }

  function renderWrong() {
    const items = Object.values(state.store.wrong).sort((a, b) => b.ts - a.ts);
    $("wrong-count").textContent = items.length;
    const ul = $("wrong-list");
    ul.innerHTML = "";
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "wrong-empty";
      li.textContent = "暂无错题";
      ul.appendChild(li);
      return;
    }
    items.slice(0, 8).forEach((item) => {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = `第${item.no || "-"}课 ${item.lessonTitle}`;
      li.appendChild(b);
      li.appendChild(document.createElement("br"));
      li.appendChild(document.createTextNode(item.q.slice(0, 34) + (item.q.length > 34 ? "…" : "")));
      li.addEventListener("click", () => {
        state.queue = [state.bank.find((x) => x.id === item.id)].filter(Boolean);
        state.idx = 0;
        state.correct = 0;
        state.roundWrong = [];
        $("report").hidden = true;
        $("quiz-card").hidden = false;
        state.mode = "practice";
        renderQuestion();
      });
      ul.appendChild(li);
    });
  }

  function exportWrong() {
    const items = Object.values(state.store.wrong);
    if (!items.length) return;
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), items }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "错题本.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- 事件 ---------- */
  function bindEvents() {
    $("btn-start").addEventListener("click", startRound);
    $("btn-next").addEventListener("click", nextQuestion);
    $("btn-prev").addEventListener("click", prevQuestion);
    $("btn-redo-wrong").addEventListener("click", () => {
      $("f-mode").value = "wrong";
      state.mode = "wrong";
      state.queue = state.roundWrong.slice();
      state.idx = 0;
      state.correct = 0;
      state.roundWrong = [];
      $("report").hidden = true;
      $("quiz-card").hidden = false;
      renderQuestion();
    });
    $("btn-again").addEventListener("click", startRound);
    $("btn-export").addEventListener("click", exportWrong);
    $("btn-wrong-clear").addEventListener("click", () => {
      if (!Object.keys(state.store.wrong).length) return;
      if (!confirm("确定清空错题本？")) return;
      state.store.wrong = {};
      saveStore();
      renderStats();
      renderWrong();
    });
    $("btn-reset").addEventListener("click", () => {
      if (!confirm("确定清空本机全部答题记录与错题本？")) return;
      state.store = { wrong: {}, stats: { answered: 0, correct: 0, byBook: {} } };
      saveStore();
      renderStats();
      renderWrong();
    });
    $("btn-map-toggle").addEventListener("click", () => {
      const hidden = document.body.classList.toggle("map-hidden");
      $("btn-map-toggle").classList.toggle("active", !hidden);
    });

    document.addEventListener("keydown", (e) => {
      if (!state.queue.length || $("quiz-card").hidden) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < current().options.length) answer(i);
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        nextQuestion();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevQuestion();
      }
    });
  }

  boot();
})();
