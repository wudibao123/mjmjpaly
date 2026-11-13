/* MJMJ · Folia「隐现」背景（照官方 latent 实现）
   -------------------------------------------------------------------------
   上游：folia-major / src/components/visualizer/backgrounds/latent/LatentBackground.tsx
        + src/types.ts 的 DEFAULT_LATENT_BACKGROUND_TUNING
        + src/utils/colorExtractor.ts / colorPalette.ts（封面取色）

   官方结构是两层 Paper Shaders + 一层纯色遮罩：
     MeshGradient  网格渐变   distortion .8 / swirl .1 / grainOverlay .01 / speed .3 → 2
     Dithering     网点抖动   shape "warp" / type "4x4" / size 2.5 / speed .1 → 1.2
                              mix-blend soft-light、opacity .55、transform scale(1.015)
     遮罩层        背景色      opacity .35

   颜色默认 colorSource = 'cover-theme'：网点前色取封面主色，网格取封面 4 色 +
   主题底色 + 主题强调色 —— 也就是说这层丝绸是当前歌曲封面铺出来的，不是固定配色。
   音频驱动照官方 updateAudioResponse：
     broadband = pow(bass*.22 + lowMid*.18 + mid*.22 + vocal*.28 + treble*.1, .55)
     onsetPulse = max(prev*.84, clamp((cur-prev)*7))
     beatSpeed  = clamp(broadband*.42 + onsetPulse*.85)
     speed      = paused ? base*.12 : ease(base, audioSpeed, smoothedBeatSpeed)
     pxSize     = max(.5, size - smoothedBass*size*.34)
     distortion = .8 + smoothedPower*.62   swirl = .1 + smoothedMid*.38
   ------------------------------------------------------------------------- */
import {
  ShaderMount,
  ditheringFragmentShader,
  meshGradientFragmentShader,
  ShaderFitOptions,
  defaultObjectSizing,
  defaultPatternSizing
} from '../vendor/paper/dist/index.js';

const HOST_ID = 'latent-bg';
const SHAPES = { simplex: 1, warp: 2, dots: 3, wave: 4, ripple: 5, swirl: 6, sphere: 7 };
const TYPES = { random: 1, '2x2': 2, '4x4': 3, '8x8': 4 };
/* 手机 GPU 扛不住桌面那套分辨率：像素上限砍到 720p×4、DPR 限 1，
   否则两层 Paper Shader 叠着跑会把中端机拖到个位数帧率。 */
const MOBILE_VIEW = !!(document.body && document.body.classList.contains('mobile'));
const MAX_PIXELS = MOBILE_VIEW ? 1280 * 720 * 4 : 1920 * 1080 * 4;

/* DEFAULT_LATENT_BACKGROUND_TUNING（src/types.ts 第 1205 行） */
const TUNING = {
  displayMode: 'both',
  ditheringSpeed: 0.1,
  ditheringAudioSpeed: 1.2,
  ditheringSize: 2.5,
  ditheringOpacity: 0.55,
  meshSpeed: 0.3,
  meshAudioSpeed: 2,
  meshDistortion: 0.8,
  meshSwirl: 0.1,
  overlayEnabled: true,
  overlayOpacity: 0.35
};

const PAUSED_SPEED_SCALE = 0.12;
const PAUSE_EASE_MS = 300;
const MAX_SHADER_PIXELS = 1280 * 720;
const THEME_BG = '#05070d';

let meshMount = null;
let ditherMount = null;
let meshEl = null;
let ditherEl = null;
let overlayEl = null;
let running = false;
let raf = 0;

let palette = null;
let coverKey = '';

let smoothedPower = 0;
let smoothedBass = 0;
let smoothedMid = 0;
let smoothedBeatSpeed = 0;
let onsetPulse = 0;
let prevEnergy = 0;
let lastFrameAt = null;
let playingAmt = 1;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hexToRgba(hex, alpha) {
  const a = alpha === undefined ? 1 : alpha;
  let s = String(hex || '#000000').replace('#', '').trim();
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length !== 6) return [0, 0, 0, a];
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
    a
  ];
}

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}

