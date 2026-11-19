/* 江山时序（教学版）· 桌面版 preload：向前端暴露运行环境标志 */
"use strict";

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("jiangshanDesktop", {
  isDesktop: true,
  platform: process.platform,
  electron: process.versions.electron
});
