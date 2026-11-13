/* 江山课堂 · 服务端 API 客户端（无依赖） */
(function () {
  "use strict";

  async function request(path, opts) {
    const o = opts || {};
    const init = {
      method: o.method || "GET",
      credentials: "same-origin",
      headers: {}
    };
    if (o.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(o.body);
    }
    const res = await fetch(path, init);
    const type = res.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : `请求失败（${res.status}）`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  window.ClassroomAPI = {
    get: (p) => request(p),
    post: (p, body) => request(p, { method: "POST", body }),
    del: (p) => request(p, { method: "DELETE" }),

    /** 探测服务端是否可用（同源 /api/health） */
    async health() {
      try {
        const r = await fetch("/api/health", { credentials: "same-origin" });
        if (!r.ok) return false;
        const j = await r.json();
        return !!(j && j.ok);
      } catch (e) {
        return false;
      }
    },

    me: () => request("/api/auth/me").then((r) => r.user),
    login: (username, password) => request("/api/auth/login", { method: "POST", body: { username, password } }),
    register: (payload) => request("/api/auth/register", { method: "POST", body: payload }),
    logout: () => request("/api/auth/logout", { method: "POST" }),
    changePassword: (current, next) =>
      request("/api/auth/password", { method: "POST", body: { current, next } }),

    /** 未登录时跳到登录页，登录后回跳 */
    requireLogin() {
      const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
      location.replace(`login.html?next=${next}`);
    }
  };
})();