function sizing(mode) {
  const d = mode === 'object' ? defaultObjectSizing : defaultPatternSizing;
  return {
    u_originX: d.originX,
    u_originY: d.originY,
    u_worldWidth: d.worldWidth,
    u_worldHeight: d.worldHeight,
    u_fit: ShaderFitOptions[d.fit],
    u_scale: d.scale,
    u_rotation: d.rotation,
    u_offsetX: d.offsetX,
    u_offsetY: d.offsetY
  };
}

/* 没有封面时的兜底：沿用界面色相派生，保证不空 */
function themePalette() {
  const cs = getComputedStyle(document.documentElement);
  const hue = parseFloat(cs.getPropertyValue('--hue')) || 210;
  const primary = hslToHex(hue, 0.72, 0.52);
  const secondary = hslToHex((hue + 42) % 360, 0.62, 0.44);
  const tertiary = hslToHex((hue - 34 + 360) % 360, 0.48, 0.36);
  const quaternary = hslToHex((hue + 128) % 360, 0.44, 0.50);
  return {
    ditheringBack: THEME_BG,
    ditheringFront: primary,
    mesh: [primary, secondary, tertiary, quaternary, THEME_BG, hslToHex((hue + 18) % 360, 0.58, 0.58)],
    bg: THEME_BG
  };
}

/* resolveLatentShaderColors（colorSource: 'cover-theme'）
   ditheringBack = 主题底色，ditheringFront = 封面主色，mesh = 封面 4 色 + 底色 + 强调色 */
function paletteFromCover(cover) {
  const fallback = themePalette();
  if (!cover || cover.length < 3) return fallback;
  const c = cover;
  return {
    ditheringBack: THEME_BG,
    ditheringFront: c[0],
    mesh: [c[0], c[1] || c[0], c[2], c[3] || c[1] || c[0], THEME_BG, c[4] || fallback.mesh[5]],
    bg: THEME_BG
  };
}

function buildDither(host, cols) {
  const uniforms = Object.assign({}, sizing('pattern'), {
    u_colorBack: hexToRgba(cols.ditheringBack, 1),
    u_colorFront: hexToRgba(cols.ditheringFront, 1),
    u_shape: SHAPES.warp,
    u_type: TYPES['4x4'],
    u_pxSize: clamp(TUNING.ditheringSize, 0.5, 20)
  });
  return new ShaderMount(host, ditheringFragmentShader, uniforms, { alpha: true, premultipliedAlpha: false }, TUNING.ditheringSpeed, 0, MOBILE_VIEW ? 1 : 2, MAX_PIXELS);
}

function buildMesh(host, cols) {
  const colors = cols.mesh.map((c) => hexToRgba(c, 1));
  const padded = colors.slice();
  for (let i = colors.length; i < 10; i++) padded.push(colors[colors.length - 1]);
  const uniforms = Object.assign({}, sizing('object'), {
    u_colors: padded,
    u_colorsCount: colors.length,
    u_distortion: clamp(TUNING.meshDistortion, 0, 2),
    u_swirl: clamp(TUNING.meshSwirl, 0, 1),
    u_grainMixer: 0,
    u_grainOverlay: 0.01
  });
  return new ShaderMount(host, meshGradientFragmentShader, uniforms, { alpha: true, premultipliedAlpha: false }, TUNING.meshSpeed, 0, MOBILE_VIEW ? 1 : 2, MAX_PIXELS);
}

/* 每帧把新的封面配色写进去（ShaderMount 的 setUniforms 会立即重绘一次） */
function paintPalette(cols) {
  palette = cols;
  const meshColors = cols.mesh.map((c) => hexToRgba(c, 1));
  const padded = meshColors.slice();
  for (let i = meshColors.length; i < 10; i++) padded.push(meshColors[meshColors.length - 1]);
  if (ditherMount) {
    ditherMount.setUniforms({
      u_colorBack: hexToRgba(cols.ditheringBack, 1),
      u_colorFront: hexToRgba(cols.ditheringFront, 1)
    });
  }
  if (meshMount) {
    meshMount.setUniforms({ u_colors: padded, u_colorsCount: meshColors.length });
  }
  if (overlayEl) overlayEl.style.background = cols.bg;
  /* 液态玻璃那块 canvas#c 是独立 WebGL，读不到这里的画面。
     场景在跑的时候把同一套调色板递给它，玻璃折射出来的颜色才跟背后一致，
     而不是继续挂着默认底图/封面。 */
  if (typeof window !== 'undefined' && window.Liquid && window.Liquid.setBgFromColors
      && document.body.dataset.foliaBg === 'fveil') {
    window.Liquid.setBgFromColors(cols.mesh, cols.ditheringBack);
  }
}

