/* MJMJ · 液态玻璃 WebGL 引擎（原版迁移 + 透明画布 / 节奏 CSS 变量 / 背景模式） */
(function () {
  'use strict';

  const canvas = document.getElementById('c');
  const contentCanvas = document.getElementById('contentCanvas');
  const cCtx = contentCanvas.getContext('2d');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });

  /* ===== 灵动岛交互（保留原版三态） ===== */
  const island = document.getElementById('dynamic-island');
  const btnCloseIsland = document.getElementById('btnCloseIsland');
  let isExpanded = false;
  island.addEventListener('mouseenter', () => { if (!isExpanded) island.classList.add('hover'); });
  island.addEventListener('mouseleave', () => { if (!isExpanded) island.classList.remove('hover'); });
  island.addEventListener('pointerdown', (e) => {
    if (isExpanded || e.target.closest('.island-expanded') || e.target.closest('.island-tab')) return;
    isExpanded = true; island.classList.remove('hover'); island.classList.add('expanded');
  });
  btnCloseIsland.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); isExpanded = false; island.classList.remove('expanded');
  });
  window.addEventListener('pointerdown', (e) => {
    if (isExpanded && !e.target.closest('#dynamic-island')) {
      isExpanded = false; island.classList.remove('expanded');
    }
  });

  /* ===== 着色器（原版 + 程序化极光 + 透明输出） ===== */
  const vsSource = `attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  const fsSource = `
    precision highp float;
    uniform vec2 u_res, u_texRes, u_center, u_stretch, u_half_size;
    uniform sampler2D u_texBg, u_texContent;
    uniform float u_hasTex, u_q_scale, u_bass, u_zoom, u_height, u_blur, u_strength, u_chromatic, u_hue;

    vec3 hsl2rgb(float h, float s, float l) {
      vec3 rgb = clamp(abs(mod(vec3(h / 60.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      return l + s * (l < 0.5 ? l : 1.0 - l) * (rgb - 0.5) * 2.0;
    }
    float sdRoundedBox(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }
    vec2 getNormal(vec2 p, vec2 b, float r) {
        float e = 1.5;
        return normalize(vec2(sdRoundedBox(p + vec2(e, 0.0), b, r) - sdRoundedBox(p - vec2(e, 0.0), b, r), sdRoundedBox(p + vec2(0.0, e), b, r) - sdRoundedBox(p - vec2(0.0, e), b, r)));
    }
    vec3 getBaseColor(vec2 frag) {
        vec3 bg;
        if (u_hasTex < 0.5) {
            vec2 uv = frag / u_res;
            vec3 c1 = hsl2rgb(u_hue, 0.82, 0.58);
            vec3 c2 = hsl2rgb(u_hue + 62.0, 0.92, 0.56);
            vec3 c3 = hsl2rgb(u_hue - 42.0, 0.85, 0.56);
            vec3 col = mix(c1, c2, uv.y + 0.12 * sin(uv.x * 6.2831 + u_bass * 10.0));
            float d1 = length(uv - vec2(0.66, 0.60));
            col = mix(col, c2, smoothstep(0.42, 0.40, d1));
            float d2 = length(uv - vec2(0.30, 0.42));
            col = mix(col, c3, smoothstep(0.34, 0.32, d2));
            float d3 = length(uv - vec2(0.54, 0.26));
            col = mix(col, c3, smoothstep(0.30, 0.28, d3));
            col = mix(col, hsl2rgb(u_hue + 130.0, 0.9, 0.7), 0.10 + u_bass * 0.18);
            bg = col;
        } else {
            float sc = max(u_res.x / u_texRes.x, u_res.y / u_texRes.y);
            vec2 size = u_texRes * sc;
            vec2 off = (u_res - size) * 0.5;
            vec2 uv = (frag - off) / size;
            bg = texture2D(u_texBg, clamp(uv, 0.0, 1.0)).rgb;
        }
        vec2 uvContent = vec2(frag.x, u_res.y - frag.y) / u_res;
        uvContent = clamp(uvContent, 0.0, 1.0);
        vec4 content = texture2D(u_texContent, uvContent);
        return mix(bg, content.rgb, content.a);
    }
    vec4 renderGlass(vec2 frag, vec2 center, vec2 halfSize, float radius) {
        vec2 p = frag - center;
        p.x /= u_stretch.x; p.y /= u_stretch.y; p /= u_q_scale;
        float d = sdRoundedBox(p, halfSize, radius);
        float minScale = min(u_stretch.x, u_stretch.y) * u_q_scale;
        d *= minScale;
        if (d > 60.0) return vec4(0.0);
        float t = clamp(-d / u_height, 0.0, 1.0);
        float edgeFactor = pow(1.0 - t, 4.0);
        vec2 n = getNormal(p, halfSize, radius);
        vec2 offset = -n * edgeFactor * u_strength;
        offset *= smoothstep(0.0, 0.2, t);
        float v_factor = clamp(p.y / halfSize.y, -1.0, 1.0);
        offset.x += v_factor * edgeFactor * 18.0;
        float dispersion = edgeFactor * (u_chromatic + u_bass * 15.0);
        vec2 offR = offset + n * dispersion, offB = offset - n * dispersion * 1.2, offG = offset;
        vec3 col;
        if (u_blur > 0.1) {
            vec3 colR = vec3(0.0), colG = vec3(0.0), colB = vec3(0.0);
            float total = 0.0;
            for(float x = -1.0; x <= 1.0; x += 1.0) {
                for(float y = -1.0; y <= 1.0; y += 1.0) {
                    vec2 jitter = vec2(x, y) * u_blur;
                    colR += getBaseColor(frag + offR + jitter).rgb;
                    colG += getBaseColor(frag + offG + jitter).rgb;
                    colB += getBaseColor(frag + offB + jitter).rgb;
                    total += 1.0;
                }
            }
            col.r = colR.r / total; col.g = colG.g / total; col.b = colB.b / total;
        } else {
            col.r = getBaseColor(frag + offR).r; col.g = getBaseColor(frag + offG).g; col.b = getBaseColor(frag + offB).b;
        }
        float fresnel = pow(1.0 - t, 6.0);
        col += vec3(0.8, 0.9, 1.0) * fresnel * 0.5;
        float rim = exp(-pow(d / 1.5, 2.0));
        col += vec3(1.0) * rim * 0.55;
        return vec4(col, smoothstep(2.0, -2.0, d));
    }
    void main() {
        vec2 center = u_res * 0.5, frag = gl_FragCoord.xy;
        vec2 scaledFrag = (frag - center) / u_zoom + center;
        // 内容层（歌词 / 波形）也跟着推拉一起缩放，整画面同步，而不是只有玻璃内部在动
        vec2 uvContent = vec2(scaledFrag.x, u_res.y - scaledFrag.y) / u_res;
        vec4 content = texture2D(u_texContent, clamp(uvContent, 0.0, 1.0));
        float radius = min(u_half_size.x, u_half_size.y);
        vec4 glass = renderGlass(scaledFrag, u_center, u_half_size, radius);
        vec4 col = content;
        col = mix(col, glass, glass.a);
        gl_FragColor = col;
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const a_pos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(a_pos);
  gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    res: gl.getUniformLocation(program, 'u_res'),
    texRes: gl.getUniformLocation(program, 'u_texRes'),
    texBg: gl.getUniformLocation(program, 'u_texBg'),
    texContent: gl.getUniformLocation(program, 'u_texContent'),
    hasTex: gl.getUniformLocation(program, 'u_hasTex'),
    center: gl.getUniformLocation(program, 'u_center'),
    stretch: gl.getUniformLocation(program, 'u_stretch'),
    qScale: gl.getUniformLocation(program, 'u_q_scale'),
    bass: gl.getUniformLocation(program, 'u_bass'),
    height: gl.getUniformLocation(program, 'u_height'),
    blur: gl.getUniformLocation(program, 'u_blur'),
    strength: gl.getUniformLocation(program, 'u_strength'),
    chromatic: gl.getUniformLocation(program, 'u_chromatic'),
    halfSize: gl.getUniformLocation(program, 'u_half_size'),
    zoom: gl.getUniformLocation(program, 'u_zoom'),
    hue: gl.getUniformLocation(program, 'u_hue'),
  };

  let bgTexW = 1, bgTexH = 1, hasBgTex = false;
  const bgTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, bgTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

  const contentTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, contentTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  function uploadBg(img) {
    const max = 2048;
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const scale = Math.min(1, max / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, bgTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    bgTexW = w; bgTexH = h; hasBgTex = true;
  }

  /* ===== 背景纹理 API ===== */
  /* bgToken：每次换/清背景都作废上一张图的 onload。
     不这么做的话，启动时 applyBgMode 先 clearBg()，而末尾 img.onload 稍后才回来，
     又把默认底图写进纹理 —— 表现就是「明明选了场景，中央玻璃里还挂着默认那张图」。 */
  let bgToken = 0;
  function bgFromUrl(url) {
    const my = ++bgToken;
    const img = new Image();
    img.onload = () => { if (my !== bgToken) return; uploadBg(img); };
    img.onerror = () => console.warn('背景图加载失败', url);
    img.src = url;
  }
  function bgFromFile(file) {
    const url = URL.createObjectURL(file);
    const my = ++bgToken;
    const img = new Image();
    img.onload = () => { if (my !== bgToken) { URL.revokeObjectURL(url); return; } uploadBg(img); URL.revokeObjectURL(url); };
    img.onerror = () => { console.warn('背景图解码失败'); URL.revokeObjectURL(url); };
    img.src = url;
  }
  function clearBg() { bgToken++; hasBgTex = false; }

  /* ===== 参数与物理（原版） ===== */
  const defaultParams = { height: 34, blur: 0.0, strength: 91, chromatic: 15, zoomAmp: 0.05, zoomSens: 1.0, glassSize: 1.0 };
  let params = { ...defaultParams };
  let isZoomEnabled = false;
  let isKtvMode = false;

  const savedConfig = localStorage.getItem('liquid_glass_config');
  if (savedConfig) {
    try {
      const parsed = JSON.parse(savedConfig);
      params = { ...params, ...parsed.params };
      isZoomEnabled = parsed.isZoomEnabled;
    } catch (e) {}
  }

  const bindSlider = (id, valId, key, suffix = '') => {
    const slider = document.getElementById(id);
    const valEl = document.getElementById(valId);
    slider.value = params[key];
    valEl.innerText = params[key] + suffix;
    slider.addEventListener('input', (e) => {
      params[key] = parseFloat(e.target.value);
      valEl.innerText = params[key] + suffix;
    });
  };
  bindSlider('s-height', 'v-height', 'height');
  bindSlider('s-blur', 'v-blur', 'blur', '.0');
  bindSlider('s-strength', 'v-strength', 'strength');
  bindSlider('s-chromatic', 'v-chromatic', 'chromatic');
  bindSlider('s-zoom-amp', 'v-zoom-amp', 'zoomAmp');
  bindSlider('s-zoom-sens', 'v-zoom-sens', 'zoomSens', '');
  bindSlider('s-glass-size', 'v-glass-size', 'glassSize', '');
  bindSlider('s-glass-size', 'v-glass-size', 'glassSize', '');

  const zoomControls = document.getElementById('zoom-controls');
  const zoomCheckbox = document.getElementById('s-zoom');
  zoomCheckbox.checked = isZoomEnabled;
  zoomControls.classList.toggle('disabled', !isZoomEnabled);
  zoomCheckbox.addEventListener('change', (e) => {
    isZoomEnabled = e.target.checked;
    zoomControls.classList.toggle('disabled', !isZoomEnabled);
  });

  const saveBtn = document.getElementById('saveConfigBtn');
  // 供灵动岛「设置」页的“保存此配置”统一调用
  window.MJMJ_SAVE_GLASS = () => {
    try { localStorage.setItem('liquid_glass_config', JSON.stringify({ params, isZoomEnabled })); } catch (e) {}
  };
  let saveTimeout = null;
  saveBtn.addEventListener('click', () => {
    localStorage.setItem('liquid_glass_config', JSON.stringify({ params, isZoomEnabled }));
    saveBtn.innerText = '已保存';
    saveBtn.classList.add('saved');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveBtn.innerText = '保存当前配置';
      saveBtn.classList.remove('saved');
    }, 1500);
  });

  /* ===== 物理状态 ===== */
  let targetCenter = { x: 0, y: 0 }, currentCenter = { x: 0, y: 0 }, prevCenter = { x: 0, y: 0 };
  let isDragging = false;
  let targetStretch = { x: 1.0, y: 1.0 }, currentStretch = { x: 1.0, y: 1.0 };
  let currentQScale = 1.0, qScaleVelocity = 0.0;
  let currentZoom = 1.0, targetZoom = 1.0, zoomAmpSmooth = 0.05;
  let currentHalfSize = { x: 180, y: 70 }, targetHalfSize = { x: 180, y: 70 };
  let pulseScale = 1.0;
  let draggingLyricIndex = -1, lyricDragOffset = { x: 0, y: 0 }, mouse = { x: 0, y: 0 };
  let walkerProgress = 0;
  let mouseVel = { x: 0, y: 0 };
  let bassSmooth = 0, energySmooth = 0;
  let hueOffset = 0, px = 30, py = 34;

  setTimeout(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    targetCenter = { x: canvas.width / 2, y: canvas.height / 2 };
    currentCenter = { x: canvas.width / 2, y: canvas.height / 2 };
    prevCenter = { x: canvas.width / 2, y: canvas.height / 2 };
  }, 50);

  /* ===== 进度条（保留原锚点 bottom:95px） ===== */
  const progressWrapper = document.getElementById('progressWrapper');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const currentTimeLabel = document.getElementById('currentTimeLabel');
  const totalTimeLabel = document.getElementById('totalTimeLabel');
  const islandCover = document.getElementById('islandCover');
  const islandTitle = document.getElementById('islandTitle');
  const islandArtist = document.getElementById('islandArtist');

  function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  }

  let isDraggingProgress = false, dragTargetTime = 0;
  progressContainer.addEventListener('pointerdown', (e) => {
    const st = Player.state;
    if (!st.duration) return;
    isDraggingProgress = true;
    progressContainer.classList.add('dragging');
    updateProgress(e);
  });
  window.addEventListener('pointermove', (e) => { if (isDraggingProgress) updateProgress(e); });
  window.addEventListener('pointerup', () => {
    if (isDraggingProgress) {
      isDraggingProgress = false;
      progressContainer.classList.remove('dragging');
      Player.seekTo(dragTargetTime);
    }
  });

  function updateProgress(e) {
    const rect = progressContainer.getBoundingClientRect();
    let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = x / rect.width;
    progressFill.style.width = (percent * 100) + '%';
    dragTargetTime = percent * Player.state.duration;
    currentTimeLabel.innerText = formatTime(dragTargetTime);
  }

  /* ===== 交互（原版：拖玻璃 / 拖歌词） ===== */
  window.addEventListener('pointerdown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.id === 'file' || e.target.tagName === 'INPUT' ||
        e.target.closest('#dynamic-island') || e.target.closest('.progress-wrapper') ||
        e.target.closest('#playlist-panel') || e.target.closest('#win-controls') ||
        e.target.closest('#login-modal') || e.target.closest('#user-menu')) return;
    const st = Player.state;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    mouse = { x: e.clientX * dpr, y: e.clientY * dpr };

    if (draggingLyricIndex !== -1) {
      const pos = st.cachedLyricPositions[draggingLyricIndex];
      const dx = mouse.x - pos.currX, dy = mouse.y - pos.currY;
      if (Math.abs(dx) < st.lyricsData[draggingLyricIndex].text.length * pos.size * 0.8 * dpr &&
          Math.abs(dy) < pos.size * dpr * 2) { draggingLyricIndex = -1; return; }
      draggingLyricIndex = -1;
    }
    let hitIndex = -1;
    if (st.lyricsData.length > 0) {
      for (let i = 0; i < st.lyricsData.length; i++) {
        if (i < st.currentLyricIndex - 5) continue;
        const pos = st.cachedLyricPositions[i];
        if (!pos || !pos.isInit) continue;
        const dx = mouse.x - pos.currX, dy = mouse.y - pos.currY;
        if (Math.abs(dx) < st.lyricsData[i].text.length * pos.size * 0.9 * dpr &&
            Math.abs(dy) < pos.size * 1.5 * dpr) { hitIndex = i; break; }
      }
    }
    if (hitIndex !== -1 && window.MJMJ_LYRIC_DRAG === false) { draggingLyricIndex = -1; return; }
    if (hitIndex !== -1) {
      draggingLyricIndex = hitIndex; isDragging = false;
      lyricDragOffset = { x: mouse.x - st.cachedLyricPositions[hitIndex].currX, y: mouse.y - st.cachedLyricPositions[hitIndex].currY };
    } else {
      const cx = mouse.x, cy = (window.innerHeight * dpr) - mouse.y;
      const touchPadding = 20 * dpr;
      if (Math.abs(cx - currentCenter.x) < (currentHalfSize.x * dpr * currentQScale) + touchPadding &&
          Math.abs(cy - currentCenter.y) < (currentHalfSize.y * dpr * currentQScale) + touchPadding) {
        isDragging = true;
        targetCenter = { x: cx, y: cy };
        currentCenter = { x: cx, y: cy };
        prevCenter = { x: cx, y: cy };
        mouseVel = { x: 0, y: 0 };
      }
    }
  });

  window.addEventListener('pointermove', (e) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const mx = e.clientX * dpr, my = (window.innerHeight * dpr) - e.clientY * dpr;

    if (isDragging) {
      mouseVel.x = mx - targetCenter.x;
      mouseVel.y = my - targetCenter.y;
    }

    mouse = { x: e.clientX * dpr, y: e.clientY * dpr };
    if (isDragging) {
      targetCenter = { x: mouse.x, y: (window.innerHeight * dpr) - mouse.y };
    } else if (draggingLyricIndex !== -1) {
      const pos = Player.state.cachedLyricPositions[draggingLyricIndex];
      pos.currX = mouse.x - lyricDragOffset.x;
      pos.currY = mouse.y - lyricDragOffset.y;
      pos.currRot += (0 - pos.currRot) * 0.2;
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (isDragging) { isDragging = false; return; }
    if (draggingLyricIndex !== -1) {
      const st = Player.state;
      const pos = st.cachedLyricPositions[draggingLyricIndex];
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const dist = Math.hypot(pos.currX - window.innerWidth * dpr / 2, pos.currY - window.innerHeight * dpr / 2);
      if (dist < 250 * dpr) {
        Player.seekTo(st.lyricsData[draggingLyricIndex].time);
        st.currentLyricIndex = draggingLyricIndex;
        pulseScale = 1.3;
        st.isLyricSettled = false;
      }
      draggingLyricIndex = -1;
    }
  });

  window.addEventListener('touchmove', (e) => {
    if (isDragging || draggingLyricIndex !== -1) e.preventDefault();
  }, { passive: false });

  /* ===== 绘制内容层（歌词 + 波形） ===== */
  const waveData = new Uint8Array(256);
  function drawContent(time) {
    const w = contentCanvas.width, h = contentCanvas.height;
    const st = Player.state;
    cCtx.clearRect(0, 0, w, h);

    if (st.analyser && !st.paused) {
      st.analyser.getByteTimeDomainData(waveData);
      const globalHue = (time * 0.015 + bassSmooth * 20) % 360;
      cCtx.beginPath();
      const sliceWidth = w * 1.0 / waveData.length;
      let x = 0;
      cCtx.beginPath(); cCtx.moveTo(0, h);
      for (let i = 0; i < waveData.length; i++) {
        const y = h * 0.85 - (waveData[i] / 128.0 - 1.0) * h * 0.12 * (1.0 + bassSmooth * 0.4);
        if (i === 0) cCtx.lineTo(0, y);
        else {
          const prevX = (i - 1) * sliceWidth, prevV = waveData[i - 1] / 128.0;
          cCtx.bezierCurveTo((prevX + x) / 2, h * 0.85 - (prevV - 1.0) * h * 0.12 * (1.0 + bassSmooth * 0.4), (prevX + x) / 2, y, x, y);
        }
        x += sliceWidth;
      }
      cCtx.lineTo(w, h);
      const grad = cCtx.createLinearGradient(0, h, 0, h * 0.6);
      grad.addColorStop(0, `hsla(${globalHue}, 80%, 60%, 0.14)`);
      grad.addColorStop(1, `hsla(${globalHue}, 80%, 60%, 0)`);
      cCtx.fillStyle = grad; cCtx.fill();
      cCtx.strokeStyle = `hsla(${globalHue}, 80%, 70%, 0.75)`;
      cCtx.lineWidth = 2;
      cCtx.shadowBlur = 8;
      cCtx.shadowColor = `hsla(${globalHue}, 80%, 70%, 0.8)`;
      cCtx.stroke();
      cCtx.shadowBlur = 0;
    }

    // 选了「歌词样式」里的非液态玻璃方案时，歌词交给 app.js 的 DOM 歌词层渲染，这里只留波形
    const domLyricMode = document.body.dataset.lyricStyle && document.body.dataset.lyricStyle !== 'liquid';
    if (st.lyricsData.length > 0 && !domLyricMode) {
      cCtx.textAlign = 'center'; cCtx.textBaseline = 'middle';
      st.walkerTextWidth = 0;
      if (st.currentLyricIndex !== -1) {
        const startTime = st.lyricsData[st.currentLyricIndex].time;
        const endTime = (st.lyricsData[st.currentLyricIndex + 1] ? st.lyricsData[st.currentLyricIndex + 1].time : startTime + 6);
        walkerProgress = Math.max(0, Math.min(1, (st.audioEl.currentTime - startTime) / (endTime - startTime)));
      }
      st.lyricsData.forEach((item, index) => {
        if (index < st.currentLyricIndex - 5) return;
        const isActive = index === st.currentLyricIndex, isDraggingThis = index === draggingLyricIndex;
        const pos = st.cachedLyricPositions[index];

        let targetPx = isActive ? w / 2 : pos.baseX * w, targetPy = isActive ? h / 2 : pos.baseY * h;
        let targetRot = isActive ? 0 : pos.baseRot, targetScale = isActive ? 1.0 : 0.6, targetAlpha = isActive ? 1.0 : 0.85;
        if (index < st.currentLyricIndex) {
          targetPx = pos.currX; targetPy = pos.currY; targetRot = pos.currRot; targetScale = 0; targetAlpha = 0;
        }
        if (isDraggingThis) { targetPx = pos.currX; targetPy = pos.currY; targetRot = 0; targetScale = 1.0; targetAlpha = 1.0; }

        if (!pos.isInit) {
          pos.currX = pos.baseX * w; pos.currY = pos.baseY * h;
          pos.currRot = pos.baseRot; pos.currScale = 0.6; pos.currAlpha = 0.85; pos.isInit = true;
        }

        const speed = isActive ? 0.28 : 0.15;
        pos.currX += (targetPx - pos.currX) * speed;
        pos.currY += (targetPy - pos.currY) * speed;
        let rotDiff = targetRot - pos.currRot;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        pos.currRot += rotDiff * speed;
        pos.currScale += (targetScale - pos.currScale) * speed;
        pos.currAlpha += (targetAlpha - pos.currAlpha) * speed;

        if (isActive && Math.hypot(pos.currX - w / 2, pos.currY - h / 2) < 60) st.isLyricSettled = true;

        /* 液态玻璃样式的歌词画在 contentCanvas 里，不是 #lyric-stage，
           所以整体推拉（--zoom-scale）对这里的字完全无效。把推拉量直接乘进字号，
           让玻璃里的字跟背景一起被节拍推大。 */
        const zoomSway = 1 + Math.max(0, currentZoom - 1) * 1.05;
        const fontSize = (isActive ? 48 * (w / 1920) : pos.size * (w / 1920)) * pos.currScale * (isActive ? 1.0 : (1.0 + bassSmooth * 0.15)) * zoomSway;
        cCtx.save();
        cCtx.translate(pos.currX, pos.currY);
        cCtx.rotate(pos.currRot);
        cCtx.globalAlpha = pos.currAlpha;

        if (isActive) {
          cCtx.font = `900 ${fontSize}px -apple-system, sans-serif`;
          cCtx.lineWidth = 4;
          cCtx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
          cCtx.strokeText(item.text, 0, 0);
          cCtx.fillStyle = 'rgba(255, 255, 255, 0.25)';
          cCtx.fillText(item.text, 0, 0);
          if (st.isLyricSettled) {
            st.walkerTextWidth = cCtx.measureText(item.text).width;
            const startX = -st.walkerTextWidth / 2;
            cCtx.save();
            cCtx.beginPath();
            cCtx.rect(startX, -fontSize, st.walkerTextWidth * walkerProgress, fontSize * 2);
            cCtx.clip();
            const grad = cCtx.createLinearGradient(-200, 0, 200, 0);
            grad.addColorStop(0, '#60a5fa');
            grad.addColorStop(0.5, '#c084fc');
            grad.addColorStop(1, '#f472b6');
            cCtx.fillStyle = grad;
            cCtx.shadowBlur = 20 * (w / 1920);
            cCtx.shadowColor = 'rgba(96, 165, 250, 0.9)';
            cCtx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            cCtx.strokeText(item.text, 0, 0);
            cCtx.fillText(item.text, 0, 0);
            cCtx.restore();
          }
        } else {
          cCtx.font = `700 ${fontSize}px -apple-system, sans-serif`;
          if (isDraggingThis) {
            cCtx.fillStyle = '#fff';
            cCtx.shadowBlur = 20;
            cCtx.shadowColor = 'rgba(255,255,255,0.8)';
          } else {
            cCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            cCtx.shadowBlur = 8;
            cCtx.shadowColor = 'rgba(0, 0, 0, 0.9)';
          }
          cCtx.fillText(item.text, 0, 0);
        }
        cCtx.restore();
      });
    }
  }

  /* ===== 渲染循环 ===== */
  let lastTime = performance.now();
  function render(time) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth * dpr, h = window.innerHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      contentCanvas.width = w; contentCanvas.height = h;
    }
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    const st = Player.state;

    drawContent(time);

    /* 节奏分析 → CSS 变量（背景流动）
       直链播放没有 AnalyserNode，退回离线包络表（audio-env.js 按 currentTime 取值） */
    if (!st.analyser && !st.paused && st.envelope && window.MJMJAudioEnv) {
      const env = window.MJMJAudioEnv.at(st.envelope, st.currentTime || 0);
      if (env) {
        bassSmooth += (env.bass - bassSmooth) * 0.35;
        energySmooth += (((env.bass * 0.5 + env.mid * 0.3 + env.treble * 0.2)) - energySmooth) * 0.30;
        const rs2 = document.documentElement.style;
        rs2.setProperty('--bass', bassSmooth.toFixed(3));
        rs2.setProperty('--mid', env.mid.toFixed(3));
        rs2.setProperty('--treble', env.treble.toFixed(3));
        rs2.setProperty('--energy', energySmooth.toFixed(3));
        st.bass = bassSmooth;
      }
    }
    if (st.analyser && !st.paused) {
      st.analyser.getByteFrequencyData(st.dataArray);
      const bins = st.dataArray;
      let bass = 0, mid = 0, treble = 0;
      for (let i = 0; i < 6; i++) bass += bins[i];
      for (let i = 6; i < 34; i++) mid += bins[i];
      for (let i = 34; i < 96; i++) treble += bins[i];
      bass = bass / 6 / 255;
      mid = mid / 28 / 255;
      treble = treble / 62 / 255;
      bassSmooth += (Math.pow(Math.min(bass, 1), 1.5) - bassSmooth) * 0.4;
      energySmooth += ((bass * 0.5 + mid * 0.3 + treble * 0.2) - energySmooth) * 0.35;
      hueOffset += (bass * 14 - hueOffset) * 0.1;
      px += (Math.random() - 0.5) * 3; py += (Math.random() - 0.5) * 3;
      px = Math.max(20, Math.min(80, px));
      py = Math.max(20, Math.min(80, py));
      const rs = document.documentElement.style;
      rs.setProperty('--bass', bassSmooth.toFixed(3));
      rs.setProperty('--mid', mid.toFixed(3));
      rs.setProperty('--treble', treble.toFixed(3));
      rs.setProperty('--energy', energySmooth.toFixed(3));
      rs.setProperty('--hue', Math.round(210 + hueOffset).toString());
      rs.setProperty('--px', px + '%');
      rs.setProperty('--py', py + '%');
      st.bass = bassSmooth;
    } else {
      bassSmooth += (0 - bassSmooth) * 0.1;
      energySmooth += (0 - energySmooth) * 0.05;
    }

    /* 玻璃物理（原版弹簧） */
    let targetCenterX = w / 2, targetCenterY = h / 2;
    let targetHX = (isKtvMode ? 80 : 180) * params.glassSize, targetHY = (isKtvMode ? 40 : 70) * params.glassSize;
    if (isKtvMode && st.isLyricSettled && st.walkerTextWidth > 0 && !isDragging && draggingLyricIndex === -1) {
      targetCenterX = w / 2 - st.walkerTextWidth / 2 + st.walkerTextWidth * walkerProgress;
      targetCenterY = h / 2;
    }

    pulseScale += (1.0 - pulseScale) * 8.0 * dt;
    currentHalfSize.x += (targetHX - currentHalfSize.x) * 5.0 * dt;
    currentHalfSize.y += (targetHY - currentHalfSize.y) * 5.0 * dt;

    if (!isDragging) {
      targetCenter.x = targetCenterX;
      targetCenter.y = targetCenterY;
    }

    const stiffness = 120.0, damping = 12.0;
    if (isDragging) {
      currentCenter.x += (targetCenter.x - currentCenter.x) * 0.5;
      currentCenter.y += (targetCenter.y - currentCenter.y) * 0.5;
      let speedX = Math.abs(mouseVel.x) * 0.015;
      let speedY = Math.abs(mouseVel.y) * 0.015;
      targetStretch.x = 1.0 + Math.min(speedX, 0.25);
      targetStretch.y = 1.0 + Math.min(speedY, 0.25);
      mouseVel.x *= 0.8;
      mouseVel.y *= 0.8;
    } else {
      let accX = (targetCenter.x - currentCenter.x) * stiffness - (currentCenter.x - prevCenter.x) * damping;
      let accY = (targetCenter.y - currentCenter.y) * stiffness - (currentCenter.y - prevCenter.y) * damping;
      currentCenter.x += (currentCenter.x - prevCenter.x) + accX * dt * dt;
      currentCenter.y += (currentCenter.y - prevCenter.y) + accY * dt * dt;
      let vx = Math.abs(currentCenter.x - prevCenter.x), vy = Math.abs(currentCenter.y - prevCenter.y);
      targetStretch.x = 1.0 + Math.min(vx * 0.015, 0.25);
      targetStretch.y = 1.0 + Math.min(vy * 0.015, 0.25);
    }

    currentCenter.x = Math.max(-currentHalfSize.x * dpr, Math.min(w + currentHalfSize.x * dpr, currentCenter.x));
    currentCenter.y = Math.max(-currentHalfSize.y * dpr, Math.min(h + currentHalfSize.y * dpr, currentCenter.y));
    prevCenter.x = currentCenter.x; prevCenter.y = currentCenter.y;

    currentStretch.x += (targetStretch.x - currentStretch.x) * 15.0 * dt;
    currentStretch.y += (targetStretch.y - currentStretch.y) * 15.0 * dt;

    let targetQScale = 1.0 + bassSmooth * 0.15;
    qScaleVelocity += ((targetQScale - currentQScale) * 300.0 - qScaleVelocity * 15.0) * dt;
    currentQScale += qScaleVelocity * dt;
    currentQScale = Math.max(0.7, Math.min(1.5, currentQScale));

    // 幅度本身也做低通，拖动滑条时不会因为 targetZoom 突变让画面闪
    zoomAmpSmooth += (params.zoomAmp - zoomAmpSmooth) * 8.0 * dt;
    // 推拉由「节拍脉冲」驱动，而不是低频能量的绝对值：bass 常驻高位时整画面会被长期放大、
    // 只看得到糊，看不到推和拉。脉冲每拍起跳、指数回落，缩放才是一次次推上去再退回来。
    const beat = (window.MJMJBeat && window.MJMJBeat.zoomPulse) || 0;
    if (isZoomEnabled && !st.paused) {
      targetZoom = 1.0 + Math.pow(beat, 1.0 / params.zoomSens) * zoomAmpSmooth * 0.5;
    } else { targetZoom = 1.0; }
    // 推上去要快（16/s），退回来要慢（9/s），这样才像镜头呼吸而不是橡皮筋
    const zoomRate = targetZoom > currentZoom ? 16.0 : 9.0;
    currentZoom += (targetZoom - currentZoom) * zoomRate * dt;
    currentZoom = Math.max(0.5, Math.min(3.0, currentZoom));
    // 节奏推拉作用在整个画面：玻璃折射、歌词层、CSS 背景层共用同一个已平滑的 currentZoom。
    // 这里写的是低通后的值（不是滑条 target），所以调大再调回是连续过渡，不会闪
    document.documentElement.style.setProperty('--zoom-scale', currentZoom.toFixed(4));

    /* 上传内容层 + 绘制 */
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, contentCanvas);
    gl.useProgram(program);
    gl.uniform2f(uniforms.res, canvas.width, canvas.height);
    gl.uniform2f(uniforms.texRes, bgTexW, bgTexH);
    gl.uniform1f(uniforms.hasTex, hasBgTex ? 1 : 0);
    gl.uniform2f(uniforms.center, currentCenter.x, currentCenter.y);
    gl.uniform2f(uniforms.stretch, currentStretch.x, currentStretch.y);
    gl.uniform1f(uniforms.qScale, currentQScale * pulseScale);
    gl.uniform1f(uniforms.bass, bassSmooth);
    gl.uniform1f(uniforms.height, params.height);
    gl.uniform1f(uniforms.blur, params.blur);
    gl.uniform1f(uniforms.strength, params.strength);
    gl.uniform1f(uniforms.chromatic, params.chromatic);
    gl.uniform1f(uniforms.zoom, currentZoom);
    gl.uniform1f(uniforms.hue, 210 + hueOffset);
    /* 玻璃体跟着推拉轻微胀缩（0.32 是刻意低于字号的系数：字要抢视觉，
       玻璃只做呼吸感，不然整块会盖住背景） */
    const bodySway = 1 + Math.max(0, currentZoom - 1) * 0.32;
    gl.uniform2f(uniforms.halfSize, currentHalfSize.x * dpr * pulseScale * bodySway, currentHalfSize.y * dpr * pulseScale * bodySway);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTexture);
    gl.uniform1i(uniforms.texBg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.uniform1i(uniforms.texContent, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  }

  /* ===== 进度/元数据 UI 订阅 ===== */
  function updateProgressUI() {
    const st = Player.state;
    if (!isDraggingProgress && st.duration) {
      progressFill.style.width = (st.audioEl.currentTime / st.duration * 100) + '%';
      currentTimeLabel.innerText = formatTime(st.audioEl.currentTime);
    }
    totalTimeLabel.innerText = formatTime(st.duration);
  }
  Player.onChange(updateProgressUI);

  /* ===== 折射源：用背景场景自己的配色生成纹理 =====
     canvas#c 是一块独立 WebGL，读不到它后面的 DOM（隐现 / 粒子都在别的 canvas 里），
     所以折射必须有张纹理喂进去。场景模式下这张纹理不能用默认底图 ——
     那就成了「玻璃里挂着别人的照片」。把当前场景的调色板画成柔和光斑，
     玻璃折射出来的颜色才和背后一致。 */
  function paintBgGradient(list, bg) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 288;
    const g = cv.getContext('2d');
    g.fillStyle = bg || '#05070d';
    g.fillRect(0, 0, 512, 288);
    const cols = (list && list.length) ? list : ['#1b2440', '#0a1020'];
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < cols.length; i++) {
      const x = 512 * (0.18 + 0.64 * (((i * 0.37) + 0.13) % 1));
      const y = 288 * (0.20 + 0.60 * (((i * 0.61) + 0.21) % 1));
      const r = 240 + (i % 3) * 86;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, cols[i]);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 512, 288);
    }
    g.globalCompositeOperation = 'source-over';
    return cv;
  }
  function bgFromColors(list, bg) { bgToken++; hasBgTex = false; uploadBg(paintBgGradient(list, bg)); }

  /* ===== 对外 API ===== */
  window.Liquid = {
    setBgFromUrl: bgFromUrl,
    setBgFromFile: bgFromFile,
    setBgFromColors: bgFromColors,
    clearBg,
    setKtv: (on) => { isKtvMode = on; pulseScale = 1.5; },
    get ktv() { return isKtvMode; },
    uploadBg,
  };

  /* 默认背景（原 base64 提取图）：只在真正用「默认」背景时才挂，
     否则会和 app.js 恢复出来的场景模式抢纹理（隐现 / 粒子模式下玻璃里不该有这张图） */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      /* bgToken 已被用掉 = 恢复流程已经指定过背景（自选图 / 封面 / 场景 clearBg），不要再抢 */
      if (bgToken === 0 && !document.body.dataset.foliaBg) bgFromUrl('/assets/default-bg.png');
    });
  } else if (bgToken === 0 && !document.body.dataset.foliaBg) {
    bgFromUrl('/assets/default-bg.png');
  }

  requestAnimationFrame(render);
})();
