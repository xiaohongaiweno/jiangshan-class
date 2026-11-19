/**
 * 江山时序（教学版）· 桌面版 Electron 主进程
 *
 * 零依赖打包仓库静态资源（舆图 / 86 课课件 / 688 题题池），通过自定义 app:// 协议加载，
 * 全部核心功能离线可用。在线部署专有的账号登录与站长统计在桌面版自动失效：
 *  - 前端 auth.js 探测 /api/health 失败 → 提示"课件与题池仍可离线使用"
 *  - 外部统计域名（vercount / cloudflareinsights）请求一律拦截
 *
 * 打包：仓库根目录执行 `npm run desktop:build`（electron-builder，配置见根 package.json "build" 字段）
 * 开发：`npm run desktop`
 */
"use strict";

const { app, BrowserWindow, Menu, protocol, net, shell, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

/* 仓库根目录：开发态与打包态均为 desktop/ 的上一级（electron-builder 将 files 按原结构放进 app.asar） */
const ROOT = path.resolve(__dirname, "..");
const SCHEME = "app";
const APP_HOST = "jiangshan";

/* 桌面版屏蔽的外部统计域名（不采集任何使用数据） */
const BLOCKED_HOSTS = [
  /(^|\.)vercount\.one$/i,
  /(^|\.)cloudflareinsights\.com$/i
];

/* app:// 需以特权协议注册：视为安全上下文、支持 fetch（classroom 相对路径 fetch 依赖此项） */
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
]);

/** 将 app://jiangshan/<path> 映射到仓库内文件；拒绝路径穿越 */
function resolveFilePath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname);
  } catch (e) {
    return null;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return null;
  return filePath;
}

/** 单文件 → file:// 响应；目录或无扩展名路径回退到其下的 index.html */
async function serveFile(filePath) {
  try {
    return await net.fetch(pathToFileURL(filePath).toString());
  } catch (e1) {
    try {
      return await net.fetch(pathToFileURL(path.join(filePath, "index.html")).toString());
    } catch (e2) {
      return new Response("Not Found", { status: 404 });
    }
  }
}

function installProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const filePath = resolveFilePath(request.url);
    if (!filePath) return new Response("Forbidden", { status: 403 });
    return serveFile(filePath);
  });
}

function installRequestFilter() {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const host = new URL(details.url).hostname;
      if (BLOCKED_HOSTS.some((re) => re.test(host))) {
        callback({ cancel: true });
        return;
      }
    } catch (e) { /* 非 http(s) URL 放行 */ }
    callback({});
  });
}

function buildMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "进入/退出全屏（投屏）" }
      ]
    },
    { role: "editMenu", label: "编辑" },
    ...(process.platform === "darwin" ? [] : [{ role: "windowMenu", label: "窗口" }])
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: "江山时序（教学版）",
    backgroundColor: "#f3eee4",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  /* 应用内链接走本窗口；外部链接交给系统浏览器，避免在壳内打开陌生站点 */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SCHEME + "://")) {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(SCHEME + "://" + APP_HOST + "/index.html");
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.setName("江山时序");

  app.whenReady().then(() => {
    installRequestFilter();
    installProtocol();
    buildMenu();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