let coverToken = 0;
async function refreshCover() {
  const track = window.Player && window.Player.state && window.Player.state.currentTrack;
  const pic = (track && track.pic) || '';
  const key = String((track && track.id) || '') + '|' + pic;
  if (key === coverKey) return;
  coverKey = key;
  if (!pic || !window.MJMJCoverColors) { paintPalette(themePalette()); return; }
  const token = ++coverToken;
  let cover = [];
  try {
    cover = await window.MJMJCoverColors.extract(pic, 6);
  } catch (e) { cover = []; }
  if (token !== coverToken) return;
  if (running) paintPalette(paletteFromCover(cover));
  else palette = paletteFromCover(cover);
}

/* 官方 updateAudioResponse 的等价循环 */
function applyPaused() {
  return !!(window.Player && window.Player.state && window.Player.state.paused);
}

function readAudio() {
  const cs = getComputedStyle(document.documentElement);
  const bass = clamp(parseFloat(cs.getPropertyValue('--bass')) || 0, 0, 1);
  const mid = clamp(parseFloat(cs.getPropertyValue('--mid')) || 0, 0, 1);
  const treble = clamp(parseFloat(cs.getPropertyValue('--treble')) || 0, 0, 1);
  const power = clamp(parseFloat(cs.getPropertyValue('--energy')) || 0, 0, 1);
  const lowMid = (bass + mid) * 0.5;
  const vocal = mid;
  return { bass, lowMid, mid, vocal, treble, power };
}

function bandEnergy(a) {
  const v = a.bass * 0.22 + a.lowMid * 0.18 + a.mid * 0.22 + a.vocal * 0.28 + a.treble * 0.1;
  return Math.pow(clamp(v, 0, 1), 0.55);
}

function ease(cur, target, amount) { return cur + (target - cur) * amount; }

function tick(now) {
  raf = requestAnimationFrame(tick);
  if (!running) return;

  const paused = applyPaused();
  const pauseStep = lastFrameAt === null ? 0 : 1 - Math.exp((lastFrameAt - now) / PAUSE_EASE_MS);
  lastFrameAt = now;
  playingAmt = ease(playingAmt, paused ? 0 : 1, pauseStep);

  const a = paused ? { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0, power: 0 } : readAudio();
  const targetEnergy = paused ? 0 : bandEnergy(a);
  const targetMid = paused ? 0 : Math.max(a.mid, a.vocal);

  smoothedPower = ease(smoothedPower, paused ? 0 : a.power, 0.12);
  smoothedBass = ease(smoothedBass, paused ? 0 : a.bass, 0.16);
  smoothedMid = ease(smoothedMid, targetMid, 0.13);

  onsetPulse = Math.max(onsetPulse * 0.84, clamp((targetEnergy - prevEnergy) * 7, 0, 1));
  prevEnergy = targetEnergy;

  const beatTarget = clamp(targetEnergy * 0.42 + onsetPulse * 0.85, 0, 1);
  smoothedBeatSpeed = ease(smoothedBeatSpeed, beatTarget, beatTarget > smoothedBeatSpeed ? 0.42 : 0.14);

  const speedOf = (base, audioSpeed) => clamp(
    paused ? base * PAUSED_SPEED_SCALE : ease(base, audioSpeed, smoothedBeatSpeed),
    0, 2
  );

  if (ditherMount) {
    const speed = speedOf(TUNING.ditheringSpeed, TUNING.ditheringAudioSpeed);
    ditherMount.setSpeed(speed);
    ditherMount.setUniforms({
      u_pxSize: Math.max(0.5, TUNING.ditheringSize - smoothedBass * TUNING.ditheringSize * 0.34)
    });
  }
  if (meshMount) {
    const speed = speedOf(TUNING.meshSpeed, TUNING.meshAudioSpeed);
    meshMount.setSpeed(speed);
    meshMount.setUniforms({
      u_distortion: TUNING.meshDistortion + smoothedPower * 0.62,
      u_swirl: TUNING.meshSwirl + smoothedMid * 0.38
    });
  }
  if (ditherEl) {
    ditherEl.style.opacity = String(Math.min(1, TUNING.ditheringOpacity + smoothedBass * 0.25));
    ditherEl.style.transform = 'scale(' + (1.015 + smoothedBass * 0.025) + ')';
  }
  if (meshEl) {
    meshEl.style.filter = 'saturate(' + (1.04 + smoothedMid * 0.34) + ') brightness(' + (0.94 + smoothedPower * 0.16) + ')';
    meshEl.style.transform = 'scale(' + (1.025 + smoothedPower * 0.018) + ')';
  }
}

