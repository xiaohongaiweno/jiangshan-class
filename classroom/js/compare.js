/* 江山课堂 · 中西对照时间轴（无依赖） */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const MIN_YEAR = -800;   // 对照轴起点
  const MAX_YEAR = 2026;
  const MAP_MIN = -403;    // 主舆图疆域数据起点

  const state = {
    data: null,
    century: null,     // { kind:'bc'|'ad', n, from, to, label, sub }
    cat: "全部",
    kw: "",
    focusEvent: null
  };

  /* ---------- 工具 ---------- */
  function fmtYear(y) {
    const n = Number(y);
    if (!Number.isFinite(n) || n === 0) return "—";
    return n < 0 ? `前 ${Math.abs(n)} 年` : `${n} 年`;
  }

  function centuryOfYear(y) {
    if (y < 0) return { kind: "bc", n: Math.ceil(Math.abs(y) / 100) };
    return { kind: "ad", n: Math.ceil(y / 100) };
  }

  function centuryInfo(kind, n) {
    if (kind === "bc") {
      let from = -n * 100;
      let to = -(n - 1) * 100 - 1;
      if (from < MIN_YEAR) from = MIN_YEAR;
      return {
        kind, n, from, to,
        label: `前 ${n} 世纪`,
        sub: `${Math.abs(from)}—${Math.abs(to)}（公元前）`
      };
    }
    const from = (n - 1) * 100 + 1;
    const to = Math.min(n * 100, MAX_YEAR);
    return { kind, n, from, to, label: `${n} 世纪`, sub: `${from}—${to}` };
  }

  function allCenturies() {
    const list = [];
    for (let n = 8; n >= 1; n--) list.push(centuryInfo("bc", n));
    for (let n = 1; n <= 21; n++) list.push(centuryInfo("ad", n));
    return list;
  }

  function clipYear(y) {
    return Math.max(MAP_MIN, Math.min(MAX_YEAR, y));
  }

  function midYear(c) {
    let y = Math.round((c.from + c.to) / 2);
    if (y === 0) y = 1;
    return clipYear(y);
  }

  function mapUrl(y) {
    return `../index.html?year=${y}&zoom=1.6`;
  }

  /* ---------- 载入 ---------- */
  async function boot() {
    try {
      state.data = await fetch("data/compare.json").then((r) => r.json());
    } catch (e) {
      $("detail").innerHTML = '<p class="detail-empty">对照数据载入失败：请通过本地静态服务器访问本页。</p>';
      return;
    }
    renderCats();
    renderStrip();
    const fromParam = parseCenturyParam(new URLSearchParams(location.search).get("c"));
    selectCentury(fromParam || centuryInfo("bc", 3), true);
    bindEvents();
  }

  function parseCenturyParam(v) {
    if (!v) return null;
    const m = /^(前)?(\d{1,2})$/.exec(v);
    if (!m) return null;
    const n = Number(m[2]);
    if (!(n >= 1 && n <= 21)) return null;
    return centuryInfo(m[1] ? "bc" : "ad", n);
  }

  /* ---------- 分类 ---------- */
  function renderCats() {
    const cats = ["全部", ...new Set(state.data.world.map((e) => e.cat))];
    const box = $("cats");
    box.innerHTML = "";
    cats.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-btn" + (cat === state.cat ? " active" : "");
      btn.textContent = cat;
      btn.dataset.cat = cat;
      btn.addEventListener("click", () => {
        state.cat = cat;
        [...box.children].forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
        renderStrip();
        renderDetail();
      });
      box.appendChild(btn);
    });
  }

  function matchKw(e) {
    if (!state.kw) return true;
    const t = `${e.title} ${e.region || ""} ${e.note || ""}`.toLowerCase();
    return t.includes(state.kw);
  }

  function visibleEvents(range) {
    return state.data.world
      .filter((e) => e.year >= range.from && e.year <= range.to)
      .filter((e) => state.cat === "全部" || e.cat === state.cat)
      .filter(matchKw)
      .sort((a, b) => a.year - b.year);
  }

  /* ---------- 世纪轴 ---------- */
  function renderStrip() {
    const strip = $("strip");
    const wrap = $("axis-wrap");
    const keepLeft = wrap ? wrap.scrollLeft : 0;
    strip.innerHTML = "";
    allCenturies().forEach((c) => {
      const col = document.createElement("article");
      col.className = "col";
      col.dataset.key = `${c.kind}${c.n}`;
      if (state.century && state.century.kind === c.kind && state.century.n === c.n) col.classList.add("active");

      const head = document.createElement("header");
      head.className = "col-head";
      const b = document.createElement("b");
      b.textContent = c.label;
      const s = document.createElement("span");
      s.textContent = c.sub;
      head.appendChild(b);
      head.appendChild(s);
      col.appendChild(head);

      const cnCell = document.createElement("div");
      cnCell.className = "cn-cell";
      const segs = state.data.cn.filter((d) => d.from <= c.to && d.to >= c.from);
      segs.forEach((d) => {
        const div = document.createElement("div");
        div.className = "seg" + (d.from < c.from ? " cont" : "");
        div.appendChild(document.createTextNode(d.name));
        const small = document.createElement("small");
        small.textContent = d.from < c.from ? "延续" : `${fmtYear(Math.max(d.from, MIN_YEAR))}起`;
        div.appendChild(small);
        cnCell.appendChild(div);
      });
      col.appendChild(cnCell);

      const wdCell = document.createElement("div");
      wdCell.className = "wd-cell";
      const evts = visibleEvents(c);
      evts.slice(0, 4).forEach((e) => wdCell.appendChild(makeChip(e)));
      if (evts.length > 4) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "chip more";
        more.textContent = `+${evts.length - 4} 件`;
        wdCell.appendChild(more);
      }
      col.appendChild(wdCell);

      col.addEventListener("click", () => {
        state.focusEvent = null;
        selectCentury(c, true);
      });
      strip.appendChild(col);
    });
    if (wrap) wrap.scrollLeft = keepLeft;
  }

  function makeChip(e) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (state.focusEvent === e ? " hit" : "");
    btn.dataset.cat = e.cat;
    btn.title = `${fmtYear(e.year)} · ${e.title}`;
    btn.textContent = `${e.title}`;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      state.focusEvent = e;
      const cc = centuryOfYear(clipYear(e.year));
      selectCentury(centuryInfo(cc.kind, cc.n), true);
    });
    return btn;
  }

  /* ---------- 选择与详情 ---------- */
  function selectCentury(c, scroll) {
    state.century = c;
    [...$("strip").children].forEach((col) => {
      col.classList.toggle("active", col.dataset.key === `${c.kind}${c.n}`);
    });
    const col = $("strip").children[allCenturies().findIndex((x) => x.kind === c.kind && x.n === c.n)];
    if (scroll && col) col.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });

    const url = new URL(location.href);
    url.searchParams.set("c", (c.kind === "bc" ? "前" : "") + c.n);
    history.replaceState(null, "", url.toString());

    renderDetail();
  }

  function renderDetail() {
    const c = state.century;
    if (!c) return;
    const box = $("detail");
    box.innerHTML = "";

    const h2 = document.createElement("h2");
    h2.textContent = c.label;
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = c.sub + " · 点击其他世纪可切换";
    box.appendChild(h2);
    box.appendChild(sub);

    const segs = state.data.cn.filter((d) => d.from <= c.to && d.to >= c.from);
    const h3cn = document.createElement("h3");
    h3cn.textContent = "这一时期的中国";
    box.appendChild(h3cn);
    segs.forEach((d) => {
      const div = document.createElement("div");
      div.className = "seg-item";
      const b = document.createElement("b");
      b.textContent = d.name;
      const em = document.createElement("em");
      em.textContent = `${fmtYear(Math.max(d.from, MIN_YEAR))} — ${fmtYear(d.to)}`;
      div.appendChild(b);
      div.appendChild(em);
      const p = document.createElement("p");
      p.textContent = d.note;
      div.appendChild(p);
      box.appendChild(div);
    });

    const mapA = document.createElement("a");
    mapA.className = "map-link";
    mapA.target = "_blank";
    mapA.rel = "noopener";
    mapA.textContent = "→ 在舆图中查看此时期疆域";
    mapA.href = mapUrl(midYear(c));
    box.appendChild(mapA);

    const h3wd = document.createElement("h3");
    h3wd.textContent = "同一时期的世界";
    box.appendChild(h3wd);

    const evts = visibleEvents(c);
    if (!evts.length) {
      const p = document.createElement("p");
      p.className = "detail-empty";
      p.textContent = state.cat === "全部" && !state.kw
        ? "本世纪暂未收录世界史节点。"
        : "当前筛选条件下本世纪没有节点，试试切换分类或清空检索。";
      box.appendChild(p);
      return;
    }

    evts.forEach((e) => {
      const div = document.createElement("div");
      div.className = "event";
      const top = document.createElement("div");
      top.className = "event-top";
      const y = document.createElement("span");
      y.className = "event-year";
      y.textContent = fmtYear(e.year);
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.dataset.cat = e.cat;
      tag.textContent = e.cat;
      const b = document.createElement("b");
      b.textContent = e.title;
      top.appendChild(y);
      top.appendChild(tag);
      top.appendChild(b);
      div.appendChild(top);

      if (e.region) {
        const r = document.createElement("p");
        r.textContent = e.region + (e.note ? "｜" + e.note : "");
        div.appendChild(r);
      }
      if (state.focusEvent === e) div.style.background = "#fbf2e0";
      box.appendChild(div);
    });
  }

  /* ---------- 交互 ---------- */
  function bindEvents() {
    $("btn-jump").addEventListener("click", jump);
    $("year-input").addEventListener("keydown", (e) => { if (e.key === "Enter") jump(); });

    $("kw-input").addEventListener("input", (e) => {
      state.kw = e.target.value.trim().toLowerCase();
      renderStrip();
      renderDetail();
    });

    $("btn-print").addEventListener("click", () => window.print());

    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const list = allCenturies();
      const idx = list.findIndex((x) => state.century && x.kind === state.century.kind && x.n === state.century.n);
      const next = idx + (e.key === "ArrowRight" ? 1 : -1);
      if (next >= 0 && next < list.length) {
        e.preventDefault();
        state.focusEvent = null;
        selectCentury(list[next], true);
      }
    });
  }

  function jump() {
    const raw = $("year-input").value.trim();
    if (!raw) return;
    const m = /^(前|bc|BC)?\s*(-?\d{1,4})$/.exec(raw);
    if (!m) {
      $("year-input").value = "";
      $("year-input").placeholder = "请输入如 -221 / 前221 / 1911";
      return;
    }
    let y = Number(m[2]);
    if (m[1] || y < 0) y = -Math.abs(y);
    if (y === 0 || y < MIN_YEAR || y > MAX_YEAR) {
      $("year-input").value = "";
      $("year-input").placeholder = `范围 ${MIN_YEAR}—${MAX_YEAR}，且无公元 0 年`;
      return;
    }
    state.focusEvent = null;
    selectCentury(centuryInfo(centuryOfYear(y).kind, centuryOfYear(y).n), true);

    const col = $("strip").children[allCenturies().findIndex((x) => x.kind === state.century.kind && x.n === state.century.n)];
    if (col) col.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  boot();
})();
