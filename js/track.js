/* 江山课堂 · 使用统计埋点（匿名/登录皆可）
 * 只上报事件名与简短 detail（≤120 字符）；不采集 IP、指纹或表单内容。
 * 服务端以随机访客 cookie（vid）区分匿名访客，登录用户自动关联账号。 */
(function () {
  "use strict";
  function send(event, detail) {
    try {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: event, detail: String(detail || "").slice(0, 120) }),
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* 离线/本地静态模式静默失败 */ }
  }
  send("pageview", location.pathname);
  window.jsTrack = send;
})();