function start() {
  if (running) return;
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  host.innerHTML = '';
  const cols = palette || themePalette();

  meshEl = document.createElement('div');
  ditherEl = document.createElement('div');
  overlayEl = document.createElement('div');
  meshEl.className = 'latent-layer latent-mesh';
  ditherEl.className = 'latent-layer latent-dither';
  overlayEl.className = 'latent-overlay';
  meshEl.style.transformOrigin = 'center';
  meshEl.style.transform = 'scale(1.025)';
  ditherEl.style.transformOrigin = 'center';
  ditherEl.style.transform = 'scale(1.015)';
  /* 官方：有 mesh 时网点用 soft-light 叠上去 */
  ditherEl.style.mixBlendMode = 'soft-light';
  ditherEl.style.opacity = String(TUNING.ditheringOpacity);
  overlayEl.style.background = cols.bg;
  overlayEl.style.opacity = String(TUNING.overlayOpacity);

  host.appendChild(meshEl);
  host.appendChild(ditherEl);
  host.appendChild(overlayEl);

  try {
    meshMount = buildMesh(meshEl, cols);
    ditherMount = buildDither(ditherEl, cols);
    palette = cols;
    running = true;
    lastFrameAt = null;
    if (!raf) raf = requestAnimationFrame(tick);
    refreshCover();
  } catch (err) {
    console.error('[folio-bg] latent 着色器启动失败', err);
    stop();
    /* 没有 webgl2 / 着色器编不出来时不能留一块黑屏：用同一套调色板铺 CSS 渐变兜底 */
    const fb = document.getElementById(HOST_ID);
    if (fb) {
      const m = (cols && cols.mesh) || [];
      const stops = [m[0], m[1], m[2], m[3]].filter(Boolean);
      const g = document.createElement('div');
      g.className = 'latent-fallback';
      g.style.background = stops.length
        ? 'linear-gradient(135deg,' + stops.join(',') + ')'
        : '#101828';
      fb.appendChild(g);
    }
  }
}

function stop() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (meshMount && meshMount.dispose) meshMount.dispose();
  if (ditherMount && ditherMount.dispose) ditherMount.dispose();
  meshMount = null;
  ditherMount = null;
  if (meshEl && meshEl.parentNode) meshEl.parentNode.removeChild(meshEl);
  if (ditherEl && ditherEl.parentNode) ditherEl.parentNode.removeChild(ditherEl);
  if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
  meshEl = ditherEl = overlayEl = null;
  running = false;
}

function wanted() {
  return document.body && document.body.dataset.foliaBg === 'fveil';
}

function sync() {
  if (wanted()) start();
  else if (running) stop();
}

/* 换歌就换封面纹理：颜色来自封面代表色，而不是固定主题色 */
if (window.Player && window.Player.onChange) {
  window.Player.onChange(() => { refreshCover(); });
}

const obs = new MutationObserver(sync);
obs.observe(document.body, { attributes: true, attributeFilter: ['data-folia-bg'] });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { sync(); refreshCover(); });
} else {
  sync();
  refreshCover();
}

window.MJMJLatentBg = { start: start, stop: stop, sync: sync, refreshCover: refreshCover, getPalette: function () { return palette; } };
