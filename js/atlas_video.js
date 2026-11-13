/**
 * Historical Video Generator Module (历史视频生成器)
 * Renders an all-in-one 9:16 vertical short film (30–90s) fully in the browser and
 * exports it as MP4/H.264 — no headless browser, no FFmpeg, no build step.
 *
 * Pipeline: storyboard → deterministic canvas frames → WebCodecs VideoEncoder →
 * mp4-muxer → <Blob download>. Background music reuses the public-domain guqin
 * tracks, encoded to AAC through WebCodecs AudioEncoder.
 *
 * Attaches its methods onto HistoricalAtlasController.prototype via the same mixin
 * queue used by js/atlas_quiz.js, so load order with js/app.js does not matter.
 */
(function () {
  'use strict';

  let HistoricalAtlasController = null;

  // ---------------------------------------------------------------------------
  // Palette / typography — mirrors the tokens in css/style.css.
  // ---------------------------------------------------------------------------
  const SERIF = '"Noto Serif SC","Songti SC","SimSun",serif';
  const SANS = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
  const INK = '#2b2622';
  const VERMILION = '#b5452f';
  const GOLD = '#c6952b';
  const NEIGHBOR_FILL = 'rgba(168,122,76,0.13)';
  const REGION_STROKE = 'rgba(104,28,12,0.5)';
  const CORRIDOR_STYLE = {
    wall: { color: '#5a3826', width: 2.4, dash: [5, 2.5] },
    canal: { color: '#1f6f8b', width: 2.2, dash: [7, 3] },
    silk: { color: '#9c6317', width: 1.7, dash: [2.5, 3.5] },
    road: { color: '#9c6317', width: 1.7, dash: [2.5, 3.5] },
    sea: { color: '#2c5d8f', width: 1.7, dash: [2, 4] },
  };

  // Terrain relief placement inside the projector coordinate space (see index.html
  // <image id="terrain-relief-img"> inside #camera-rig).
  const TERRAIN_SRC = 'assets/terrain_relief.webp';
  const TERRAIN_HI_SRC = 'assets/terrain_relief_hi.webp';
  const TERRAIN_RECT = { x: -80, y: -40, w: 1160, h: 780 };

  const AVC_CANDIDATES = [
    'avc1.640034',
    'avc1.640033',
    'avc1.640032',
    'avc1.64002a',
    'avc1.4d0034',
    'avc1.4d0033',
    'avc1.4d0032',
    'avc1.42e033',
    'avc1.42e032',
    'avc1.42003e',
    'avc1.420032',
  ];

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return `rgba(138,90,60,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function yearLabel(y, isEn) {
    if (isEn) return y < 0 ? `${Math.abs(y)} BC` : `AD ${y}`;
    return y < 0 ? `前 ${Math.abs(y)} 年` : `${y} 年`;
  }

  // Greedy line breaker that treats CJK characters as individual tokens.
  function wrapText(ctx, text, maxWidth) {
    const src = String(text || '');
    if (!src) return [];
    const tokens = [];
    let buf = '';
    for (const ch of src) {
      if (/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(ch)) {
        if (buf) tokens.push(buf);
        buf = '';
        tokens.push(ch);
      } else if (ch === ' ') {
        if (buf) tokens.push(buf);
        buf = '';
        tokens.push(' ');
      } else {
        buf += ch;
      }
    }
    if (buf) tokens.push(buf);
    const lines = [];
    let cur = '';
    for (const tk of tokens) {
      const next = cur + tk;
      if (cur && ctx.measureText(next.trimEnd()).width > maxWidth) {
        lines.push(cur.trimEnd());
        cur = tk === ' ' ? '' : tk;
      } else {
        cur = next;
      }
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    return lines;
  }

  class AtlasVideoMixin {
    // -------------------------------------------------------------------------
    // UI bootstrap
    // -------------------------------------------------------------------------
    _initVideoStudio() {
      if (this._videoStudioReady) return;
      const ids = [
        'act-video-studio',
        'video-studio-card',
        'act-close-video-studio',
        'video-studio-canvas',
        'video-topic-select',
        'video-duration-select',
        'video-quality-select',
        'video-bgm-select',
        'act-video-generate',
        'act-video-cancel',
        'act-video-download',
        'video-progress-fill',
        'video-studio-status',
        'video-studio-note',
      ];
      const el = {};
      for (const id of ids) el[id] = this._id(id);
      if (!el['act-video-studio'] || !el['video-studio-card'] || !el['video-studio-canvas']) return;
      this._videoStudioReady = true;
      this._videoEl = el;
      this._videoBusy = false;
      this._videoCancelled = false;
      this._videoGeoCache = new Map();

      this._videoPopulateSelects();

      el['act-video-studio'].addEventListener('click', () => this._toggleVideoStudio());
      el['act-close-video-studio'].addEventListener('click', () => this._toggleVideoStudio(false));
      el['act-video-generate'].addEventListener('click', () => this._videoExport());
      el['act-video-cancel'].addEventListener('click', () => {
        this._videoCancelled = true;
        this._videoSetStatus('正在取消…');
      });
      el['video-quality-select'].addEventListener('change', () => this._videoResizeCanvas());

      const support = this._videoCheckEnvironment();
      if (!support.ok) {
        el['act-video-generate'].disabled = true;
        this._videoSetNote(support.msg);
      } else {
        this._videoSetNote(this._videoSupportNote());
      }
      this._videoSyncLabels();
      this._videoResizeCanvas();
    }

    _videoPopulateSelects() {
      const el = this._videoEl;
      const isEn = this.locale === 'en';
      const journeys = this._videoJourneys();
      const topicSel = el['video-topic-select'];
      const prevTopic = topicSel.value;
      topicSel.innerHTML = '';
      journeys.forEach((j, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = this._videoJourneyLabel(j, isEn);
        topicSel.appendChild(opt);
      });
      if (!journeys.length) {
        const opt = document.createElement('option');
        opt.value = '-1';
        opt.textContent = isEn ? 'No journey data' : '无可用题材';
        topicSel.appendChild(opt);
      } else if (prevTopic && topicSel.querySelector(`option[value="${prevTopic}"]`)) {
        topicSel.value = prevTopic;
      }
      const bgmSel = el['video-bgm-select'];
      const prevBgm = bgmSel.value;
      bgmSel.innerHTML = '';
      const none = document.createElement('option');
      none.value = 'none';
      none.textContent = isEn ? 'Silent' : '无配乐';
      bgmSel.appendChild(none);
      const tracks = HistoricalAtlasController.GUQIN_TRACKS || [];
      tracks.forEach((t, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `古琴 · ${t.zh}`;
        bgmSel.appendChild(opt);
      });
      bgmSel.value =
        prevBgm && bgmSel.querySelector(`option[value="${prevBgm}"]`)
          ? prevBgm
          : tracks.length
            ? '2'
            : 'none';
    }

    _videoJourneyLabel(j, isEn) {
      return isEn ? j.titleEn || j.shortEn || j.key : j.titleZh || j.shortZh || j.key;
    }

    _videoSyncLabels() {
      const el = this._videoEl;
      if (!el) return;
      const isEn = this.locale === 'en';
      const setText = (id, zh, en) => {
        const node = this._id(id);
        if (node) node.textContent = isEn ? en : zh;
      };
      setText('lbl-video-studio', '影像', 'Film');
      setText('txt-video-studio-kicker', '影像 · 一键成片', 'Film · one tap');
      setText('lbl-video-topic', '题材', 'Topic');
      setText('lbl-video-duration', '时长', 'Length');
      setText('lbl-video-quality', '画质', 'Quality');
      setText('lbl-video-bgm', '配乐', 'Score');
      if (el['act-video-generate'] && !this._videoBusy) {
        el['act-video-generate'].textContent = isEn ? 'Generate video' : '生成视频';
      }
      if (el['act-video-cancel']) el['act-video-cancel'].textContent = isEn ? 'Cancel' : '取消';
      if (el['act-video-download']) {
        el['act-video-download'].textContent = isEn ? 'Download MP4' : '下载 MP4';
      }
      const trigger = el['act-video-studio'];
      if (trigger) {
        trigger.title = isEn
          ? 'Turn a journey into a vertical history short (MP4)'
          : '把行迹一键生成竖屏历史短视频（MP4）';
      }
    }

    _toggleVideoStudio(force) {
      const card = this._videoEl['video-studio-card'];
      const open = force === undefined ? card.classList.contains('is-hidden') : Boolean(force);
      card.classList.toggle('is-hidden', !open);
      const trigger = this._videoEl['act-video-studio'];
      if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        this._videoPopulateSelects();
        this._videoSyncLabels();
        this._videoResizeCanvas();
      }
    }

    _videoDims(size) {
      // AVC requires even dimensions; 9:16 portrait keeps width as the quality knob.
      const w = Math.max(2, Math.round(size / 2) * 2);
      const h = Math.max(2, Math.round((w * 16) / 9 / 2) * 2);
      return { w, h };
    }

    _videoResizeCanvas() {
      const el = this._videoEl;
      if (!el || !el['video-studio-canvas']) return;
      const size = Number(el['video-quality-select'].value) || 1080;
      const canvas = el['video-studio-canvas'];
      const { w, h } = this._videoDims(size);
      canvas.width = w;
      canvas.height = h;
    }

    _videoTargetSize() {
      const size = Number(this._videoEl['video-quality-select'].value) || 1080;
      return this._videoDims(size);
    }

    _videoSetStatus(msg, kind) {
      const el = this._videoEl;
      if (!el || !el['video-studio-status']) return;
      el['video-studio-status'].textContent = msg;
      el['video-studio-status'].dataset.kind = kind || '';
    }

    _videoSetNote(msg) {
      const el = this._videoEl;
      if (!el || !el['video-studio-note']) return;
      el['video-studio-note'].textContent = msg || '';
    }

    _videoSetProgress(ratio) {
      const el = this._videoEl;
      if (!el || !el['video-progress-fill']) return;
      el['video-progress-fill'].style.width = `${Math.round(clamp01(ratio) * 100)}%`;
    }

    // -------------------------------------------------------------------------
    // Environment / capability probing
    // -------------------------------------------------------------------------
    _videoCheckEnvironment() {
      const isEn = this.locale === 'en';
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return { ok: false, msg: 'no-dom' };
      }
      if (!window.isSecureContext) {
        return {
          ok: false,
          msg: isEn
            ? 'WebCodecs needs a secure context (https or localhost).'
            : '视频编码需要安全上下文（https 或 localhost）才能运行。',
        };
      }
      if (typeof window.VideoEncoder === 'undefined' || typeof window.VideoFrame === 'undefined') {
        return {
          ok: false,
          msg: isEn
            ? 'This browser has no WebCodecs VideoEncoder. Use Chrome / Edge 94+ or Safari 16.4+.'
            : '当前浏览器不支持 WebCodecs VideoEncoder，请使用 Chrome / Edge 94+ 或 Safari 16.4+。',
        };
      }
      if (!window.Mp4Muxer || typeof window.Mp4Muxer.Muxer !== 'function') {
        return {
          ok: false,
          msg: isEn ? 'MP4 muxer failed to load.' : 'MP4 封装库未能加载。',
        };
      }
      return { ok: true };
    }

    _videoSupportNote() {
      const isEn = this.locale === 'en';
      const aac = typeof window.AudioEncoder !== 'undefined';
      return isEn
        ? `Ready · 9:16 · 30 fps · MP4/H.264 up to 2160×3840 (auto-fallback by browser capability)${aac ? ' + guqin BGM (AAC)' : ' (no audio encoder → silent video)'}`
        : `就绪 · 竖屏 9:16 · 30fps · MP4/H.264（最高 2160×3840，依浏览器能力自动降级）${aac ? ' · 古琴配乐（AAC）' : '（无音频编码器，将导出无声视频）'}`;
    }

    _videoBitrate(w, h, fps) {
      // 0.22 bit/pixel/frame preserves map hairlines and CJK glyph edges; the
      // 64 Mbps ceiling leaves room for 2160×3840 without starving detail.
      return Math.min(64e6, Math.max(6e6, Math.round(w * h * fps * 0.22)));
    }

    async _videoPickCodec(w, h, fps) {
      const bitrate = this._videoBitrate(w, h, fps);
      for (const codec of AVC_CANDIDATES) {
        try {
          const res = await VideoEncoder.isConfigSupported({
            codec,
            width: w,
            height: h,
            bitrate,
            framerate: fps,
            latencyMode: 'quality',
          });
          if (res && res.supported) return { codec, bitrate, width: w, height: h };
        } catch (_) {
          /* try next candidate */
        }
      }
      return null;
    }

    // -------------------------------------------------------------------------
    // Storyboard construction
    // -------------------------------------------------------------------------
    _videoJourneys() {
      const list = (HistoricalAtlasController && HistoricalAtlasController.HISTORICAL_JOURNEYS) || [];
      return list.filter((j) => j && Array.isArray(j.stops) && j.stops.length >= 2);
    }

    _videoFitCamera(coords, pad, minW) {
      const p = this.projector;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of coords) {
        if (!Array.isArray(c)) continue;
        const [x, y] = p.toScreen(c[0], c[1]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (!Number.isFinite(minX)) return { x: 350, y: 215, w: 500, h: 500 / this._videoAspect };
      const aspect = this._videoAspect;
      let bw = Math.max(maxX - minX, 1);
      let bh = Math.max(maxY - minY, 1);
      if (bw / bh > aspect) bh = bw / aspect;
      else bw = bh * aspect;
      bw *= pad;
      bh *= pad;
      const floorW = minW || 150;
      if (bw < floorW) {
        bw = floorW;
        bh = bw / aspect;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    }

    _videoBuildStoryboard(journey, targetSec, fps, aspect, outputWidth) {
      this._videoAspect = aspect;
      // Wider floor on 4K keeps the 4× relief sheet at ~1.2× magnification or less.
      const stopMinW = Math.max(175, Math.round((outputWidth || 1080) / 9.6));
      const isEn = this.locale === 'en';
      const stops = journey.stops;
      const title = isEn ? journey.titleEn || journey.shortEn : journey.titleZh || journey.shortZh;
      const span = isEn ? journey.spanEn : journey.spanZh;
      const short = isEn ? journey.shortEn : journey.shortZh;

      const titleDur = 3.4;
      const outroDur = 4.0;
      const perStop = Math.min(8, Math.max(3.0, (targetSec - titleDur - outroDur) / stops.length));

      const allCoords = [];
      for (const s of stops) {
        allCoords.push(s.coord);
        for (const v of s.via || []) allCoords.push(v);
      }
      const camOverview = this._videoFitCamera(allCoords, 1.3, 320);

      const legs = stops.map((s, i) => {
        if (i === 0) return [s.coord];
        const pts = [];
        const from = s.fromCoord || stops[i - 1].coord;
        pts.push(from);
        for (const v of s.via || []) pts.push(v);
        pts.push(s.coord);
        return pts;
      });

      const shots = [];
      shots.push({
        kind: 'title',
        dur: titleDur,
        cam: camOverview,
        yearFrom: stops[0].year,
        yearTo: stops[0].year,
        legIndex: -1,
        text: {
          top: title,
          sub: span,
          place: short,
          era: '',
          desc: isEn
            ? `${stops.length} stops on one map · a journey through time`
            : `一图纵览 ${stops.length} 站 · 山河为证，岁月为凭`,
        },
      });

      stops.forEach((s, i) => {
        const prev = i > 0 ? stops[i - 1] : null;
        const focus = prev ? [prev.coord, ...(s.via || []), s.coord] : [s.coord];
        const cam = this._videoFitCamera(focus, 1.62, stopMinW);
        const ancient = isEn ? s.ancientEn || s.ancientZh : s.ancientZh;
        const modern = isEn ? s.modernEn || s.modernZh : s.modernZh;
        shots.push({
          kind: 'stop',
          dur: perStop,
          cam,
          yearFrom: prev ? prev.year : s.year,
          yearTo: s.year,
          legIndex: i,
          stopOrder: i + 1,
          text: {
            top: title,
            sub: '',
            place: modern ? `${ancient}（${isEn ? 'now ' : '今'}${modern}）` : ancient,
            era: isEn ? '' : s.eraZh || '',
            desc: (isEn ? s.descEn || s.descZh : s.descZh) || '',
            kicker: isEn ? s.titleEn || s.titleZh : s.titleZh || '',
          },
        });
      });

      shots.push({
        kind: 'outro',
        dur: outroDur,
        cam: camOverview,
        yearFrom: stops[stops.length - 1].year,
        yearTo: stops[stops.length - 1].year,
        legIndex: legs.length,
        text: {
          top: title,
          sub: span,
          place: isEn ? 'Map of Chinese History' : '江山时序 · 中国历史地图',
          era: '',
          desc: isEn ? 'Follow the map · explore 2,400 years' : '循一图而览千年 · 江山时序',
        },
      });

      const totalDur = shots.reduce((a, s) => a + s.dur, 0);
      return {
        journey,
        shots,
        legs,
        totalDur,
        fps,
        frames: Math.max(1, Math.round(totalDur * fps)),
        title,
        span,
      };
    }

    _videoFrameState(board, frames) {
      const fps = board.fps;
      const t = frames / fps;
      let acc = 0;
      let idx = board.shots.length - 1;
      for (let i = 0; i < board.shots.length; i++) {
        if (t < acc + board.shots[i].dur) {
          idx = i;
          break;
        }
        acc += board.shots[i].dur;
      }
      const shot = board.shots[idx];
      const prev = board.shots[Math.max(0, idx - 1)];
      const local = clamp01((t - acc) / shot.dur);
      const camP = easeInOutCubic(clamp01(local / 0.42));
      const cam = {
        x: lerp(prev.cam.x, shot.cam.x, camP),
        y: lerp(prev.cam.y, shot.cam.y, camP),
        w: lerp(prev.cam.w, shot.cam.w, camP),
        h: lerp(prev.cam.h, shot.cam.h, camP),
      };
      const yearP = easeInOutCubic(clamp01((local - 0.1) / 0.62));
      const year = Math.round(shot.yearFrom + (shot.yearTo - shot.yearFrom) * yearP);
      const routeP = easeInOutCubic(clamp01((local - 0.28) / 0.6));
      return { shot, idx, local, cam, year, routeP, time: t };
    }

    // -------------------------------------------------------------------------
    // Geometry caches
    // -------------------------------------------------------------------------
    _videoSnapFor(year) {
      const di = this._findDynastyIndex(year);
      const dynasty = this.dynasties[di] || this.dynasties[0];
      const key = this._resolveSnapKey(dynasty, year);
      let geo = this._videoGeoCache.get(key);
      if (geo === undefined) {
        const snap = this.snapshots && this.snapshots[key];
        geo = snap ? this._videoBuildGeo(snap) : null;
        this._videoGeoCache.set(key, geo);
      }
      return { dynasty, key, geo };
    }

    _videoBuildGeo(snap) {
      const roles = { neighbor: 0, main: 1, rival: 2, protectorate: 3 };
      const src = (snap.polities || []).slice().sort((a, b) => (roles[a.role] || 0) - (roles[b.role] || 0));
      const polities = [];
      for (const pol of src) {
        if (!pol || !pol.shape) continue;
        const d = this.projector.shapeToSvgPath(pol.shape);
        if (!d) continue;
        const role = pol.role || 'main';
        const tint = pol.tint || '#8a5a3c';
        let color;
        let lw = 0;
        let dash = null;
        if (role === 'neighbor') {
          color = NEIGHBOR_FILL;
          lw = 0;
        } else if (role === 'rival') {
          color = hexToRgba(tint, 0.3);
          lw = 1.4;
        } else if (role === 'protectorate') {
          color = hexToRgba(tint, 0.22);
          lw = 1.2;
          dash = [5, 3];
        } else {
          color = hexToRgba(tint, 0.34);
          lw = 1.6;
        }
        polities.push({ path: new Path2D(d), color, lw, dash });
      }
      const boundarySrc =
        Array.isArray(snap.regions) && snap.regions.length ? snap.regions : snap.prefectures || [];
      const boundaries = [];
      for (const item of boundarySrc) {
        if (!item || !item.shape) continue;
        const d = this.projector.shapeToSvgPath(item.shape);
        if (d) boundaries.push(new Path2D(d));
      }
      return { polities, boundaries };
    }

    _videoCorridorPaths() {
      if (this._videoCorrCache) return this._videoCorrCache;
      const out = [];
      for (const c of this.corridors || []) {
        let d = '';
        for (const seg of c.segments || []) {
          for (let i = 0; i < seg.length; i++) {
            const [px, py] = this.projector.toScreen(seg[i][0], seg[i][1]);
            d += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1);
          }
        }
        if (d) out.push({ path: new Path2D(d), kind: c.kind, span: c.span });
      }
      this._videoCorrCache = out;
      return out;
    }

    // -------------------------------------------------------------------------
    // Frame rendering
    // -------------------------------------------------------------------------
    _videoRenderFrame(ctx, st, board) {
      const W = ctx.canvas.width;
      const H = ctx.canvas.height;
      const S = W / 1080;
      const cam = st.cam;
      const sx = W / cam.w;
      const sy = H / cam.h;
      const devP = (px, py) => [(px - cam.x) * sx, (py - cam.y) * sy];
      const dev = (lng, lat) => {
        const [px, py] = this.projector.toScreen(lng, lat);
        return devP(px, py);
      };
      const isEn = this.locale === 'en';
      const margin = 48 * S;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const sea = ctx.createLinearGradient(0, 0, 0, H);
      sea.addColorStop(0, '#dfe7e4');
      sea.addColorStop(1, '#c9d7d5');
      ctx.fillStyle = sea;
      ctx.fillRect(0, 0, W, H);

      const info = this._videoSnapFor(st.year);

      // --- scaled vector layers -------------------------------------------
      ctx.save();
      ctx.setTransform(sx, 0, 0, sy, -cam.x * sx, -cam.y * sy);
      if (this._videoTerrain) {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(this._videoTerrain, TERRAIN_RECT.x, TERRAIN_RECT.y, TERRAIN_RECT.w, TERRAIN_RECT.h);
        ctx.globalAlpha = 1;
      }
      const geo = info.geo;
      if (geo) {
        for (const pol of geo.polities) {
          ctx.fillStyle = pol.color;
          ctx.fill(pol.path);
          if (pol.lw > 0) {
            ctx.strokeStyle = pol.color;
            ctx.lineWidth = pol.lw / sx;
            ctx.lineJoin = 'round';
            if (pol.dash) ctx.setLineDash(pol.dash.map((v) => v / sx));
            else ctx.setLineDash([]);
            ctx.stroke(pol.path);
          }
        }
        ctx.setLineDash([]);
        ctx.strokeStyle = REGION_STROKE;
        ctx.lineWidth = 1.2 / sx;
        ctx.setLineDash([7 / sx, 3 / sx]);
        ctx.lineJoin = 'round';
        for (const b of geo.boundaries) ctx.stroke(b);
        ctx.setLineDash([]);

        for (const corr of this._videoCorridorPaths()) {
          if (corr.span && (st.year < corr.span[0] || st.year > corr.span[1])) continue;
          const style = CORRIDOR_STYLE[corr.kind] || CORRIDOR_STYLE.road;
          ctx.strokeStyle = style.color;
          ctx.lineWidth = style.width / sx;
          ctx.lineCap = 'round';
          ctx.setLineDash(style.dash.map((v) => v / sx));
          ctx.stroke(corr.path);
        }
        ctx.setLineDash([]);
      }
      ctx.restore();

      // --- settlements ----------------------------------------------------
      this._videoDrawSettlements(ctx, info.dynasty, st, dev, W, H, S, sx);

      // --- journey route --------------------------------------------------
      this._videoDrawRoute(ctx, board, st, dev, W, S);

      // --- stop markers ---------------------------------------------------
      this._videoDrawStops(ctx, board, st, dev, W, H, S, isEn);

      // --- overlays -------------------------------------------------------
      this._videoDrawOverlays(ctx, board, st, info, W, H, S, isEn, margin);
    }

    _videoDrawSettlements(ctx, dynasty, st, dev, W, H, S, sx) {
      if (!dynasty || !Array.isArray(dynasty.settlements)) return;
      const zoom = 1080 / st.cam.w * (W / 1080);
      const showTier2 = zoom > 2.15;
      const list = dynasty.settlements.filter(
        (s) =>
          (s.appear === undefined || st.year >= s.appear) &&
          (s.vanish === undefined || st.year < s.vanish) &&
          (!s.tier || s.tier !== 2 || showTier2 || s.isCapital)
      );
      ctx.font = `700 ${13 * S}px ${SERIF}`;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (const s of list) {
        const [x, y] = dev(s.coord[0], s.coord[1]);
        if (x < -80 || x > W + 80 || y < -60 || y > H + 60) continue;
        const isCap = Boolean(s.isCapital);
        const r = (isCap ? 3.1 : 2.3) * S;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = isCap ? VERMILION : '#fffdf8';
        ctx.fill();
        ctx.lineWidth = 1.4 * S;
        ctx.strokeStyle = isCap ? '#fffdf8' : '#2b2622';
        ctx.stroke();
        const name = s.ancient;
        if (!name) continue;
        const align = s.align || 'r';
        const anchorEnd = align === 'l';
        const dx = anchorEnd ? -8 * S : 8 * S;
        const dy = align === 'b' ? 14 * S : align === 't' ? -12 * S : 0;
        ctx.textAlign = anchorEnd ? 'right' : 'left';
        ctx.lineWidth = 3.4 * S;
        ctx.strokeStyle = 'rgba(249,244,234,0.92)';
        ctx.strokeText(name, x + dx, y + dy);
        ctx.fillStyle = isCap ? '#72190b' : '#1c1713';
        ctx.fillText(name, x + dx, y + dy);
      }
      ctx.textAlign = 'left';
    }

    _videoTrimPolyline(pts, frac) {
      if (frac >= 1 || pts.length < 2) return pts.slice();
      if (frac <= 0) return [];
      let total = 0;
      const segLen = [];
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        segLen.push(d);
        total += d;
      }
      const want = total * frac;
      const out = [pts[0]];
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = segLen[i - 1];
        if (acc + d <= want) {
          out.push(pts[i]);
          acc += d;
        } else {
          const t = d > 0 ? (want - acc) / d : 0;
          out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
          break;
        }
      }
      return out;
    }

    _videoStroke(ctx, pts, color, width, dash) {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    _videoDrawRoute(ctx, board, st, dev, W, S) {
      const accent = board.journey.color || VERMILION;
      const legs = board.legs;
      const active = st.shot.legIndex;
      const toDev = (leg) => leg.map((c) => dev(c[0], c[1]));

      // Upcoming (faint dashed hint of the whole itinerary).
      for (let i = Math.max(1, active + 1); i < legs.length; i++) {
        this._videoStroke(ctx, toDev(legs[i]), 'rgba(146,78,62,0.32)', 3.2 * S, [7 * S, 9 * S]);
      }
      // Passed legs.
      for (let i = 1; i <= Math.min(active, legs.length - 1); i++) {
        if (i === active) continue;
        this._videoStroke(ctx, toDev(legs[i]), 'rgba(252,248,240,0.92)', 10 * S, null);
        this._videoStroke(ctx, toDev(legs[i]), hexToRgba(accent, 0.88), 5.4 * S, null);
      }
      // Active leg growing under the camera.
      if (active >= 1 && active < legs.length) {
        const full = toDev(legs[active]);
        const grown = this._videoTrimPolyline(full, st.routeP);
        if (grown.length >= 2) {
          this._videoStroke(ctx, grown, 'rgba(252,248,240,0.95)', 11 * S, null);
          this._videoStroke(ctx, grown, accent, 6 * S, null);
          const head = grown[grown.length - 1];
          ctx.beginPath();
          ctx.arc(head[0], head[1], 9 * S, 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(accent, 0.28);
          ctx.fill();
        }
      }
    }

    _videoDrawStops(ctx, board, st, dev, W, H, S, isEn) {
      const accent = board.journey.color || VERMILION;
      const stops = board.journey.stops;
      const active = st.shot.legIndex;
      const pulse = 1 + 0.16 * Math.sin(st.time * 5);
      ctx.font = `700 ${15 * S}px ${SERIF}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (let i = 0; i < stops.length; i++) {
        const [x, y] = dev(stops[i].coord[0], stops[i].coord[1]);
        const reached = i <= active;
        const current = i === active;
        const r = (current ? 8.5 : reached ? 6 : 4.5) * S;
        if (current) {
          ctx.beginPath();
          ctx.arc(x, y, r * 2.1 * pulse, 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(accent, 0.16);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = reached ? accent : 'rgba(252,248,240,0.78)';
        ctx.fill();
        ctx.lineWidth = 2.4 * S;
        ctx.strokeStyle = reached ? '#fffdf8' : hexToRgba(accent, 0.7);
        ctx.stroke();
        if (current) {
          const ancient = isEn ? stops[i].ancientEn || stops[i].ancientZh : stops[i].ancientZh;
          const label = `${ancient}`;
          const tw = ctx.measureText(label).width;
          const bx = x - tw / 2 - 12 * S;
          const by = y - r * 2.1 * pulse - 44 * S;
          this._videoRoundRect(ctx, bx, by, tw + 24 * S, 32 * S, 8 * S);
          ctx.fillStyle = 'rgba(20,16,12,0.72)';
          ctx.fill();
          ctx.fillStyle = '#fdf8ef';
          ctx.fillText(label, x - tw / 2, by + 16 * S);
        }
      }
    }

    _videoRoundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    _videoDrawOverlays(ctx, board, st, info, W, H, S, isEn, margin) {
      const shot = st.shot;
      const isCard = shot.kind === 'title' || shot.kind === 'outro';

      // Vignette + scrims.
      const topH = 470 * S;
      const topScrim = ctx.createLinearGradient(0, 0, 0, topH);
      topScrim.addColorStop(0, 'rgba(18,14,10,0.72)');
      topScrim.addColorStop(1, 'rgba(18,14,10,0)');
      ctx.fillStyle = topScrim;
      ctx.fillRect(0, 0, W, topH);

      const botH = 700 * S;
      const botScrim = ctx.createLinearGradient(0, H - botH, 0, H);
      botScrim.addColorStop(0, 'rgba(18,14,10,0)');
      botScrim.addColorStop(0.55, 'rgba(18,14,10,0.55)');
      botScrim.addColorStop(1, 'rgba(18,14,10,0.85)');
      ctx.fillStyle = botScrim;
      ctx.fillRect(0, H - botH, W, botH);

      const isEn2 = isEn;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';

      // Seal chip.
      ctx.font = `700 ${27 * S}px ${SERIF}`;
      const sealText = isEn2 ? 'JIANG SHAN' : '江山时序';
      const sealW = ctx.measureText(sealText).width + 40 * S;
      this._videoRoundRect(ctx, margin, 52 * S, sealW, 54 * S, 10 * S);
      ctx.fillStyle = VERMILION;
      ctx.fill();
      ctx.fillStyle = '#fdf6ec';
      ctx.fillText(sealText, margin + 20 * S, 52 * S + 37 * S);

      // Year + dynasty badge (top-right).
      const badge = `${yearLabel(st.year, isEn2)} · ${info.dynasty.title || ''}`;
      ctx.font = `700 ${30 * S}px ${SANS}`;
      const bw = ctx.measureText(badge).width + 40 * S;
      this._videoRoundRect(ctx, W - margin - bw, 52 * S, bw, 54 * S, 10 * S);
      ctx.fillStyle = 'rgba(18,14,10,0.45)';
      ctx.fill();
      ctx.lineWidth = 1.5 * S;
      ctx.strokeStyle = hexToRgba(GOLD, 0.75);
      ctx.stroke();
      ctx.fillStyle = '#f6e6c8';
      ctx.fillText(badge, W - margin - bw + 20 * S, 52 * S + 37 * S);

      // Title block.
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 14 * S;
      ctx.shadowOffsetY = 3 * S;
      ctx.fillStyle = '#fdf8ef';
      ctx.font = `700 ${62 * S}px ${SERIF}`;
      const titleLines = wrapText(ctx, shot.text.top, W - margin * 2);
      let ty = 190 * S;
      for (const line of titleLines.slice(0, 2)) {
        ctx.fillText(line, margin, ty);
        ty += 78 * S;
      }
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      if (shot.text.sub) {
        ctx.font = `500 ${30 * S}px ${SANS}`;
        ctx.fillStyle = 'rgba(248,236,216,0.88)';
        ctx.fillText(shot.text.sub, margin, ty + 8 * S);
      }

      // Bottom information block.
      let by = H - 330 * S;
      if (shot.text.era) {
        ctx.font = `600 ${28 * S}px ${SANS}`;
        ctx.fillStyle = hexToRgba(GOLD, 0.95);
        ctx.fillText(shot.text.era, margin, by - 46 * S);
      }
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 12 * S;
      ctx.fillStyle = '#fdf8ef';
      ctx.font = `700 ${isCard ? 46 * S : 54 * S}px ${SERIF}`;
      const placeLines = wrapText(ctx, shot.text.place, W - margin * 2);
      for (const line of placeLines.slice(0, 2)) {
        ctx.fillText(line, margin, by);
        by += 68 * S;
      }
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      if (shot.text.desc) {
        ctx.font = `400 ${30 * S}px ${SANS}`;
        ctx.fillStyle = 'rgba(250,244,234,0.9)';
        const descLines = wrapText(ctx, shot.text.desc, W - margin * 2);
        let dy = by + 22 * S;
        for (const line of descLines.slice(0, 3)) {
          ctx.fillText(line, margin, dy);
          dy += 44 * S;
        }
      }

      // Progress bar + watermark.
      const barY = H - 84 * S;
      const barW = W - margin * 2;
      this._videoRoundRect(ctx, margin, barY, barW, 6 * S, 3 * S);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fill();
      const progress = clamp01((st.idx + st.local) / board.shots.length);
      this._videoRoundRect(ctx, margin, barY, Math.max(6 * S, barW * progress), 6 * S, 3 * S);
      ctx.fillStyle = hexToRgba(GOLD, 0.95);
      ctx.fill();
      ctx.font = `400 ${22 * S}px ${SANS}`;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.textAlign = 'center';
      ctx.fillText(
        isEn2 ? 'jiangshan atlas · map of chinese history' : '江山时序 · 中国历史地图',
        W / 2,
        H - 40 * S
      );
      ctx.textAlign = 'left';
    }

    // -------------------------------------------------------------------------
    // Asset loading
    // -------------------------------------------------------------------------
    _videoLoadTerrain() {
      if (this._videoTerrainPromise) return this._videoTerrainPromise;
      const base = (typeof document !== 'undefined' && document.baseURI) || '';
      const load = (src) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = new URL(src, base || location.href).href;
        });
      // Video export prefers the 4× relief sheet; the lightweight sheet used by
      // the live page remains the fallback for older/offline deployments.
      this._videoTerrainPromise = load(TERRAIN_HI_SRC)
        .then((img) => img || load(TERRAIN_SRC))
        .then((img) => {
          this._videoTerrain = img;
          return img;
        });
      return this._videoTerrainPromise;
    }

    async _videoPrepareAudio(durationSec, trackIdx) {
      const tracks = HistoricalAtlasController.GUQIN_TRACKS || [];
      const track = tracks[trackIdx];
      if (!track) return { error: 'no-track' };
      if (typeof window.AudioEncoder === 'undefined') return { error: 'no-audio-encoder' };
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return { error: 'no-audio-context' };
      const src = track.mp3 || track.ogg;
      if (!src) return { error: 'no-source' };
      let bytes;
      try {
        const res = await fetch(src, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        bytes = await res.arrayBuffer();
      } catch (e) {
        return { error: `fetch: ${e.message}` };
      }
      let actx;
      let decoded;
      try {
        actx = new AC();
        decoded = await actx.decodeAudioData(bytes);
      } catch (e) {
        try {
          if (actx) await actx.close();
        } catch (_) {}
        return { error: 'decode' };
      }
      const sampleRate = decoded.sampleRate;
      const channels = Math.min(2, decoded.numberOfChannels);
      const config = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 128000 };
      let supported = false;
      try {
        const chk = await AudioEncoder.isConfigSupported(config);
        supported = Boolean(chk && chk.supported);
      } catch (_) {
        supported = false;
      }
      if (!supported) {
        try {
          await actx.close();
        } catch (_) {}
        return { error: 'aac-unsupported' };
      }
      const frames = Math.max(1, Math.round(durationSec * sampleRate));
      const buffer = actx.createBuffer(channels, frames, sampleRate);
      const fade = Math.min(Math.round(1.4 * sampleRate), Math.floor(frames / 3));
      for (let c = 0; c < channels; c++) {
        const source = decoded.getChannelData(Math.min(c, decoded.numberOfChannels - 1));
        const dst = buffer.getChannelData(c);
        const n = source.length;
        for (let i = 0; i < frames; i++) dst[i] = source[i % n] * 0.72;
        for (let i = 0; i < fade; i++) {
          const g = i / fade;
          dst[i] *= g;
          dst[frames - 1 - i] *= g;
        }
      }
      try {
        await actx.close();
      } catch (_) {}
      return { buffer, sampleRate, channels, config };
    }

    async _videoEncodeAudio(audioEncoder, prepared) {
      const { buffer, sampleRate, channels } = prepared;
      const total = buffer.length;
      const block = 4096;
      const chans = [];
      for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));
      for (let off = 0; off < total; off += block) {
        const n = Math.min(block, total - off);
        const data = new Float32Array(n * channels);
        for (let c = 0; c < channels; c++) data.set(chans[c].subarray(off, off + n), c * n);
        const ad = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: n,
          numberOfChannels: channels,
          timestamp: Math.round((off * 1e6) / sampleRate),
          data,
        });
        audioEncoder.encode(ad);
        ad.close();
        if (audioEncoder.encodeQueueSize > 24) await new Promise((r) => setTimeout(r, 1));
      }
      await audioEncoder.flush();
    }

    // -------------------------------------------------------------------------
    // Export pipeline
    // -------------------------------------------------------------------------
    async _videoExport() {
      if (this._videoBusy) return;
      const el = this._videoEl;
      const isEn = this.locale === 'en';
      const support = this._videoCheckEnvironment();
      if (!support.ok) {
        this._videoSetStatus(support.msg, 'error');
        return;
      }
      const journeys = this._videoJourneys();
      const topicIdx = Number(el['video-topic-select'].value);
      const journey = journeys[topicIdx];
      if (!journey) {
        this._videoSetStatus(isEn ? 'Pick a topic first.' : '请先选择题材。', 'error');
        return;
      }

      this._videoBusy = true;
      this._videoCancelled = false;
      el['act-video-generate'].disabled = true;
      el['act-video-generate'].textContent = isEn ? 'Rendering…' : '生成中…';
      el['act-video-cancel'].classList.remove('is-hidden');
      el['act-video-download'].classList.add('is-hidden');
      this._videoSetProgress(0);
      this._videoGeoCache = new Map();

      const requested = this._videoTargetSize();
      let { w: W, h: H } = requested;
      const canvas = el['video-studio-canvas'];
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d', { alpha: false });
      const fps = 30;

      try {
        this._videoSetStatus(isEn ? 'Loading map data…' : '正在加载舆图数据…');
        await this._ensureFullSnapshots();
        this._videoSnapCacheReady = true;
        await this._videoLoadTerrain();

        const targetSec = Number(el['video-duration-select'].value) || 45;
        const board = this._videoBuildStoryboard(journey, targetSec, fps, W / H, W);

        this._videoSetStatus(isEn ? 'Checking H.264 encoder…' : '正在检测 H.264 编码器…');
        let codecInfo = await this._videoPickCodec(W, H, fps);
        if (!codecInfo) {
          // Hardware encoders often cap out below 4K; degrade one step at a time
          // instead of failing the whole export.
          for (const dims of [2160, 1440, 1080, 720].map((s) => this._videoDims(s))) {
            if (dims.w >= W) continue;
            const info = await this._videoPickCodec(dims.w, dims.h, fps);
            if (!info) continue;
            W = dims.w;
            H = dims.h;
            codecInfo = info;
            canvas.width = W;
            canvas.height = H;
            this._videoSetNote(
              isEn
                ? `Browser cannot encode ${requested.w}×${requested.h}; output limited to ${W}×${H}.`
                : `当前浏览器无法编码 ${requested.w}×${requested.h}，已自动降为 ${W}×${H}。`
            );
            break;
          }
        }
        if (!codecInfo) {
          throw new Error(
            isEn
              ? 'No H.264 encoder available in this browser.'
              : '当前浏览器没有可用的 H.264 编码器。'
          );
        }
        ctx.imageSmoothingQuality = 'high';

        const bgmChoice = el['video-bgm-select'].value;
        let prepared = null;
        if (bgmChoice !== 'none') {
          this._videoSetStatus(isEn ? 'Preparing guqin score…' : '正在准备古琴配乐…');
          prepared = await this._videoPrepareAudio(board.totalDur, Number(bgmChoice));
          if (prepared.error) {
            this._videoSetNote(
              isEn
                ? `BGM unavailable (${prepared.error}) — exporting a silent video.`
                : `配乐不可用（${prepared.error}），将导出无声视频。`
            );
            prepared = null;
          }
        }

        const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;
        const target = new ArrayBufferTarget();
        const muxer = new Muxer({
          target,
          video: { codec: 'avc', width: W, height: H },
          audio: prepared
            ? {
                codec: 'aac',
                numberOfChannels: prepared.channels,
                sampleRate: prepared.sampleRate,
              }
            : undefined,
          fastStart: 'in-memory',
          firstTimestampBehavior: 'offset',
        });

        let encodeError = null;
        const videoEncoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (e) => {
            encodeError = e;
          },
        });
        videoEncoder.configure({
          codec: codecInfo.codec,
          width: W,
          height: H,
          bitrate: codecInfo.bitrate,
          framerate: fps,
          latencyMode: 'quality',
          avc: { format: 'avc' },
        });

        const totalFrames = board.frames;
        const keyEvery = Math.round(fps * 2);
        for (let f = 0; f < totalFrames; f++) {
          if (this._videoCancelled) throw new Error(isEn ? 'Cancelled.' : '已取消。');
          if (encodeError) throw encodeError;
          const state = this._videoFrameState(board, f);
          this._videoRenderFrame(ctx, state, board);
          const frame = new VideoFrame(canvas, {
            timestamp: Math.round((f * 1e6) / fps),
            duration: Math.round(1e6 / fps),
          });
          videoEncoder.encode(frame, { keyFrame: f % keyEvery === 0 });
          frame.close();
          while (videoEncoder.encodeQueueSize > 8) {
            await new Promise((r) => setTimeout(r, 2));
            if (encodeError) throw encodeError;
          }
          if (f % 5 === 0 || f === totalFrames - 1) {
            this._videoSetProgress((f + 1) / totalFrames);
            this._videoSetStatus(
              isEn
                ? `Rendering frames… ${f + 1}/${totalFrames}`
                : `正在渲染画面… ${f + 1}/${totalFrames}`
            );
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        await videoEncoder.flush();
        videoEncoder.close();

        if (prepared) {
          this._videoSetStatus(isEn ? 'Mixing guqin score…' : '正在合成古琴配乐…');
          const audioEncoder = new AudioEncoder({
            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
            error: (e) => {
              encodeError = e;
            },
          });
          audioEncoder.configure(prepared.config);
          await this._videoEncodeAudio(audioEncoder, prepared);
          audioEncoder.close();
        }

        this._videoSetStatus(isEn ? 'Finalizing MP4…' : '正在封装 MP4…');
        muxer.finalize();
        const blob = new Blob([target.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        const dl = el['act-video-download'];
        if (this._videoObjectUrl) URL.revokeObjectURL(this._videoObjectUrl);
        this._videoObjectUrl = url;
        dl.href = url;
        dl.download = `jiangshan-${journey.key}-${W}x${H}.mp4`;
        dl.classList.remove('is-hidden');
        this._videoSetProgress(1);
        const mb = (blob.size / 1048576).toFixed(1);
        this._videoSetStatus(
          isEn
            ? `Done · ${board.totalDur.toFixed(1)}s · ${mb} MB — click “Download MP4”.`
            : `成片完成 · ${board.totalDur.toFixed(1)} 秒 · ${mb} MB —— 点「下载 MP4」保存。`,
          'ok'
        );
      } catch (err) {
        const msg = (err && err.message) || String(err);
        this._videoSetStatus((isEn ? 'Failed: ' : '生成失败：') + msg, 'error');
      } finally {
        this._videoBusy = false;
        el['act-video-generate'].disabled = false;
        el['act-video-generate'].textContent = isEn ? 'Generate video' : '生成视频';
        el['act-video-cancel'].classList.add('is-hidden');
      }
    }
  }

  function install(Ctrl) {
    HistoricalAtlasController = Ctrl;
    Ctrl._extendPrototype(AtlasVideoMixin);
  }

  if (typeof window === 'undefined') return;
  const readyCtrl = window.HistoricalAtlasController;
  if (readyCtrl && typeof readyCtrl._extendPrototype === 'function') {
    install(readyCtrl);
  } else {
    (window.__ATLAS_MIXINS = window.__ATLAS_MIXINS || []).push(install);
  }

  if (typeof document !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('DOMContentLoaded', () => {
      const app = window.atlasApp;
      if (app && typeof app._initVideoStudio === 'function') app._initVideoStudio();
    });
  }
})();
