/* 江山课堂 · 登录 / 注册（单一用户账号） */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const api = window.ClassroomAPI;
  const params = new URLSearchParams(location.search);
  const next = params.get("next");
  const tab = params.get("tab");

  function msg(text, ok) {
    const el = $("#auth-msg");
    el.textContent = text;
    el.className = "msg" + (ok ? " ok" : "");
  }

  function go() {
    location.replace(next || "index.html");
  }

  function switchTab(id) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === id));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === id));
    msg("");
  }

  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  });

  function form(id, fn) {
    const el = document.getElementById(id);
    el.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = el.querySelector("button[type=submit]");
      const data = Object.fromEntries(new FormData(el).entries());
      btn.disabled = true;
      msg("处理中…", true);
      try {
        await fn(data);
        msg("成功，正在进入…", true);
        setTimeout(go, 200);
      } catch (err) {
        msg(err.message || "操作失败");
        btn.disabled = false;
      }
    });
  }

  form("t-login", (d) => api.login(d.username, d.password));
  form("t-register", (d) => api.register(d));

  (async () => {
    const alive = await api.health();
    if (!alive) {
      $("#offline").hidden = false;
      document.querySelectorAll(".pane .submit").forEach((b) => { b.disabled = true; });
      document.querySelectorAll(".pane input").forEach((i) => { i.disabled = true; });
      msg("服务端不可用，课件与题池仍可离线使用");
      return;
    }
    try {
      const user = await api.me();
      if (user) {
        msg(`已登录：${user.name}，正在进入…`, true);
        setTimeout(go, 300);
        return;
      }
    } catch (e) { /* 未登录 */ }

    if (tab === "register") switchTab("t-register");
  })();
})();
