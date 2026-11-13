/**
 * 江山时序 · Service Worker（离线缓存）
 *
 * 策略：
 * - 页面导航：网络优先，失败回落缓存（离线仍可打开整站）；
 * - 同源静态资源（js / css / json / geojson / 图片等）：stale-while-revalidate——
 *   先回缓存保证秒开与离线可用，后台异步更新，下次访问生效；
 * - 跨域资源（古琴音频等 CDN）与 /api/ 账号接口一律直接走网络，不缓存。
 *
 * 版本升级：改这里 CACHE 前缀的版本号即可清空旧缓存。
 */
"use strict";

const CACHE = "jiangshan-cache-v1";
const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "manifest.webmanifest",
  "assets/favicon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

function isStatic(url) {
  return /\.(js|css|json|geojson|webp|png|jpg|svg|webmanifest|woff2?|ogg|mp3|mp4)$/i.test(url.pathname) || url.pathname === "/";
}

async function swr(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => undefined);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (req.headers.has("range")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() =>
        caches.match(req).then((hit) => hit || caches.match("index.html"))
      )
    );
    return;
  }

  if (isStatic(url)) {
    event.respondWith(swr(req));
  }
});
