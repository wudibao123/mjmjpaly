/* MJMJ · Mineradio 歌词舞台（真实着色器移植）
   -------------------------------------------------------------------------
   片元着色器的算法、变量命名、数值区间逐行取自 Mineradio-paused
   public/js/modules/02-visual/11-lyrics-shaders.js 的 makeLyricShaderMaterial，
   motionProfile 的六个分支数值取自其 02-visual/08-lyrics-display-modes.js
   的 lyricMotionProfile()，配色取自其默认视觉快照（高亮 #fac900、发光 #008aff、
   上下文 0.54）。这里只替换渲染载体：原版是 THREE 的平面网格，这里改成
   一行为一张文字遮罩纹理的全屏 quad，其余保持原算法。
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  const STYLE_PROFILE = {
    mrcinema: 'shine',
    mrktv: 'smooth',
    mrglow: 'shine',
    mrglitch: 'glitch',
    mrfloat: 'float',
    mrbilin: 'smooth'
  };

  /* 直接照抄 lyricMotionProfile() 的分支数值（smooth / float / shine / glitch） */
  const PROFILES = {
    smooth: { enter: 0.72, exit: 0.62, edgeBoost: 0.62, sweep: 0.18, shimmer: 0.05, glitch: 0, glitchSlice: 0, glitchChroma: 0, glitchRate: 1, glowLift: 0.74 },
    float: { enter: 0.86, exit: 0.76, edgeBoost: 1.04, sweep: 0.36, shimmer: 0.14, glitch: 0, glitchSlice: 0, glitchChroma: 0, glitchRate: 1, glowLift: 1.16 },
    shine: { enter: 0.50, exit: 0.44, edgeBoost: 1.42, sweep: 1.22, shimmer: 0.34, glitch: 0, glitchSlice: 0, glitchChroma: 0, glitchRate: 1, glowLift: 1.30 },
    glitch: { enter: 0.40, exit: 0.36, edgeBoost: 1.18, sweep: 0.54, shimmer: 0.28, glitch: 1.0, glitchSlice: 0.72, glitchChroma: 0.86, glitchRate: 1.0, glowLift: 1.18 }
  };

  const COLOR = {
    base: [0.33, 0.62, 0.72],   /* pal.primary → 偏青的暗底字 */
    hi: [0.980, 0.788, 0.000],  /* #fac900 高亮 */
    glow: [0.000, 0.541, 1.000],/* #008aff 发光 */
    solar: [1.000, 0.941, 0.722]/* #fff0b8 日晕 */
  };
  const CONTEXT_OPACITY = 0.54;  /* lyricContextOpacity */
  const ACTIVE_FEATHER = 0.055;  /* uFeather（非原生卡拉OK） */

  const VS = [
    'attribute vec2 a_pos;',
    'uniform vec2 uCenter;',
    'uniform vec2 uHalf;',
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);',
    '  gl_Position = vec4(uCenter + a_pos * uHalf, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* 以下 fragment 主体逐行对应原版 makeLyricShaderMaterial 的 fragmentShader */
  const FS = [
    'precision highp float;',
    'uniform sampler2D uMap;',
    'uniform float uTime,uProgress,uTextMin,uTextMax,uOpacity,uFeather,uSolar,uSweep,uShimmer,uGlitch,uGlitchSlice,uGlitchChroma,uGlitchRate,uGlitchSeed,uGlitchBurst,uEdgeBoost,uActiveMix;',
    'uniform vec3 uBaseColor,uHiColor,uGlowColor,uSolarColor;',
    'varying vec2 vUv;',
    'float hash(float n){ return fract(sin(n) * 43758.5453123); }',
    'float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }',
    'void main(){',
    '  vec2 uv = vUv;',
    '  float sliceRows = mix(16.0, 38.0, clamp(uGlitchSlice / 1.4, 0.0, 1.0));',
    '  float row = floor((uv.y + hash(uGlitchSeed) * 0.035) * sliceRows);',
    '  float timeSlot = floor(uTime * mix(7.0, 24.0, clamp(uGlitchRate / 2.2, 0.0, 1.0)) + hash(uGlitchSeed * 1.37) * 5.0);',
    '  float rowRnd = hash2(vec2(row + uGlitchSeed, timeSlot));',
    '  float phaseRnd = hash2(vec2(timeSlot + uGlitchSeed * 0.71, row * 3.17));',
    '  float glitchGate = smoothstep(0.74, 0.99, rowRnd + uGlitchBurst * 0.28) * step(0.001, uGlitch);',
    '  float glitchDir = hash2(vec2(row * 5.11, timeSlot + uGlitchSeed)) < 0.5 ? -1.0 : 1.0;',
    '  float micro = hash2(vec2(floor(uv.x * 19.0) + row, timeSlot * 1.31 + uGlitchSeed));',
    '  float glitchWave = (phaseRnd * 2.0 - 1.0) * (0.55 + micro * 0.95);',
    '  float glitchWidth = (0.0020 + rowRnd * rowRnd * 0.0085) * (0.55 + uGlitchBurst * 1.85);',
    '  vec2 sampleUv = uv + vec2(glitchGate * glitchDir * glitchWave * uGlitch * uGlitchSlice * glitchWidth, 0.0);',
    '  float mask = texture2D(uMap, sampleUv).a;',
    '  if(mask < 0.01) discard;',
    '  float activeMix = clamp(uActiveMix, 0.0, 1.0);',
    '  float denom = max(0.001, uTextMax - uTextMin);',
    '  float p = clamp((uv.x - uTextMin) / denom, 0.0, 1.0);',
    '  float filled = (1.0 - smoothstep(uProgress, uProgress + uFeather, p)) * activeMix;',
    '  float edge = (1.0 - smoothstep(0.0, uFeather * 2.8, abs(p - uProgress))) * activeMix;',
    '  float sweepPhase = fract(uTime * (0.28 + uSweep * 0.10));',
    '  float sweepLine = (1.0 - smoothstep(0.0, 0.080, abs((uv.x + uv.y * 0.42) - (sweepPhase * 1.42 - 0.18)))) * activeMix;',
    '  float fineLine = pow(max(0.0, sin((uv.x - uv.y * 0.18 + uTime * 0.82) * 42.0)), 24.0) * uShimmer * activeMix;',
    '  float chromaOffset = (0.0028 + phaseRnd * 0.0048 + uGlitchBurst * 0.0038) * uGlitch * uGlitchChroma;',
    '  float chromaR = texture2D(uMap, sampleUv + vec2(chromaOffset * glitchDir, 0.0)).a;',
    '  float chromaB = texture2D(uMap, sampleUv - vec2(chromaOffset * glitchDir, 0.0)).a;',
    '  vec3 color = mix(uBaseColor, uHiColor, filled * 0.88);',
    '  color += uGlowColor * edge * 0.14 * uEdgeBoost;',
    '  color += uSolarColor * sweepLine * uSweep * (0.12 + filled * 0.30);',
    '  color += uGlowColor * fineLine * (0.08 + filled * 0.18);',
    '  color += vec3(chromaR, mask * 0.18, chromaB) * glitchGate * uGlitch * uGlitchChroma * activeMix * (0.20 + uGlitchBurst * 0.22);',
    '  vec3 solar = uSolarColor;',
    '  color = mix(color, color + solar * 0.34, uSolar * activeMix * (0.25 + filled * 0.45));',
    '  color += solar * edge * uSolar * 0.22;',
    '  float lum = dot(color, vec3(0.299, 0.587, 0.114));',
    '  color += vec3(max(0.0, 0.30 - lum));',
    '  float alpha = max(mask, max(chromaR, chromaB) * glitchGate * uGlitch * (0.30 + uGlitchBurst * 0.32));',
    '  gl_FragColor = vec4(color, alpha * uOpacity);',
    '}'
  ].join('\n');

  let canvas = null, gl = null, prog = null, quad = null;
  let U = {};
  let ok = false, dead = false;
  const texCache = new Map();
  let dpr = 1, vw = 1, vh = 1;

  function isActive() {
    const s = document.body.dataset.lyricStyle || '';
    return Object.prototype.hasOwnProperty.call(STYLE_PROFILE, s);
  }

  function ensure() {
    if (ok) return true;
    if (dead) return false;
    canvas = document.getElementById('lyric-gl');
    if (!canvas) { dead = true; return false; }
    gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) { dead = true; return false; }

    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[lyricgl] shader', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) { dead = true; return false; }
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[lyricgl] link', gl.getProgramInfoLog(prog));
      dead = true;
      return false;
    }
    gl.useProgram(prog);

    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    ['uMap', 'uTime', 'uProgress', 'uTextMin', 'uTextMax', 'uOpacity', 'uFeather', 'uSolar',
      'uSweep', 'uShimmer', 'uGlitch', 'uGlitchSlice', 'uGlitchChroma', 'uGlitchRate',
      'uGlitchSeed', 'uGlitchBurst', 'uEdgeBoost', 'uActiveMix',
      'uBaseColor', 'uHiColor', 'uGlowColor', 'uSolarColor', 'uCenter', 'uHalf'].forEach((n) => {
        U[n] = gl.getUniformLocation(prog, n);
      });

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    ok = true;
    return true;
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = window.innerWidth;
    vh = window.innerHeight;
    if (!canvas) return;
    const w = Math.round(vw * dpr), h = Math.round(vh * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      texCache.clear();
    }
  }

  /* 把一个 span 的文字画成遮罩纹理（白字，取 alpha 通道） */
  function buildTexture(el, key) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const weight = cs.fontWeight || '400';
    const family = cs.fontFamily || 'sans-serif';
    const spacing = cs.letterSpacing && cs.letterSpacing !== 'normal' ? cs.letterSpacing : '0px';
    const text = el.textContent || '';
    if (!text) return null;

    const cw = Math.max(1, Math.round(rect.width * dpr));
    const ch = Math.max(1, Math.round(rect.height * dpr));
    const oc = document.createElement('canvas');
    oc.width = cw; oc.height = ch;
    const ctx = oc.getContext('2d');
    ctx.scale(dpr, dpr);
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing;
    ctx.font = weight + ' ' + fontSize + 'px ' + family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(text, rect.width / 2, rect.height / 2);

    const measured = ctx.measureText(text).width;
    const textMin = Math.max(0, (rect.width - measured) / (2 * rect.width));
    const textMax = Math.min(1, 1 - textMin);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return { tex: tex, key: key, textMin: textMin, textMax: textMax, w: rect.width, h: rect.height };
  }

  let lastTime = 0;
  let solarValue = 0;

  function drawRow(entry, rect, prof, opts) {
    const cx = ((rect.left + rect.width / 2) / vw) * 2 - 1;
    const cy = 1 - ((rect.top + rect.height / 2) / vh) * 2;
    const hx = rect.width / vw;
    const hy = rect.height / vh;

    gl.uniform2f(U.uCenter, cx, cy);
    gl.uniform2f(U.uHalf, hx, hy);
    gl.uniform1i(U.uMap, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);

    gl.uniform1f(U.uTextMin, entry.textMin);
    gl.uniform1f(U.uTextMax, entry.textMax);
    gl.uniform1f(U.uProgress, opts.progress);
    gl.uniform1f(U.uOpacity, opts.opacity);
    gl.uniform1f(U.uActiveMix, opts.active);
    gl.uniform1f(U.uFeather, ACTIVE_FEATHER);
    gl.uniform1f(U.uSolar, opts.solar);
    gl.uniform1f(U.uSweep, prof.sweep);
    gl.uniform1f(U.uShimmer, prof.shimmer);
    gl.uniform1f(U.uGlitch, prof.glitch);
    gl.uniform1f(U.uGlitchSlice, prof.glitchSlice);
    gl.uniform1f(U.uGlitchChroma, prof.glitchChroma);
    gl.uniform1f(U.uGlitchRate, prof.glitchRate);
    gl.uniform1f(U.uGlitchSeed, opts.seed);
    gl.uniform1f(U.uGlitchBurst, opts.burst);
    gl.uniform1f(U.uEdgeBoost, prof.edgeBoost);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function tick() {
    if (!isActive()) {
      if (canvas) canvas.style.display = 'none';
      return;
    }
    if (!ensure()) return;
    canvas.style.display = 'block';
    resize();

    const style = document.body.dataset.lyricStyle;
    const prof = PROFILES[STYLE_PROFILE[style]] || PROFILES.float;
    const stage = document.getElementById('lyric-stage');
    if (!stage) return;

    const now = performance.now() / 1000;
    const dt = lastTime ? Math.min(0.08, now - lastTime) : 0.016;
    lastTime = now;

    /* 节拍：沿用整站写好的 --bass / --energy，合成一次衰减的日晕 */
    const rootStyle = getComputedStyle(document.documentElement);
    const bass = parseFloat(rootStyle.getPropertyValue('--bass')) || 0;
    const energy = parseFloat(rootStyle.getPropertyValue('--energy')) || 0;
    const target = Math.max(0, Math.min(1, bass * 1.15));
    solarValue += (target - solarValue) * (target > solarValue ? 0.6 : 0.16);

    const lines = stage.querySelectorAll('.ly-line');
    if (!lines.length) { gl.clear(gl.COLOR_BUFFER_BIT); return; }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const curLine = stage.querySelector('.ly-line[data-rel="0"]');
    const progress = curLine ? (parseFloat(curLine.style.getPropertyValue('--p')) || 0) : 0;

    Array.prototype.forEach.call(lines, function (line, li) {
      if (line.classList.contains('is-empty')) return;
      const rel = Number(line.dataset.rel || 0);
      const baseEl = line.querySelector('.ly-base');
      const trEl = line.querySelector('.ly-tr');
      if (!baseEl) return;

      const isActiveRow = rel === 0;
      const bias = Math.abs(rel);

      /* 上下文行按 lyricContextOpacity 直接压暗，越远越淡 */
      const ctxOpacity = CONTEXT_OPACITY / (1 + bias * 0.45);

      const baseRect = baseEl.getBoundingClientRect();
      const keyBase = 'b|' + li + '|' + (baseEl.textContent || '') + '|' + baseRect.width.toFixed(1) + 'x' + baseRect.height.toFixed(1) + '|' + style;
      let entryB = texCache.get(keyBase);
      if (!entryB) {
        entryB = buildTexture(baseEl, keyBase);
        if (entryB) texCache.set(keyBase, entryB);
      }
      if (entryB) {
        drawRow(entryB, baseRect, prof, {
          progress: isActiveRow ? progress : 1,
          opacity: isActiveRow ? 1 : ctxOpacity,
          active: isActiveRow ? 1 : 0,
          solar: isActiveRow ? solarValue : 0,
          seed: (li * 37 + 11) % 997,
          burst: Math.max(0, solarValue - 0.65) * 1.4
        });
      }

      if (trEl) {
        const trRect = trEl.getBoundingClientRect();
        if (trRect.width > 1 && trRect.height > 1) {
          const keyTr = 't|' + li + '|' + (trEl.textContent || '') + '|' + trRect.width.toFixed(1) + 'x' + trRect.height.toFixed(1) + '|' + style;
          let entryT = texCache.get(keyTr);
          if (!entryT) {
            entryT = buildTexture(trEl, keyTr);
            if (entryT) texCache.set(keyTr, entryT);
          }
          if (entryT) {
            drawRow(entryT, trRect, prof, {
              progress: 1,
              opacity: isActiveRow ? 0.86 : ctxOpacity,
              active: 0,
              solar: 0,
              seed: (li * 53 + 7) % 997,
              burst: 0
            });
          }
        }
      }
    });

    /* 纹理缓存按行数收口，避免切歌后无限增长 */
    if (texCache.size > 48) {
      const keys = Array.from(texCache.keys());
      const keep = keys.slice(-24);
      keys.forEach((k) => {
        if (keep.indexOf(k) < 0) {
          gl.deleteTexture(texCache.get(k).tex);
          texCache.delete(k);
        }
      });
    }
  }

  window.MJMJLyricGL = { tick: tick, isActive: isActive, invalidate: function () { texCache.clear(); } };
  window.addEventListener('resize', function () { texCache.clear(); });
})();
