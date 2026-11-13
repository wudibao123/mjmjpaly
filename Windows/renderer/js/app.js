/* MJMJ · UI 装配：登录 / 歌单 / 背景面板 / HUD / 窗口控制 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  // 移动端判定：必须「没有桌面桥 + 安卓 UA」两个条件同时成立，
  // 这样即使电脑端 preload 没注入 mjmj，也不会被误判成手机而把左上角三键隐藏掉。
  const UA = navigator.userAgent || '';
  const IS_MOBILE = !window.mjmj && /Android/i.test(UA) && !/Electron/i.test(UA);
  if (IS_MOBILE) document.body.classList.add('mobile');
  else document.body.classList.add('desktop');
  const bgLayer = $('bg-layer');
  const island = $('dynamic-island');
  const plistPanel = $('playlist-panel');
  /* 背景只保留三种场景：隐现（Folia latent）、丝绸（Mineradio SILK）、音域回响（Mineradio SONIC TOPOGRAPHY）。
     其余场景卡片已从面板删除，旧存值在这里回退，避免重启后套用一个不存在的模式变成黑屏。 */
  const SCENE_BG_MODES = ['fveil', 'mrp0', 'mrp7'];
  const BG_ALLOWED = ['default', 'cover', 'aurora', 'custom', 'desktop'].concat(SCENE_BG_MODES);
  /* 背景分组 ↔ 歌词样式分组：Folia 背景配 Folia 歌词，Mineradio 背景配 Mineradio 歌词 */
  const FOLIA_LYRIC = ['still', 'flow', 'mind', 'terrace', 'float', 'monet', 'chorus', 'confide', 'loop', 'mirror', 'chrono', 'sonnet', 'pigment', 'veil'];
  const MR_LYRIC = ['mrcinema', 'mrktv', 'mrglow', 'mrglitch', 'mrfloat', 'mrbilin'];
  const MR_BG_MODES = ['mrp0', 'mrp7'];
  let bgMode = localStorage.getItem('mjmj.bgMode') || 'default';
  if (BG_ALLOWED.indexOf(bgMode) < 0) bgMode = 'default';
  let customBgUrl = null;
  let coverBgUrl = '';      // 当前歌曲封面原图
  let coverBgApplied = '';  // 已送进玻璃的封面地址（去重）

  /* 歌曲封面 → 同源代理地址：WebGL 从跨域画布取纹理会被安全策略拒绝，
     走本地服务器的 /proxy 既拿到高清封面又不污染画布。两端同一份实现。 */
  function coverToBgUrl(pic) {
    if (!pic) return '';
    let base = pic.startsWith('//') ? 'https:' + pic : pic;
    base = base.replace(/^http:/, 'https:');
    const big = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'param=1024y1024';
    return '/proxy?url=' + encodeURIComponent(big);
  }

  /* ===== SVG 图标（无 emoji，线条风格） ===== */
  const ICONS = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7z"/><path d="M13 5h4v14h-4z"/></svg>',
    loop: '<svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
    loopOne: '<svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><text x="12" y="15.5" text-anchor="middle" font-size="8" font-weight="800" fill="currentColor">1</text></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
    subtitle: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 12h4M7 15h2.5M13 15h4M13 9h4M7 9h.01"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/></svg>',
    fullscreenExit: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5"/><path d="M20 15v5h-5"/><path d="M4 4l6 6"/><path d="M20 20l-6-6"/></svg>',
  };
  const modeIcons = { list: ICONS.loop, one: ICONS.loopOne, random: ICONS.shuffle };
  const modeTitles = { list: '列表循环', one: '单曲循环', random: '随机播放' };

  /* ===== Toast ===== */
  let toastTimer = null;
  window.toast = function (msg) {
    const t = $('toast');
    t.innerText = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  };

  /* ===== 灵动岛 Tabs ===== */
  const tabGlass = $('tabGlass'), tabBg = $('tabBg'), tabLyric = $('tabLyric'), tabSettings = $('tabSettings');
  const panelGlass = $('panelGlass'), panelBg = $('panelBg'), panelLyric = $('panelLyric'), panelSettings = $('panelSettings');
  const islandTabs = [[tabGlass, panelGlass], [tabBg, panelBg], [tabLyric, panelLyric], [tabSettings, panelSettings]];
  function showIslandTab(tab) {
    for (const [t, p] of islandTabs) {
      const on = t === tab;
      t.classList.toggle('active', on);
      p.style.display = on ? '' : 'none';
    }
  }
  for (const [t] of islandTabs) {
    t.addEventListener('click', (e) => { e.stopPropagation(); showIslandTab(t); });
  }

  /* ===== 歌词样式（应用内，非“液态玻璃”时启用 DOM 歌词层） ===== */
  const LYRIC_STYLES = [
    { id: 'liquid',   name: '液态玻璃', en: 'Liquid Glass',  src: '本应用 · 玻璃折射渲染（默认）' },
    { id: 'aperture', name: '逐字辉映', en: 'Aperture',      src: 'AMLL · Apple Music Like Lyrics' },
    { id: 'stardust', name: '星尘迸发', en: 'Stardust',      src: 'Spicy Lyrics · Spicetify 扩展' },
    { id: 'neon',     name: '霓虹蚀刻', en: 'Neon Etch',     src: 'Lucid Lyrics · Spicetify 扩展' },
    { id: 'depth',    name: '纵深虚化', en: 'Depth Blur',    src: '@music-lyric-player/dom' },
    { id: 'triline',  name: '三行透视', en: 'Triline',       src: '@karaplay/kar-player 三行模式' },
    { id: 'radiant',  name: '多重辉光', en: 'Radiant Stack', src: 'Rabbit Lyrics · 多行高亮' },
    { id: 'silent',   name: '静默聚焦', en: 'Silent Focus',  src: 'lyric-dom · 原生 DOM 版本' },
    { id: 'crawl',    name: '星战推轨', en: 'Crawl',         src: 'CSS-Tricks · Star Wars Crawl 3D 透视' },
    { id: 'dolly',    name: '景深推轨', en: 'Dolly Shot',    src: 'three.js / troika-three-text（SDF 文本）' },
    { id: 'orbit',    name: '轨道环行', en: 'Orbit Ring',    src: 'three.js CSS3D + Beautiful Lyrics 影院视图' },
    { id: 'holo',     name: '全息扫描', en: 'Hologram',      src: 'Beautiful Lyrics · Cinema 沉浸视图' },
    { id: 'flip',     name: '翻转字幕', en: 'Kinetic Flip',  src: 'yurayura · kinetic typography' },
    { id: 'cosmos',   name: '深空漫游', en: 'Cosmos',        src: 'Yura.js · camera.follow + wraptype CSS3D' },
    { id: 'tunnel',   name: '隧道穿越', en: 'Wormhole',      src: 'three.js CSS3DRenderer 隧道排布' },
    { id: 'sphere',   name: '球幕环星', en: 'Sphere',        src: 'wraptype Sphere（φ 分带铺排）' },
    { id: 'helix',    name: '螺旋天梯', en: 'Helix',         src: 'Yura.js camera moves 螺旋运镜' },
    { id: 'dome',     name: '穹顶环幕', en: 'Dome',          src: 'wraptype Cylinder 柱面环绕' },
    { id: 'torus',    name: '环面回旋', en: 'Torus',         src: 'wraptype Torus 主次角铺排' },
    { id: 'constellation', name: '星系列阵', en: 'Constellation', src: 'three.js CSS3D + camera.orbit' },
    { id: 'abyss',    name: '深渊下潜', en: 'Abyss',         src: 'troika-three-text 纵深文本' },
    { id: 'chat',     name: '手机对话', en: 'Messages',      src: 'iOS Messages 气泡歌词 · 3D 倾斜面板' },
    /* ---- Folia 视觉系（13 套，自带配套背景氛围） ---- */
    { id: 'still',    name: '静止',   en: 'Still' },
    { id: 'flow',     name: '流光',   en: 'Flowlight' },
    { id: 'mind',     name: '心象',   en: 'Mindscape' },
    { id: 'terrace',  name: '云阶',   en: 'Terrace' },
    { id: 'float',    name: '浮名',   en: 'Drift' },
    { id: 'monet',    name: '莫奈',   en: 'Monet' },
    { id: 'chorus',   name: '群唱',   en: 'Chorus' },
    { id: 'confide',  name: '倾诉',   en: 'Confide' },
    { id: 'loop',     name: '回环',   en: 'Loop' },
    { id: 'mirror',   name: '镜台',   en: 'Mirror' },
    { id: 'chrono',   name: '时计',   en: 'Chrono' },
    { id: 'sonnet',   name: '商籁',   en: 'Sonnet' },
    { id: 'pigment',  name: '凝彩',   en: 'Pigment' },
    { id: 'veil',     name: '隐现',   en: 'Veil' },
    /* ---- Mineradio 视效（7 套预设对应的歌词舞台） ---- */
    { id: 'mrcinema', name: '影院镜头', en: 'Cinema' },
    { id: 'mrktv',    name: '逐字高亮', en: 'Karaoke' },
    { id: 'mrglow',   name: '发光脉动', en: 'Glow Beat' },
    { id: 'mrglitch', name: '故障切片', en: 'Glitch' },
    { id: 'mrfloat',  name: '浮游',     en: 'Levitate' },
    { id: 'mrbilin',  name: '译文双行', en: 'Bilingual' },
  ];
  const LYRIC_SPAN = {
    aperture: 1, stardust: 1, neon: 1, depth: 2, triline: 1, radiant: 3, silent: 1,
    crawl: 2, dolly: 2, orbit: 3, holo: 1, flip: 1,
    cosmos: 14,
    /* Folia 系：显示行数（span=1 → 3 行，2 → 5 行，3 → 7 行） */
    still: 1, flow: 1, mind: 1, terrace: 2, float: 2, monet: 1,
    chorus: 3, confide: 3, loop: 2, mirror: 1, chrono: 1, sonnet: 1, pigment: 2,
    veil: 2,
    /* Mineradio 系：影院与浮游要看到上下文，其余只留当前句 */
    mrcinema: 2, mrktv: 1, mrglow: 1, mrglitch: 1, mrfloat: 2, mrbilin: 1,
  };
  const SPACE_STYLES = ['tunnel', 'sphere', 'helix', 'dome', 'torus', 'constellation', 'abyss'];
  const lyricStage = $('lyric-stage');
  let lyricStyle = localStorage.getItem('mjmj.lyricStyle') || 'liquid';
  if (!LYRIC_STYLES.some((s) => s.id === lyricStyle)) lyricStyle = 'liquid';
  let lyricStageKey = '';

  function escLyric(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 3D 深空：给每一行分配空间坐标 + 相机跟随（Yura.js camera.follow 的指数平滑） */
  const cosmosCam = { x: 0, y: 0, z: 0, ry: 0, rx: 0, inited: false };
  let spaceSwitchAt = 0;

  /* 空间样式的字号：按这一行的字面宽度算出“一行塞得下”的字号，
     这样长句不会被折成两行（折行后上下两行会被同一道 clip 一起扫亮）。 */
  function spaceFontSize(d, text, stageW) {
    const cap = (d === 0) ? 46 : (Math.abs(d) <= 2 ? 30 : 20);
    const cjk = /[\u3400-\u9fff]/.test(text);
    const est = cjk ? text.length : text.length * 0.56 + 2;
    const fit = Math.floor(stageW / Math.max(4, est));
    return Math.max(11, Math.min(cap, fit));
  }
  function cosHash(i, salt) {
    const v = Math.sin(i * 12.9898 + salt) * 43758.5453;
    return v - Math.floor(v);
  }
  function cosPos(i) {
    const a = cosHash(i, 0.13), b = cosHash(i, 78.233), c = cosHash(i, 41.71);
    return {
      x: (a - 0.5) * 1700,
      y: (b - 0.5) * 980,
      z: -80 - c * 760,
      ry: (a - 0.5) * 42,
      rx: (b - 0.5) * 14,
    };
  }
  function lyricProgress(st, idx) {
    const cur = st.lyricsData[idx];
    const next = st.lyricsData[idx + 1];
    const now = st.audioEl ? st.audioEl.currentTime : 0;
    const start = cur ? cur.time : 0;
    const end = next ? next.time : start + 6;
    return Math.max(0, Math.min(1, (now - start) / Math.max(0.25, end - start)));
  }

  /* 逐字高亮层：行里带真实字级时间戳就一字一个 .w（Folia / 网易云 yrc 的做法），
     没有逐字数据时退回整行一个 span —— 绝不拿估算假装逐字。 */
  function fillHtml(text, words) {
    if (!words || !words.length) return '<span class="ly-fill"><span>' + text + '</span></span>';
    let s = '<span class="ly-fill w">';
    for (let i = 0; i < words.length; i++) {
      s += '<span class="w" data-i="' + i + '">' + escLyric(words[i].text) + '</span>';
    }
    return s + '</span>';
  }

  /* 底层“未唱”文字也用同一套字盒（.bw），和 .ly-fill 的 .w 盒宽、基线完全一致。
     以前底层是整行 inline 文本、上层是 inline-block 字盒，两套字距算法不同，
     逐字拆分后偏移会逐字累积，同一句就被画成两份错开的字。 */
  function baseHtml(text, words) {
    if (!words || !words.length) return '<span class="ly-base">' + text + '</span>';
    let s = '<span class="ly-base w">';
    for (let i = 0; i < words.length; i++) {
      s += '<span class="bw">' + escLyric(words[i].text) + '</span>';
    }
    return s + '</span>';
  }

  /* 每个字按自己的 start/end 推进；整行 --p 取字进度均值，
     仅供读 --p 的玻璃/背景使用，歌词本体只认字级时间。 */
  function applyLineProgress(lineEl, st, idx) {
    if (!lineEl) return;
    const cur = st.lyricsData[idx];
    const now = st.audioEl ? st.audioEl.currentTime : 0;
    const nodes = lineEl.querySelectorAll('.ly-fill.w > .w');
    if (nodes.length && cur && cur.words && cur.words.length === nodes.length) {
      const bnodes = lineEl.querySelectorAll('.ly-base.w > .bw');
      let done = 0, total = 0;
      for (let i = 0; i < nodes.length; i++) {
        const w = cur.words[i];
        const len = Math.max(1, (w.text || '').length);
        let wp = 0;
        if (now >= w.end) wp = 1;
        else if (now > w.start) wp = (now - w.start) / Math.max(0.01, w.end - w.start);
        nodes[i].style.setProperty('--wp', wp.toFixed(3));
        /* 这个字“开口”没有：对话样式的流式打字只看 0/1，用字自己的起始时间，
           不按整句时间插值，所以念白拖长时字就跟着一个个慢慢冒出来。 */
        const wv = now >= w.start ? '1' : '0';
        nodes[i].style.setProperty('--wv', wv);
        if (bnodes.length === nodes.length) bnodes[i].style.setProperty('--wv', wv);
        total += len;
        done += len * wp;
      }
      lineEl.style.setProperty('--p', (total ? done / total : 0).toFixed(3));
      return;
    }
    lineEl.style.setProperty('--p', lyricProgress(st, idx).toFixed(3));
  }

  function renderCosmos(st, idx) {
    const SPAN = 14;
    const key = 'cosmos|' + idx;
    if (lyricStageKey !== key) {
      lyricStageKey = key;
      spaceSwitchAt = performance.now();
      const stageW = (lyricStage.clientWidth || window.innerWidth) * 0.9;
      let html = '<div class="ly-space">';
      for (let d = -SPAN; d <= SPAN; d++) {
        const i = idx + d;
        if (i < 0 || i >= st.lyricsData.length) continue;
        const text = st.lyricsData[i] ? st.lyricsData[i].text : '';
        if (!text) continue;
        const p = cosPos(i);
        if (d === 0) p.z = 200 + cosHash(i, 41.71) * 120;
        const depth = (d === 0) ? 'near' : (p.z < -430 ? 'far' : 'mid');
        const t = escLyric(text);
        const tr = st.lyricsData[i] && st.lyricsData[i].tr ? escLyric(st.lyricsData[i].tr) : '';
        const fs = spaceFontSize(d, text, stageW);
        html += '<div class="ly-line" data-rel="' + d + '" data-depth="' + depth + '"'
          + ' style="--lx:' + p.x.toFixed(0) + 'px;--ly:' + p.y.toFixed(0) + 'px;--lz:' + p.z.toFixed(0) + 'px;'
          + '--lry:' + p.ry.toFixed(1) + 'deg;--lrx:' + p.rx.toFixed(1) + 'deg;font-size:' + fs + 'px;">'
          + baseHtml(t, st.lyricsData[i] && st.lyricsData[i].words)
          + fillHtml(t, st.lyricsData[i] && st.lyricsData[i].words)
          + '</div>';
      }
      html += '</div>';
      lyricStage.innerHTML = html;
    }

    // 相机目标：把当前行抵消回原点（带有 x/y/z 与角度的平移），再指数平滑逼近 → 镜头“飞”过去
    const cur = cosPos(idx);
    const tz = 200 + cosHash(idx, 41.71) * 120;
    const target = { x: -cur.x, y: -cur.y, z: -tz, ry: -cur.ry, rx: -cur.rx };
    const k = cosmosCam.inited ? (performance.now() - spaceSwitchAt < 700 ? 0.16 : 0.09) : 1;
    cosmosCam.inited = true;
    cosmosCam.x += (target.x - cosmosCam.x) * k;
    cosmosCam.y += (target.y - cosmosCam.y) * k;
    cosmosCam.z += (target.z - cosmosCam.z) * k;
    cosmosCam.ry += (target.ry - cosmosCam.ry) * k;
    cosmosCam.rx += (target.rx - cosmosCam.rx) * k;
    lyricStage.style.setProperty('--cx', cosmosCam.x.toFixed(1) + 'px');
    lyricStage.style.setProperty('--cy', cosmosCam.y.toFixed(1) + 'px');
    lyricStage.style.setProperty('--cz', cosmosCam.z.toFixed(1) + 'px');
    lyricStage.style.setProperty('--cry', cosmosCam.ry.toFixed(2) + 'deg');
    lyricStage.style.setProperty('--crx', cosmosCam.rx.toFixed(2) + 'deg');

    // 背景跟着相机推近 / 横移（视差）
    document.body.style.setProperty('--bg-cam-x', (cosmosCam.x * 0.045).toFixed(1) + 'px');
    document.body.style.setProperty('--bg-cam-y', (cosmosCam.y * 0.045).toFixed(1) + 'px');
    document.body.style.setProperty('--bg-cam-z', (1 + Math.abs(cosmosCam.z) / 3400).toFixed(3));

    const curLine = lyricStage.querySelector('.ly-line[data-rel="0"]');
    if (curLine) applyLineProgress(curLine, st, idx);
  }

  /* ===== 7 套 3D 空间排布（三轴坐标由行号推出，相机把当前行拉回原点） ===== */
  function wrapDeg(d) {
    let x = d % 360;
    if (x > 180) x -= 360;
    if (x <= -180) x += 360;
    return x;
  }

  function spaceLayout(mode, i) {
    switch (mode) {
      case 'tunnel': {
        const side = (i % 2 === 0) ? 1 : -1;
        return { x: side * 545, y: ((i % 3) - 1) * 215, z: -(i * 225), ry: side * -34, rx: 0 };
      }
      case 'sphere': {
        const lon = i * 0.42, lat = Math.sin(i * 0.17) * 0.95, R = 790;
        return {
          x: R * Math.cos(lat) * Math.sin(lon),
          y: -R * Math.sin(lat),
          z: R * Math.cos(lat) * Math.cos(lon) - R,
          ry: -lon * 57.2958, rx: lat * 22,
        };
      }
      case 'helix': {
        const a = i * 0.55, R = 470;
        return { x: Math.cos(a) * R, y: -i * 145, z: -240 - Math.cos(a) * 210, ry: -a * 57.2958 + 84, rx: 0 };
      }
      case 'dome': {
        const a = i * 0.45, R = 570;
        return {
          x: Math.sin(a) * R * 0.8,
          y: Math.sin(i * 0.3) * 190,
          z: Math.cos(a) * R - R,
          ry: -a * 57.2958, rx: 0,
        };
      }
      case 'torus': {
        const u = i * 0.5, v = ((i % 3) - 1) * 0.62, R = 650, r = 175;
        return {
          x: (R + r * Math.cos(v)) * Math.sin(u),
          y: r * Math.sin(v) * 2.4 + Math.sin(i * 0.4) * 110,
          z: (R + r * Math.cos(v)) * Math.cos(u) - R - r,
          ry: -u * 57.2958, rx: v * 22,
        };
      }
      case 'constellation': {
        const ang = i * 0.62, R = 660 + (i % 3) * 135;
        return { x: Math.cos(ang) * R, y: ((i % 5) - 2) * 118, z: Math.sin(ang) * R - 330, ry: -ang * 57.2958, rx: 0 };
      }
      case 'abyss': {
        return {
          x: Math.sin(i * 0.72) * 520 + ((i % 3) - 1) * 110,
          y: i * 170,
          z: -190 - (i % 4) * 95,
          ry: Math.sin(i * 0.4) * 27, rx: 0,
        };
      }
      default: return { x: 0, y: 0, z: 0, ry: 0, rx: 0 };
    }
  }

  function spaceCamera(mode, idx, t) {
    if (mode === 'tunnel') return { x: 0, y: 0, z: idx * 225, ry: 0, rx: 0 };
    if (mode === 'constellation') return { x: 0, y: 0, z: 0, ry: t * 7.5, rx: 0 };
    if (mode === 'abyss') return { x: 0, y: -idx * 170, z: 70, ry: 0, rx: 12 };

    // CSS 的变换是 translate3d → rotateY → rotateX（右乘顺序：先转 X，再转 Y，最后平移）
    // 所以相机平移量必须写成 c = -(Ry(Rx(p)))，只取 -p 会在角度大时整体偏出画面
    const p = spaceLayout(mode, idx);
    const ry = wrapDeg(-p.ry), rx = -p.rx;
    const Ry = ry * Math.PI / 180, Rx = rx * Math.PI / 180;
    const y1 = p.y * Math.cos(Rx) - p.z * Math.sin(Rx);
    const z1 = p.y * Math.sin(Rx) + p.z * Math.cos(Rx);
    const x2 = p.x * Math.cos(Ry) + z1 * Math.sin(Ry);
    const z2 = -p.x * Math.sin(Ry) + z1 * Math.cos(Ry);
    return { x: -x2, y: -y1, z: -z2, ry, rx };
  }

  function writeCamera(target, k, st, idx) {
    cosmosCam.x += (target.x - cosmosCam.x) * k;
    cosmosCam.y += (target.y - cosmosCam.y) * k;
    cosmosCam.z += (target.z - cosmosCam.z) * k;
    cosmosCam.ry += (target.ry - cosmosCam.ry) * k;
    cosmosCam.rx += (target.rx - cosmosCam.rx) * k;
    lyricStage.style.setProperty('--cx', cosmosCam.x.toFixed(1) + 'px');
    lyricStage.style.setProperty('--cy', cosmosCam.y.toFixed(1) + 'px');
    lyricStage.style.setProperty('--cz', cosmosCam.z.toFixed(1) + 'px');
    lyricStage.style.setProperty('--cry', cosmosCam.ry.toFixed(2) + 'deg');
    lyricStage.style.setProperty('--crx', cosmosCam.rx.toFixed(2) + 'deg');
    document.body.style.setProperty('--bg-cam-x', (cosmosCam.x * 0.035).toFixed(1) + 'px');
    document.body.style.setProperty('--bg-cam-y', (cosmosCam.y * 0.035).toFixed(1) + 'px');
    document.body.style.setProperty('--bg-cam-z', (1 + Math.min(0.28, Math.abs(cosmosCam.z) / 4800)).toFixed(3));
  }

  function renderSpace(st, idx, mode) {
    const SPAN = 12;
    const key = mode + '|' + idx;
    if (lyricStageKey !== key) {
      lyricStageKey = key;
      spaceSwitchAt = performance.now();
      const stageW = (lyricStage.clientWidth || window.innerWidth) * 0.9;
      let html = '<div class="ly-space">';
      // 相对相机景深限幅：CSS 透视是 perspective 1000px，元素一旦贴到镜头前就会被放大到失控
      // （螺旋等模式 z 有正摆幅，靠近时放大十几倍，整屏只剩一个巨大数字）。
      const camTarget = spaceCamera(mode, idx, 0);
      const NEAR_LIMIT = 84, FAR_LIMIT = -1500;
      for (let d = -SPAN; d <= SPAN; d++) {
        const i = idx + d;
        if (i < 0 || i >= st.lyricsData.length) continue;
        const text = st.lyricsData[i] ? st.lyricsData[i].text : '';
        if (!text) continue;
        const p = spaceLayout(mode, i);
        let relZ = p.z + camTarget.z;
        if (d === 0) {
          // 当前行永远钉在镜头正前方：不参与剔除，也不让它被远处裁剪掉。
          // 以前这里和普通行一起判断 relZ，球幕/穹顶这类 z 摆幅大的模式会在某些句子上
          // 把当前句判成“过远”直接 continue，结果整屏只剩背景。
          relZ = 0;
        } else {
          if (relZ > NEAR_LIMIT + 12 && d < 0) continue;   // 已穿过镜头的行不再画，避免糊在脸上
          if (relZ < FAR_LIMIT) continue;                  // 过远行不画
          relZ = Math.max(FAR_LIMIT, Math.min(NEAR_LIMIT, relZ));
        }
        const lz = relZ - camTarget.z;
        const pry = wrapDeg(p.ry);
        const depth = (d === 0) ? 'near' : (Math.abs(d) <= 2 ? 'mid' : 'far');
        const t = escLyric(text);
        const tr = st.lyricsData[i] && st.lyricsData[i].tr ? escLyric(st.lyricsData[i].tr) : '';
        const fs = spaceFontSize(d, text, stageW);
        html += '<div class="ly-line" data-rel="' + d + '" data-depth="' + depth + '"'
          + ' style="--lx:' + p.x.toFixed(0) + 'px;--ly:' + p.y.toFixed(0) + 'px;--lz:' + lz.toFixed(0) + 'px;'
          + '--lry:' + pry.toFixed(1) + 'deg;--lrx:' + p.rx.toFixed(1) + 'deg;font-size:' + fs + 'px;">'
          + baseHtml(t, st.lyricsData[i] && st.lyricsData[i].words)
          + fillHtml(t, st.lyricsData[i] && st.lyricsData[i].words)
          + '</div>';
      }
      html += '</div>';
      lyricStage.innerHTML = html;
    }

    const now = st.audioEl ? st.audioEl.currentTime : 0;
    const target = spaceCamera(mode, idx, now);
    const settled = performance.now() - spaceSwitchAt > 700;
    writeCamera(target, cosmosCam.inited ? (settled ? 0.07 : 0.16) : 1, st, idx);
    cosmosCam.inited = true;

    const curLine = lyricStage.querySelector('.ly-line[data-rel="0"]');
    if (curLine) applyLineProgress(curLine, st, idx);
  }

  /* 右侧（自己）用网易云登录头像，未登录或左侧（对方）用默认头像 */
  function bubbleAvatar(side) {
    if (side === 'right') {
      const url = NCM.profile && NCM.profile.avatarUrl ? String(NCM.profile.avatarUrl).replace(/'/g, '%27') : '';
      if (url) return '<span class="ly-avatar has-photo" style="background-image:url(\'' + url + '\')"></span>';
      return '<span class="ly-avatar is-default"></span>';
    }
    return '<span class="ly-avatar"></span>';
  }

  /* 手机对话式歌词：整机 CSS 3D 六面体模型（屏幕 + 背板 + 四侧边框 + 摄像头）+ 左右气泡 */
  let chatLastSwitch = 0;

  function renderChat(st, idx) {
    const SPAN = 6;
    // 机身只建一次。以前每次换句把整机 DOM 重建，新元素没有“旧值 → 新值”的过程，
    // transition 无处可过渡，聚焦就变成瞬移。现在外壳常驻，只换屏内气泡。
    if (!lyricStage.querySelector('.ly-phone3d')) {
      lyricStage.innerHTML =
        '<div class="ly-phone3d"><div class="ph-shell">'
        + '<div class="ph-face ph-front"><div class="ph-screen">'
        + '<div class="ph-notch"></div>'
        + '<div class="ph-statusbar"><span class="ph-time">9:41</span><span class="ph-sig">▮▮▮</span></div>'
        + '<div class="ly-chat-head"><span class="ly-chat-dot"></span>MJMJ · 正在播放</div>'
        + '<div class="ly-chat-list"></div>'
        + '<div class="ph-homebar"></div>'
        + '</div></div>'
        + '<div class="ph-face ph-back"><div class="ph-cam"><i></i><i></i><em></i></div>'
        + '<div class="ph-brand">MJMJ</div></div>'
        + '<div class="ph-face ph-side ph-left"></div>'
        + '<div class="ph-face ph-side ph-right"></div>'
        + '<div class="ph-face ph-edge ph-top"></div>'
        + '<div class="ph-face ph-edge ph-bottom"></div>'
        + '<div class="ph-frame"></div>'
        + '</div></div>';
    }

    const key = 'chat|' + idx;
    const list = lyricStage.querySelector('.ly-chat-list');
    if (lyricStageKey !== key || !list || list.childElementCount === 0) {
      lyricStageKey = key;
      chatLastSwitch = performance.now();
      let bubbles = '';
      let lastSide = '';
      for (let d = -SPAN; d <= 0; d++) {
        const i = idx + d;
        if (i < 0 || i >= st.lyricsData.length) continue;
        const text = st.lyricsData[i] ? st.lyricsData[i].text : '';
        if (!text) continue;
        const side = (i % 2 === 0) ? 'right' : 'left';
        lastSide = side;
        const t = escLyric(text);
        const tr = st.lyricsData[i] && st.lyricsData[i].tr ? escLyric(st.lyricsData[i].tr) : '';
        bubbles += '<div class="ly-bubble" data-side="' + side + '" data-rel="' + d + '">'
          + bubbleAvatar(side)
          + '<span class="ly-bubble-body">' + baseHtml(t, st.lyricsData[i] && st.lyricsData[i].words)
          + fillHtml(t, st.lyricsData[i] && st.lyricsData[i].words)
          + '</span></div>';
      }
      if (idx + 1 < st.lyricsData.length) {
        const side = ((idx + 1) % 2 === 0) ? 'right' : 'left';
        bubbles += '<div class="ly-bubble is-typing" data-side="' + side + '">'
          + bubbleAvatar(side) + '<span class="ly-dots"><i></i><i></i><i></i></span></div>';
      }
      if (list) list.innerHTML = bubbles;
      // 记住最底下这条气泡在哪一侧，聚焦方向以它为准（空行会被跳过，不能拿 idx 硬算）
      if (lastSide) lyricStage.dataset.side = lastSide;
    }
    const cur = lyricStage.querySelector('.ly-bubble[data-rel="0"]');
    if (cur) applyLineProgress(cur, st, idx);
    const now = st.audioEl ? st.audioEl.currentTime : 0;
    lyricStage.style.setProperty('--sway', (Math.sin(now * 0.5) * 2.2).toFixed(2) + 'deg');
    lyricStage.style.setProperty('--lift', (Math.sin(now * 0.8) * 0.35 - 0.15).toFixed(2));
    // 谁发这句就把机身推向哪一边：底部气泡在右 +1、在左 −1；
    // 连续 3 秒没有新句子 → 镜头缩回、机身转回正面
    const idle = (performance.now() - chatLastSwitch) > 3000;
    const focus = idle ? '0' : ((lyricStage.dataset.side === 'left') ? '-1' : '1');
    const zoom = idle ? '1' : '1.07';
    if (lyricStage.dataset.focus !== focus) {
      lyricStage.dataset.focus = focus;
      lyricStage.style.setProperty('--focus', focus);
    }
    if (lyricStage.dataset.zoom !== zoom) {
      lyricStage.dataset.zoom = zoom;
      lyricStage.style.setProperty('--cam-zoom', zoom);
    }
  }

  function resetCosmosCamera() {
    cosmosCam.inited = false;
    cosmosCam.x = cosmosCam.y = cosmosCam.z = cosmosCam.ry = cosmosCam.rx = 0;
    ['--bg-cam-x', '--bg-cam-y', '--bg-cam-z'].forEach((k) => document.body.style.removeProperty(k));
  }

  function renderLyricStyleCards() {
    const grid = $('lyricStyleGrid');
    if (!grid) return;
    grid.innerHTML = '';
    LYRIC_STYLES.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lyric-style-card' + (s.id === lyricStyle ? ' active' : '');
      btn.innerHTML = '<div class="ls-name">' + s.name + '</div>'
        + '<div class="ls-en">' + s.en + '</div>';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyLyricStyle(s.id);
      });
      grid.appendChild(btn);
    });
  }

  function applyLyricStyle(id) {
    lyricStyle = id;
    localStorage.setItem('mjmj.lyricStyle', id);
    /* 记住每组最后一次选择：切背景分组时回到这一组自己的样式 */
    if (FOLIA_LYRIC.indexOf(id) >= 0) localStorage.setItem('mjmj.foliaLyric', id);
    if (MR_LYRIC.indexOf(id) >= 0) localStorage.setItem('mjmj.mrLyric', id);
    document.body.dataset.lyricStyle = id;
    if (id === 'cosmos' || SPACE_STYLES.indexOf(id) >= 0) document.body.dataset.space = '1';
    else delete document.body.dataset.space;
    lyricStageKey = '';
    resetCosmosCamera();
    if (window.MJMJLyricGL) MJMJLyricGL.invalidate();
    if (lyricStage && id !== 'cosmos' && SPACE_STYLES.indexOf(id) < 0) {
      ['--cx', '--cy', '--cz', '--cry', '--crx'].forEach((k) => lyricStage.style.removeProperty(k));
      lyricStage.innerHTML = '';
    }
    renderLyricStyleCards();
  }

  let lastTrText = null;
  /* 译文只挂在进度条上方（#progressTr），主歌词区不再显示译文 */
  function syncProgressTranslation(st, idx) {
    const el = $('progressTr');
    if (!el) return;
    const cur = st.lyricsData && idx >= 0 ? st.lyricsData[idx] : null;
    const tr = (cur && cur.tr) ? cur.tr : '';
    if (tr !== lastTrText) { lastTrText = tr; el.textContent = tr; }
    el.style.opacity = tr ? '1' : '0';
  }

  function renderLyricStage() {
    if (!lyricStage) return;
    const st = Player.state;
    const empty = () => {
      if (lyricStageKey !== 'none') { lyricStage.innerHTML = ''; lyricStageKey = 'none'; }
    };
    const idx = st.currentLyricIndex;
    syncProgressTranslation(st, idx);
    if (lyricStyle === 'liquid' || !st.lyricsData || !st.lyricsData.length) { empty(); return; }
    if (idx < 0 || idx >= st.lyricsData.length) { empty(); return; }
    if (lyricStyle === 'cosmos') { renderCosmos(st, idx); return; }
    if (SPACE_STYLES.indexOf(lyricStyle) >= 0) { renderSpace(st, idx, lyricStyle); return; }
    if (lyricStyle === 'chat') { renderChat(st, idx); return; }

    const span = LYRIC_SPAN[lyricStyle] || 1;
    const key = lyricStyle + '|' + idx;
    if (key !== lyricStageKey) {
      lyricStageKey = key;
      let html = '<div class="ly-stage-inner">';
      for (let d = -span; d <= span; d++) {
        const i = idx + d;
        const text = (i >= 0 && i < st.lyricsData.length) ? st.lyricsData[i].text : '';
        const blank = text ? '' : ' is-empty';
        const t = escLyric(text);
        const tr = st.lyricsData[i] && st.lyricsData[i].tr ? escLyric(st.lyricsData[i].tr) : '';
        html += '<div class="ly-line' + blank + '" data-rel="' + d + '">'
          + baseHtml(t, st.lyricsData[i] && st.lyricsData[i].words)
          + fillHtml(t, st.lyricsData[i] && st.lyricsData[i].words)
          + '</div>';
      }
      html += '</div>';
      lyricStage.innerHTML = html;
    }

    const now = st.audioEl ? st.audioEl.currentTime : 0;
    const curLine = lyricStage.querySelector('.ly-line[data-rel="0"]');
    applyLineProgress(curLine, st, idx);

    // 3D 相机量：crawl 的后撤、dolly 的推轨、orbit 的绕行、holo 的轻微摆动共用
    const cam = (now % 14) / 14;
    lyricStage.style.setProperty('--cam', cam.toFixed(3));
    lyricStage.style.setProperty('--spin', (((now % 20) / 20) * 360).toFixed(1));
  }

  renderLyricStyleCards();
  /* 启动恢复必须走 applyLyricStyle，而不是只写一个 dataset：
     dome / tunnel / sphere 这些 3D 样式靠 body[data-space="1"] 激活 perspective 舞台，
     只设 data-lyricStyle 的话重启后全部退化成平面两行堆叠（画面看着像「样式丢了」）。 */
  applyLyricStyle(lyricStyle);
  (function lyricLoop() {
    renderLyricStage();
    if (window.MJMJLyricGL) MJMJLyricGL.tick();
    requestAnimationFrame(lyricLoop);
  })();

  const saveLyricStyleBtn = $('saveLyricStyleBtn');
  if (saveLyricStyleBtn) {
    saveLyricStyleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      localStorage.setItem('mjmj.lyricStyle', lyricStyle);
      saveLyricStyleBtn.innerText = '已保存：' + (LYRIC_STYLES.find((s) => s.id === lyricStyle) || {}).name;
      saveLyricStyleBtn.classList.add('saved');
      setTimeout(() => {
        saveLyricStyleBtn.innerText = '保存此配置';
        saveLyricStyleBtn.classList.remove('saved');
      }, 1500);
    });
  }

  /* ===== 设置：歌词拖动开关 ===== */
  const sLyricDrag = $('s-lyricdrag');
  const lyricDragOn = localStorage.getItem('mjmj.lyricDrag') !== '0';
  window.MJMJ_LYRIC_DRAG = lyricDragOn;
  if (sLyricDrag) {
    sLyricDrag.checked = lyricDragOn;
    sLyricDrag.addEventListener('change', () => {
      const on = sLyricDrag.checked;
      window.MJMJ_LYRIC_DRAG = on;
      localStorage.setItem('mjmj.lyricDrag', on ? '1' : '0');
      if (typeof toast === 'function') toast(on ? '已开启歌词拖动' : '已关闭歌词拖动');
    });
  }

  /* ===== 设置：允许其他设备访问 + 保存此配置 ===== */
  const sLan = $('s-lan');
  const lanAddr = $('lanAddr');
  const LAN_HINT = '开启后，同一局域网内的浏览器可打开本播放器';
  function lanText(j) {
    return (j && j.allowed && j.urls && j.urls.length) ? '局域网可访问：' + j.urls.join('  ·  ') : LAN_HINT;
  }
  async function refreshLan() {
    try {
      const j = await (await fetch('/lan')).json();
      if (sLan) sLan.checked = !!j.allowed;
      if (lanAddr) lanAddr.innerText = lanText(j);
    } catch (e) { /* 服务不支持时保持默认 */ }
  }
  if (sLan) {
    refreshLan();
    sLan.addEventListener('change', async () => {
      try {
        const j = await (await fetch('/lan?allow=' + (sLan.checked ? 1 : 0))).json();
        if (lanAddr) lanAddr.innerText = lanText(j);
        if (typeof toast === 'function') toast(sLan.checked ? '其他设备已可访问' : '已关闭其他设备访问');
      } catch (e) {
        if (typeof toast === 'function') toast('切换失败：' + (e.message || e));
      }
    });
  }
  const saveSettingsBtn = $('saveSettingsBtn');
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
      try {
        localStorage.setItem('mjmj.lyricDrag', window.MJMJ_LYRIC_DRAG ? '1' : '0');
        localStorage.setItem('mjmj.lan', sLan && sLan.checked ? '1' : '0');
        if (typeof window.MJMJ_SAVE_GLASS === 'function') window.MJMJ_SAVE_GLASS();
      } catch (e) {}
      saveSettingsBtn.innerText = '已保存';
      saveSettingsBtn.classList.add('saved');
      setTimeout(() => {
        saveSettingsBtn.innerText = '保存此配置';
        saveSettingsBtn.classList.remove('saved');
      }, 1500);
      if (typeof toast === 'function') toast('配置已保存');
    });
  }

  /* ===== 背景模式 ===== */
  /* 自选背景图持久化：Blob 直接进 IndexedDB，双端通用，重启后自动读回 */
  function bgIdbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('mjmj', 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore('kv'); } catch (e) {} };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function bgIdbSet(k, v) {
    try {
      const db = await bgIdbOpen();
      await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) { console.warn('bg save failed', e); }
  }
  async function bgIdbGet(k) {
    try {
      const db = await bgIdbOpen();
      return await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readonly');
        const g = tx.objectStore('kv').get(k);
        g.onsuccess = () => res(g.result);
        g.onerror = () => rej(g.error);
      });
    } catch (e) { return null; }
  }

  /* 图片 → 压缩后的 base64（长边 1600、JPEG 0.82），供 localStorage 直接存 */
  function bgFileToDataUrl(file, maxSide = 1600, quality = 0.82) {
    return new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
            const s = Math.min(1, maxSide / Math.max(w, h));
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(w * s));
            cv.height = Math.max(1, Math.round(h * s));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            res(cv.toDataURL('image/jpeg', quality));
          } catch (e) { res(fr.result); }
        };
        img.onerror = () => res(fr.result);
        img.src = fr.result;
      };
      fr.onerror = () => res('');
      fr.readAsDataURL(file);
    });
  }
  /* 双端持久化：base64 进 localStorage（APK 走这条，路径即数据本身），同时 Blob 进 IndexedDB 兜大图 */
  async function persistCustomBg(f) {
    try {
      const dataUrl = await bgFileToDataUrl(f);
      if (dataUrl) localStorage.setItem('mjmj.customBgData', dataUrl);
    } catch (e) { console.warn('bg base64 save failed', e); }
    bgIdbSet('customBg', f);
  }

  let desktopTimer = null;
  async function refreshDesktopBg() {
    try {
      const dataUrl = await window.mjmj.captureDesktop();
      if (dataUrl && bgMode === 'desktop') Liquid.setBgFromUrl(dataUrl);
    } catch (e) { /* 截屏失败静默 */ }
  }
  function applyCoverBg(force) {
    const u = coverToBgUrl(coverBgUrl);
    bgLayer.style.setProperty('--cover-bg', u ? `url('${u}')` : 'none');
    if (!u) { Liquid.setBgFromUrl('/assets/default-bg.png'); coverBgApplied = ''; return; }
    if (force || u !== coverBgApplied) { coverBgApplied = u; Liquid.setBgFromUrl(u); }
  }

  // 背景面板里的 Folia 场景：实际绘制交给 #folia-bg 氛围层
  const FOLIA_BG_MODES = ['fstill', 'fflow', 'fmind', 'fterrace', 'ffloat', 'fmonet',
    'fchorus', 'fconfide', 'floop', 'fmirror', 'fchrono', 'fsonnet', 'fpigment',
    'fveil',
    // Mineradio 上游 13 个预设号（顶点着色器 uPreset 分支：0 SILK / 1 TUNNEL /
    // 2 ORBIT / 3 VOID / 4 VINYL / 5 WALLPAPER PULSE / 9 ECLIPSE HALO /
    // 10 NEON DRIZZLE / 11 PRISM FLOCK / 12 ABYSSAL BLOOM，6-8 为同一分支族）
    'mrp0', 'mrp1', 'mrp2', 'mrp3', 'mrp4', 'mrp5', 'mrp7', 'mrp8', 'mrp9', 'mrp10', 'mrp11', 'mrp12'];

  /* Mineradio 背景参数：直接写进上游 uniform 表 */
  (function bindMrParams() {
    var rows = [
      ['s-mrint', 'v-mrint', 'intensity'],
      ['s-mrpoint', 'v-mrpoint', 'point'],
      ['s-mrspeed', 'v-mrspeed', 'speed'],
      ['s-mrscatter', 'v-mrscatter', 'scatter'],
      ['s-mrbloom', 'v-mrbloom', 'bloom']
    ];
    rows.forEach(function (row) {
      var input = $(row[0]);
      var label = $(row[1]);
      if (!input) return;
      input.addEventListener('input', function () {
        var v = parseFloat(input.value);
        if (label) label.textContent = v.toFixed(2);
        if (window.MJMJMrBg) window.MJMJMrBg.setParam(row[2], v);
      });
    });
  })();

  function applyBgMode() {
    /* 选了什么就记什么：以前只改内存不落盘，重启读回来永远是旧值/空值，
       表现就是「上次明明选了场景，下次打开变成一片黑」。 */
    try { localStorage.setItem('mjmj.bgMode', bgMode); } catch (e) {}
    bgLayer.dataset.mode = bgMode;
    document.body.dataset.foliaBg = FOLIA_BG_MODES.indexOf(bgMode) >= 0 ? bgMode : '';
    bgLayer.style.setProperty('--custom-bg', bgMode === 'custom' && customBgUrl ? `url('${customBgUrl}')` : 'none');
    $('bgCustomRow').style.display = bgMode === 'custom' ? '' : 'none';
    // 玻璃纹理：默认/自选上传同图；节奏流用程序化极光；透出桌面折射桌面截屏
    if (bgMode === 'default') Liquid.setBgFromUrl('/assets/default-bg.png');
    else if (bgMode === 'custom') { if (customBgUrl) Liquid.setBgFromUrl(customBgUrl); else Liquid.clearBg(); }
    else if (bgMode === 'desktop') {
      if (IS_MOBILE) {
        // 手机端「透出桌面」= 手机系统壁纸（MainActivity 抽取到 /wallpaper，前端经同源加载）
        if (desktopTimer) { clearInterval(desktopTimer); desktopTimer = null; }
        Liquid.setBgFromUrl('/wallpaper');
      } else {
        Liquid.clearBg();
        refreshDesktopBg();
        if (desktopTimer) clearInterval(desktopTimer);
        desktopTimer = setInterval(refreshDesktopBg, 4000);
      }
    } else if (bgMode === 'cover') {
      if (desktopTimer) { clearInterval(desktopTimer); desktopTimer = null; }
      applyCoverBg(true);
    } else {
      /* 场景类背景（隐现 / 粒子）没有「一张图」可以折射，
         用场景自己的调色板生成折射纹理；拿不到就退回程序化渐变，
         绝不能让玻璃继续显示默认底图或上一首的封面。 */
      if (bgMode === 'fveil' && window.MJMJLatentBg && MJMJLatentBg.getPalette && Liquid.setBgFromColors) {
        const pal = MJMJLatentBg.getPalette();
        if (pal && pal.mesh) Liquid.setBgFromColors(pal.mesh, pal.ditheringBack);
        else Liquid.clearBg();
      } else {
        Liquid.clearBg();
      }
      if (desktopTimer) { clearInterval(desktopTimer); desktopTimer = null; }
    }
    if (bgMode === 'aurora') {
      // 节奏流下玻璃程序化背景与 CSS 极光同色系（由 --hue 驱动）
    }
    /* 背景分组决定歌词分组：隐现配 Folia 歌词，丝绸/音域回响配 Mineradio 歌词 */
    if (bgMode === 'fveil' && MR_LYRIC.indexOf(lyricStyle) >= 0) {
      applyLyricStyle(localStorage.getItem('mjmj.foliaLyric') || 'veil');
    } else if (MR_BG_MODES.indexOf(bgMode) >= 0 && FOLIA_LYRIC.indexOf(lyricStyle) >= 0) {
      applyLyricStyle(localStorage.getItem('mjmj.mrLyric') || 'mrcinema');
    }
  }
  document.querySelectorAll('.bg-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-mode').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      bgMode = btn.dataset.mode;
      applyBgMode();
    });
  });
  $('bgPickBtn').addEventListener('click', () => $('bgFile').click());
  $('bgFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    customBgUrl = URL.createObjectURL(f);
    $('bgCustomPreview').style.backgroundImage = `url('${customBgUrl}')`;
    document.querySelectorAll('.bg-mode').forEach((b) => b.classList.remove('active'));
    document.querySelector('.bg-mode[data-mode="custom"]').classList.add('active');
    bgMode = 'custom';
    applyBgMode();
    e.target.value = '';
    persistCustomBg(f);   // base64 + Blob 双写，重启直接读回来
  });
  // 拖放图片换背景
  const dropOverlay = $('dropOverlay');
  window.addEventListener('dragover', (e) => { e.preventDefault(); dropOverlay.classList.add('active'); });
  window.addEventListener('dragleave', (e) => { e.preventDefault(); dropOverlay.classList.remove('active'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropOverlay.classList.remove('active');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) {
      customBgUrl = URL.createObjectURL(f);
      $('bgCustomPreview').style.backgroundImage = `url('${customBgUrl}')`;
      document.querySelectorAll('.bg-mode').forEach((b) => b.classList.remove('active'));
      document.querySelector('.bg-mode[data-mode="custom"]').classList.add('active');
      bgMode = 'custom';
      applyBgMode();
      persistCustomBg(f);
      toast('已切换为自选背景');
    }
  });
  // 背景模糊
  const bgBlur = $('s-bgblur');
  bgBlur.addEventListener('input', () => {
    document.documentElement.style.setProperty('--bg-blur', bgBlur.value + 'px');
    $('v-bgblur').innerText = bgBlur.value;
  });
  // 背景跟随节奏
  const rhythmToggle = $('s-rhythm');
  rhythmToggle.addEventListener('change', () => {
    const root = document.documentElement.style;
    root.setProperty('--rhythm-on', rhythmToggle.checked ? '1' : '0');
    bgLayer.style.filter = rhythmToggle.checked ? '' : 'none';
    bgLayer.style.transform = rhythmToggle.checked ? '' : 'none';
  });

  /* 恢复上次保存的背景配置（自选图片是临时 URL，不跨会话，重启回默认） */
  (function restoreBgPrefs() {
    try {
      const m = localStorage.getItem('mjmj.bgMode');
      if (m && m !== 'custom') bgMode = BG_ALLOWED.indexOf(m) >= 0 ? m : 'default';
      const b = localStorage.getItem('mjmj.bgBlur');
      if (b !== null) {
        bgBlur.value = b;
        document.documentElement.style.setProperty('--bg-blur', b + 'px');
        const v = $('v-bgblur'); if (v) v.innerText = b;
      }
      const r = localStorage.getItem('mjmj.rhythm');
      if (r !== null && rhythmToggle) {
        rhythmToggle.checked = r === '1';
        rhythmToggle.dispatchEvent(new Event('change'));
      }
      document.querySelectorAll('.bg-mode').forEach((el) => {
        el.classList.toggle('active', el.dataset.mode === bgMode);
      });
      /* 恢复完必须真的套用一次：以前只改了内存和按钮高亮，没走 applyBgMode，
         所以 mrp / fveil 这类场景重启后既没进 body[data-folia-bg]，也没挂 canvas。
         custom 交给下面的 restoreCustomBg：这里先套用会把 bgMode 写回 default，
         自选图就再也读不回来了。 */
      if (m !== 'custom') applyBgMode();
    } catch (e) {}
  })();

  /* 自选背景图：重启后从本地库读回（不必重新选图） */
  (async function restoreCustomBg() {
    try {
      if (localStorage.getItem('mjmj.bgMode') !== 'custom') return;
      // 优先用 base64（APK 端就靠它，重启即调；桌面端同样命中）
      const b64 = localStorage.getItem('mjmj.customBgData');
      if (b64) {
        customBgUrl = b64;
        $('bgCustomPreview').style.backgroundImage = `url('${b64}')`;
        document.querySelectorAll('.bg-mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'custom'));
        bgMode = 'custom';
        applyBgMode();
        return;
      }
      const blob = await bgIdbGet('customBg');
      if (!blob) {
        bgMode = 'default';
        document.querySelectorAll('.bg-mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'default'));
        applyBgMode();
        return;
      }
      customBgUrl = URL.createObjectURL(blob);
      $('bgCustomPreview').style.backgroundImage = `url('${customBgUrl}')`;
      document.querySelectorAll('.bg-mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === 'custom'));
      bgMode = 'custom';
      applyBgMode();
    } catch (e) {}
  })();

  /* 背景面板：保存此配置 */
  const saveBgBtn = $('saveBgBtn');
  if (saveBgBtn) {
    saveBgBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        localStorage.setItem('mjmj.bgMode', bgMode);
        localStorage.setItem('mjmj.bgBlur', bgBlur.value);
        localStorage.setItem('mjmj.rhythm', rhythmToggle.checked ? '1' : '0');
      } catch (err) {}
      saveBgBtn.innerText = '已保存';
      saveBgBtn.classList.add('saved');
      setTimeout(() => {
        saveBgBtn.innerText = '保存此配置';
        saveBgBtn.classList.remove('saved');
      }, 1500);
      if (typeof toast === 'function') toast('背景配置已保存');
    });
  }

  /* ===== HUD ===== */
  const playBtn = $('playBtn');
  const modeBtn = $('modeBtn');
  const ktvBtn = $('ktvBtn');

  playBtn.addEventListener('click', () => {
    if (!Player.state.currentTrack && !Player.queue.length) {
      toast('请先在歌单/搜索中选择歌曲');
      return;
    }
    Player.toggle();
  });
  $('prevBtn').addEventListener('click', () => Player.prev());
  $('nextBtn').addEventListener('click', () => Player.next(false));
  modeBtn.addEventListener('click', () => {
    const m = Player.cycleLoopMode();
    modeBtn.innerHTML = modeIcons[m];
    modeBtn.title = modeTitles[m];
  });
  ktvBtn.addEventListener('click', () => {
    const on = !Liquid.ktv;
    Liquid.setKtv(on);
    ktvBtn.classList.toggle('active', on);
    ktvBtn.innerHTML = ICONS.subtitle + '<span>' + (on ? '追光中' : 'KTV') + '</span>';
    if (on) toast('KTV 胶囊追光已开启');
  });
  $('bgBtn').addEventListener('click', () => {
    island.classList.remove('hover');
    island.classList.add('expanded');
    tabBg.click();
  });
  $('plistBtn').addEventListener('click', () => {
    plistPanel.classList.toggle('open');
    if (plistPanel.classList.contains('open')) renderPlaylistList();
  });
  $('plistClose').addEventListener('click', () => plistPanel.classList.remove('open'));

  // 使用指南（思索）
  const helpModal = $('help-modal');
  $('helpBtn').addEventListener('click', () => helpModal.classList.add('open'));
  $('helpClose').addEventListener('click', () => helpModal.classList.remove('open'));
  helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.classList.remove('open'); });

  // 播放状态 UI
  Player.onChange((st) => {
    playBtn.innerHTML = st.paused ? ICONS.play : ICONS.pause;
    playBtn.classList.toggle('playing', !st.paused);
    if (st.currentTrack) {
      $('islandTitle').innerText = st.currentTrack.name;
      $('islandArtist').innerText = st.currentTrack.artists || '未知歌手';
      $('islandCover').style.backgroundImage = st.currentTrack.pic ? `url('${st.currentTrack.pic}')` : '';
      $('ppCover').style.backgroundImage = st.currentTrack.pic ? `url('${st.currentTrack.pic}')` : '';
      $('ppTitle').innerText = st.currentTrack.name;
      $('ppArtist').innerText = st.currentTrack.artists + (st.currentTrack.album ? ' · ' + st.currentTrack.album : '');
      $('islandCover').classList.toggle('playing', !st.paused);
      // 歌曲封面背景：切歌换图，同一首不重复上传纹理
      const pic = st.currentTrack.pic || '';
      if (pic && pic !== coverBgUrl) {
        coverBgUrl = pic;
        if (bgMode === 'cover') applyCoverBg(true);
      }
    }
    // 歌单高亮
    document.querySelectorAll('.pl-item.playing').forEach((el) => el.classList.remove('playing'));
    if (st.currentTrack && Player.queue.length) {
      const idx = Player.queue.findIndex((t) => t.id === st.currentTrack.id);
      const items = document.querySelectorAll('.pl-item[data-index]');
      if (idx >= 0 && items[idx]) items[idx].classList.add('playing');
    }
  });

  /* ===== 命令行（mjplay）点歌：桌面 UI 同步 ===== */
  if (window.mjmj && window.mjmj.onCliPlay) {
    window.mjmj.onCliPlay((t) => {
      if (!t || !t.id) return;
      Player.loadTrack({
        id: String(t.id),
        name: t.name || '未知歌曲',
        artists: t.artists || '未知歌手',
        album: t.album || '',
        pic: t.pic || '',
        duration: Number(t.duration) || 0,
      }, true);
      toast('命令行播放：' + (t.name || ''));
    });
  }

  /* ===== 播放列表面板 ===== */
  let plistView = 'playlists'; // playlists | tracks
  let currentPlaylistId = null;
  const plistTitle = $('plistTitle');
  const plistList = $('plistList');
  const plistBack = $('plistBack');

  function el(tag, cls, html) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }
  function durText(ms) {
    if (!ms) return '--:--';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  }

  async function renderPlaylistList() {
    plistView = 'playlists';
    currentPlaylistId = null;
    plistBack.style.visibility = 'hidden';
    if (!NCM.profile) {
      plistTitle.innerText = '我的歌单';
      plistList.innerHTML = '<div class="pl-empty">未登录 · 请先登录同步歌单<br>（未登录也可直接搜索播放）</div>';
      return;
    }
    plistTitle.innerText = NCM.profile.nickname + ' 的歌单';
    plistList.innerHTML = '<div class="pl-empty">加载中…</div>';
    try {
      const list = await NCM.myPlaylists();
      if (!list.length) { plistList.innerHTML = '<div class="pl-empty">暂无歌单</div>'; return; }
      plistList.innerHTML = '';
      list.forEach((pl) => {
        const item = el('div', 'pl-item');
        item.innerHTML = `<img src="${pl.coverImgUrl || ''}" onerror="this.style.visibility='hidden'"><div class="pi-meta"><div class="pi-name">${esc(pl.name)}</div><div class="pi-sub">${pl.trackCount || 0} 首${pl.creator && pl.creator.nickname ? ' · ' + esc(pl.creator.nickname) : ''}</div></div>`;
        item.addEventListener('click', () => openPlaylist(pl));
        plistList.appendChild(item);
      });
    } catch (e) {
      plistList.innerHTML = '<div class="pl-empty">加载失败：' + esc(e.message || e) + '</div>';
    }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function openPlaylist(pl) {
    plistView = 'tracks';
    currentPlaylistId = pl.id;
    plistBack.style.visibility = 'visible';
    plistTitle.innerText = pl.name;
    plistList.innerHTML = '<div class="pl-empty">加载中…</div>';
    try {
      const tracks = await NCM.playlistTracks(pl.id);
      if (!tracks.length) { plistList.innerHTML = '<div class="pl-empty">歌单为空</div>'; return; }
      const normalized = tracks.map(NCM.normalizeTrack);
      renderTrackList(normalized);
    } catch (e) {
      plistList.innerHTML = '<div class="pl-empty">加载失败：' + esc(e.message || e) + '</div>';
    }
  }

  function renderTrackList(tracks) {
    plistList.innerHTML = '';
    tracks.forEach((t, i) => {
      const item = el('div', 'pl-item');
      item.dataset.index = String(i);
      item.innerHTML = `<img src="${t.pic || ''}" onerror="this.style.visibility='hidden'"><div class="pi-meta"><div class="pi-name">${esc(t.name)}</div><div class="pi-sub">${esc(t.artists)}${t.album ? ' · ' + esc(t.album) : ''}</div></div><div class="pi-dur">${durText(t.duration)}</div>`;
      item.addEventListener('click', async () => {
        await Player.playQueue(tracks, i);
        plistPanel.classList.add('open');
      });
      plistList.appendChild(item);
    });
    attachDragSort(plistList, tracks);
  }

  /* 长按拖拽排序：长按歌曲 350ms 进入拖动，可上下移动 */
  function attachDragSort(container, tracks) {
    if (container.querySelector('.pl-drag-hint')) container.querySelector('.pl-drag-hint').remove();
    const hint = el('div', 'pl-drag-hint', '长按歌曲可拖动排序');
    container.appendChild(hint);
    const items = container.querySelectorAll('.pl-item');
    let drag = null;

    items.forEach((item) => {
      let longPress = null;
      item.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        longPress = setTimeout(() => {
          longPress = null;
          startDrag(item);
        }, 350);
      });
      item.addEventListener('pointerup', () => { if (longPress) { clearTimeout(longPress); longPress = null; } });
      item.addEventListener('pointerleave', () => { if (longPress) { clearTimeout(longPress); longPress = null; } });
    });

    function startDrag(item) {
      drag = { item, fromIndex: Number(item.dataset.index), toIndex: Number(item.dataset.index) };
      container.classList.add('drag-sorting');
      item.classList.add('dragging');
      container.querySelectorAll('.pl-item').forEach((it, idx) => { it.dataset.cur = String(idx); });
      const onMove = (e) => {
        const target = e.target.closest('.pl-item');
        if (!target || target === item) return;
        const to = Number(target.dataset.cur);
        if (to === drag.toIndex) return;
        drag.toIndex = to;
        if (to > drag.fromIndex) target.after(item); else target.before(item);
        container.querySelectorAll('.pl-item').forEach((it, idx) => { it.dataset.cur = String(idx); });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        container.classList.remove('drag-sorting');
        item.classList.remove('dragging');
        if (drag.toIndex !== drag.fromIndex) {
          const arr = tracks.slice();
          const [moved] = arr.splice(drag.fromIndex, 1);
          arr.splice(drag.toIndex, 0, moved);
          tracks.length = 0;
          tracks.push(...arr);
          renderTrackList(tracks);
        }
        drag = null;
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }
  }

  plistBack.addEventListener('click', () => {
    if (plistView === 'tracks') { renderPlaylistList(); }
  });

  /* ===== 独立搜索页 ===== */
  const searchModal = $('search-modal');
  const searchInput = $('searchInput');
  const searchResultsEl = $('searchResults');
  $('searchBtn').addEventListener('click', () => {
    searchModal.classList.add('open');
    searchInput.value = '';
    renderHistory();
    setTimeout(() => searchInput.focus(), 80);
  });
  $('searchClose').addEventListener('click', () => searchModal.classList.remove('open'));
  searchModal.addEventListener('click', (e) => { if (e.target === searchModal) searchModal.classList.remove('open'); });

  function doSearch(keywords) {
    searchResultsEl.innerHTML = '<div class="sr-empty">搜索中…</div>';
    NCM.search(keywords, 30).then((songs) => {
      if (!songs.length) { searchResultsEl.innerHTML = '<div class="sr-empty">没有找到相关歌曲</div>'; return; }
      addHistory(keywords);
      renderSrList(searchResultsEl, songs);
    }).catch((e) => {
      searchResultsEl.innerHTML = '<div class="sr-empty">搜索失败：' + esc(e.message || e) + '</div>';
    });
  }
  $('searchGo').addEventListener('click', () => { const kw = searchInput.value.trim(); if (kw) doSearch(kw); });
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const kw = searchInput.value.trim(); if (kw) doSearch(kw); } });

  function artistLinks(t) {
    if (t.artistsList && t.artistsList.length) {
      return t.artistsList.map((a) => `<span class="sr-artist" data-aid="${a.id}" data-aname="${esc(a.name)}">${esc(a.name)}</span>`).join(' / ');
    }
    return esc(t.artists);
  }

  function renderSrList(container, songs, opts) {
    opts = opts || {};
    container.innerHTML = '';
    songs.forEach((t, i) => {
      const item = el('div', 'sr-item');
      item.innerHTML = `<img src="${t.pic || ''}" onerror="this.style.visibility='hidden'"><div class="sr-meta"><div class="sr-name">${esc(t.name)}</div><div class="sr-sub">${artistLinks(t)}${t.album ? ' · ' + esc(t.album) : ''}</div></div><div class="sr-dur">${durText(t.duration)}</div>`;
      item.querySelectorAll('.sr-artist').forEach((b) => {
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          openArtistModal(b.dataset.aid, b.dataset.aname);
        });
      });
      item.addEventListener('click', async () => {
        await Player.playQueue(songs, i);
        container.closest('.modal-mask') && container.closest('.modal-mask').classList.remove('open');
      });
      if (opts.unlike) {
        const heart = el('button', 'sr-like active');
        heart.title = '取消收藏';
        heart.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 20.5C7.5 16.8 3.5 13.3 3.5 9.2 3.5 6.3 5.8 4 8.7 4c1.6 0 3.1.7 3.3 1.9C12.2 4.7 13.7 4 15.3 4c2.9 0 5.2 2.3 5.2 5.2 0 4.1-4 7.6-8.5 11.3z"/></svg>';
        heart.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (heart.disabled) return;
          heart.disabled = true;
          try {
            await NCM.setLike(t.id, false);
            item.remove();
            toast('已取消收藏');
            if (!container.querySelector('.sr-item')) container.innerHTML = '<div class="sr-empty">还没有收藏歌曲</div>';
          } catch (err) {
            heart.disabled = false;
            toast('取消收藏失败：' + (err.message || err));
          }
        });
        item.appendChild(heart);
      }
      container.appendChild(item);
    });
  }

  /* ===== 歌手全部歌曲弹窗 ===== */
  const artistModal = $('artist-modal');
  function openArtistModal(id, name) {
    if (!id) return;
    $('artistModalTitle').innerText = name || '歌手';
    const list = $('artistSongList');
    list.innerHTML = '<div class="sr-empty">加载中…</div>';
    artistModal.classList.add('open');
    NCM.artistSongs(id, 100).then((songs) => {
      if (!artistModal.classList.contains('open')) return;
      if (!songs.length) { list.innerHTML = '<div class="sr-empty">没取到该歌手的歌曲</div>'; return; }
      list.innerHTML = '';
      songs.forEach((t, i) => {
        const item = el('div', 'sr-item');
        item.innerHTML = `<img src="${t.pic || ''}" onerror="this.style.visibility='hidden'"><div class="sr-meta"><div class="sr-name">${esc(t.name)}</div><div class="sr-sub">${esc(t.album || '')}</div></div><div class="sr-dur">${durText(t.duration)}</div>`;
        item.addEventListener('click', async () => {
          await Player.playQueue(songs, i);
          artistModal.classList.remove('open');
        });
        list.appendChild(item);
      });
    });
  }
  if (artistModal) {
    $('artistClose').addEventListener('click', () => artistModal.classList.remove('open'));
    artistModal.addEventListener('click', (e) => { if (e.target === artistModal) artistModal.classList.remove('open'); });
  }

  /* ===== 搜索历史 ===== */
  function getHistory() {
    try { const h = JSON.parse(localStorage.getItem('mjmj.searchHistory') || '[]'); return Array.isArray(h) ? h : []; } catch (e) { return []; }
  }
  function addHistory(kw) {
    const h = getHistory().filter((x) => x !== kw);
    h.unshift(kw);
    try { localStorage.setItem('mjmj.searchHistory', JSON.stringify(h.slice(0, 10))); } catch (e) {}
  }
  function renderHistory() {
    const h = getHistory();
    if (!h.length) {
      searchResultsEl.innerHTML = '<div class="sr-empty">输入歌名 / 歌手 / 专辑，回车搜索<br>点击结果直接播放</div>';
      return;
    }
    searchResultsEl.innerHTML = '<div class="search-history-title">搜索历史</div><div class="search-history-list">' +
      h.map((k) => `<button class="history-chip" data-k="${esc(k)}">${esc(k)}</button>`).join('') +
      '<button class="history-chip history-clear" id="historyClear">清空</button></div>';
    searchResultsEl.querySelectorAll('.history-chip[data-k]').forEach((b) => b.addEventListener('click', () => {
      searchInput.value = b.dataset.k;
      doSearch(b.dataset.k);
    }));
    const cl = searchResultsEl.querySelector('#historyClear');
    if (cl) cl.addEventListener('click', () => {
      try { localStorage.removeItem('mjmj.searchHistory'); } catch (e) {}
      renderHistory();
    });
  }

  /* ===== 喜欢（当前曲） ===== */
  const likeBtn = $('likeBtn');
  async function refreshLikeBtn() {
    const t = Player.state.currentTrack;
    if (!t || !t.id) { likeBtn.classList.remove('active'); likeBtn.disabled = true; return; }
    likeBtn.disabled = false;
    if (!NCM.profile) { likeBtn.classList.remove('active'); return; }
    try {
      const s = await NCM.likedIds();
      likeBtn.classList.toggle('active', s.has(t.id));
    } catch (e) {
      likeBtn.classList.remove('active');
    }
  }
  likeBtn.addEventListener('click', async () => {
    const t = Player.state.currentTrack;
    if (!t || !t.id) return;
    if (!NCM.profile) { toast('请先登录'); openLogin(); return; }
    const target = !likeBtn.classList.contains('active');
    if (likeBtn.disabled) return;
    likeBtn.disabled = true;
    try {
      await NCM.setLike(t.id, target);
      likeBtn.classList.toggle('active', target);
      toast(target ? '已加入我喜欢的音乐' : '已取消收藏');
    } catch (e) {
      toast('操作失败：' + (e.message || e));
    }
    likeBtn.disabled = false;
  });
  Player.onChange(refreshLikeBtn);

  /* ===== 收藏面板（同步网易云我喜欢的音乐） ===== */
  const favModal = $('fav-modal');
  const favListEl = $('favList');
  $('favBtn').addEventListener('click', openFav);
  $('favClose').addEventListener('click', () => favModal.classList.remove('open'));
  favModal.addEventListener('click', (e) => { if (e.target === favModal) favModal.classList.remove('open'); });

  async function openFav() {
    if (!NCM.profile) { toast('请先登录后再同步收藏'); openLogin(); return; }
    favModal.classList.add('open');
    favListEl.innerHTML = '<div class="sr-empty">同步中…</div>';
    try {
      const tracks = await NCM.likedTracks();
      if (!tracks.length) { favListEl.innerHTML = '<div class="sr-empty">还没有收藏歌曲</div>'; return; }
      renderSrList(favListEl, tracks, { unlike: true });
    } catch (e) {
      favListEl.innerHTML = '<div class="sr-empty">同步失败：' + esc(e.message || e) + '</div>';
    }
  }

  /* ===== 登录 ===== */
  const loginModal = $('login-modal');
  const lmTabQr = $('lmTabQr'), lmTabCookie = $('lmTabCookie');
  const lmPaneQr = $('lmPaneQr'), lmPaneCookie = $('lmPaneCookie');
  const qrImg = $('qrImg'), qrStatus = $('qrStatus');
  const userChip = $('userChip');
  const userMenu = $('user-menu');

  lmTabQr.addEventListener('click', () => { lmTabQr.classList.add('active'); lmTabCookie.classList.remove('active'); lmPaneQr.style.display = ''; lmPaneCookie.style.display = 'none'; });
  lmTabCookie.addEventListener('click', () => { lmTabCookie.classList.add('active'); lmTabQr.classList.remove('active'); lmPaneCookie.style.display = ''; lmPaneQr.style.display = 'none'; });
  $('lmClose').addEventListener('click', closeLogin);
  loginModal.addEventListener('click', (e) => { if (e.target === loginModal) closeLogin(); });

  function closeLogin() {
    loginModal.classList.remove('open');
    NCM.qr.stop();
  }
  function openLogin() {
    loginModal.classList.add('open');
    lmTabQr.click();
    startQr();
  }
  $('qrRefresh').addEventListener('click', startQr);
  function startQr() {
    qrImg.src = '';
    qrStatus.innerText = '正在获取二维码…';
    NCM.qr.start((st) => {
      if (st.stage === 'qr') {
        qrImg.src = st.qrimg;
        qrStatus.innerText = '请使用网易云音乐 App 扫码';
      } else if (st.stage === 'wait') {
        const map = { 801: '等待扫码…', 802: '已扫码，请在手机上确认' };
        qrStatus.innerText = map[st.code] || '等待中…';
      } else if (st.stage === 'expired') {
        qrStatus.innerText = '二维码已过期，点击「刷新二维码」重试';
      } else if (st.stage === 'timeout') {
        qrStatus.innerText = '长时间未扫码，点击刷新或改用 Cookie 登录';
      } else if (st.stage === 'blocked') {
        qrStatus.innerText = '扫码通道被风控拦截，请改用 Cookie 登录';
        toast('扫码受限：网易云拦截了本次扫码，建议粘贴 Cookie 登录');
        lmTabCookie.click();
      } else if (st.stage === 'authorized') {
        qrStatus.innerText = '登录成功，正在同步…';
      } else if (st.stage === 'success') {
        qrStatus.innerText = '登录成功 ✓';
        toast('登录成功：' + (NCM.profile ? NCM.profile.nickname : ''));
        closeLogin();
        afterLogin();
      } else if (st.stage === 'error') {
        qrStatus.innerText = st.message || '登录失败';
      }
    });
  }
  $('cookiePaste').addEventListener('click', async () => {
    let text = '';
    try {
      if (window.mjmj) text = await window.mjmj.readClipboard();
      else text = await navigator.clipboard.readText();
    } catch (e) { toast('无法读取剪贴板'); return; }
    $('cookieInput').value = text;
    if (text) toast('已读取剪贴板');
  });
  $('cookieLogin').addEventListener('click', async () => {
    const cookie = $('cookieInput').value.trim();
    if (!cookie) { toast('请先粘贴 Cookie'); return; }
    try {
      const profile = await NCM.cookieLogin(cookie);
      toast('登录成功：' + profile.nickname);
      closeLogin();
      afterLogin();
    } catch (e) {
      toast(e.message || '登录失败');
    }
  });

  function afterLogin() {
    renderUserChip();
    if (plistPanel.classList.contains('open')) renderPlaylistList();
  }

  function renderUserChip() {
    if (NCM.profile) {
      userChip.title = NCM.profile.nickname || '网易云用户';
      userChip.innerHTML = NCM.profile.avatarUrl
        ? `<img src="${NCM.profile.avatarUrl}" onerror="this.style.display='none'"><span>${esc(NCM.profile.nickname)}</span>`
        : `<span>${esc(NCM.profile.nickname)}</span>`;
    } else {
      userChip.title = '登录';
      userChip.innerHTML = '登录';
    }
  }
  userChip.addEventListener('click', () => {
    if (NCM.profile) {
      const open = userMenu.classList.toggle('open');
      if (open) {
        $('umAvatar').src = NCM.profile.avatarUrl || '';
        $('umName').innerText = NCM.profile.nickname;
      }
    } else {
      openLogin();
    }
  });
  $('umLogout').addEventListener('click', async () => {
    userMenu.classList.remove('open');
    await NCM.logout();
    renderUserChip();
    toast('已退出登录');
    if (plistPanel.classList.contains('open')) renderPlaylistList();
  });
  window.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#user-menu') && !e.target.closest('#userChip') && e.target.id !== 'userChip') {
      userMenu.classList.remove('open');
    }
  });

  /* ===== 弹窗层叠：后打开的永远盖在先前弹窗之上 ===== */
  (function manageModalZ() {
    let zTop = 300;
    document.querySelectorAll('.modal-mask').forEach((m) => {
      new MutationObserver(() => {
        if (m.classList.contains('open')) m.style.zIndex = String(++zTop);
      }).observe(m, { attributes: true, attributeFilter: ['class'] });
    });
  })();

  /* ===== 窗口控制（Electron preload；浏览器预览时降级） ===== */
  const wcMin = $('wcMin'), wcClose = $('wcClose'), wcFull = $('wcFull');
  wcMin.addEventListener('pointerdown', (e) => { e.preventDefault(); window.mjmj && window.mjmj.minimize(); });
  wcClose.addEventListener('pointerdown', (e) => { e.preventDefault(); window.mjmj ? window.mjmj.close() : window.close(); });
  wcFull.addEventListener('pointerdown', (e) => { e.preventDefault(); window.mjmj && window.mjmj.toggleFullscreen(); });
  if (window.mjmj) {
    window.mjmj.onFullscreenChange((fs) => {
      $('wcFull').innerHTML = fs ? ICONS.fullscreenExit : ICONS.fullscreen;
      $('wcFull').title = fs ? '退出全屏' : '全屏';
    });
    // 从最小化/全屏恢复后重算布局与玻璃画布尺寸
    window.mjmj.onRestored && window.mjmj.onRestored(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }

  /* ===== 启动 ===== */
  (async function boot() {
    applyBgMode();
    renderUserChip();
    const ok = await NCM.restore();
    if (ok) {
      toast('欢迎回来，' + (NCM.profile ? NCM.profile.nickname : ''));
      afterLogin();
    } else {
      setTimeout(openLogin, 400);
    }
  })();
})();
