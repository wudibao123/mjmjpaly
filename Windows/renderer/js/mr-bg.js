/* MJMJ · Mineradio 粒子背景（上游原文移植）
   -------------------------------------------------------------------------
   着色器：renderer/js/mr-particles-glsl.js —— 从
     XxHuberrr/Mineradio  public/js/modules/02-visual/00-pointer-cover-particles.js
     的模板字符串逐字符抽出（vs 第 376-977 行、fs 第 980-1008 行、
     bloomFs 第 1018-1043 行、backgroundStarRiverVs/Fs 第 1089-1144 行）
   几何与 uniforms：同上文件第 228-256 行（grid 粒子面片）、第 325-370 行（uniform 全表）
   预设 switch：同上文件第 506-853 行（23 个 preset 分支，嵌套在顶点着色器里）
   本文件只做三件上游之外的事：建 THREE 场景、把 --bass/--mid/--treble/--energy
   喂进 uniform、以及按 preset 号切换。画面本身没有一行是我编的。
   ------------------------------------------------------------------------- */
(function () {
  var GLSL = window.MJMJMrGLSL;
  if (!GLSL || !window.THREE) {
    console.warn('[mr-bg] 缺少上游着色器或 THREE');
    return;
  }

  var PLANE_SIZE = (window.MJMJMrConst && window.MJMJMrConst.PLANE_SIZE) || 4.8;
  var GRID = 128;                     // 上游 grid 由 coverResolution 换算，这里取同量级
  var HOST_ID = 'mr-canvas-wrap';
  /* 上游 01-scene/00-renderer-quality.js：RENDER_DPR_CAP = 1.35 */
  var RENDER_DPR_CAP = 1.35;
  /* 上游 01-scene/01-orbit-free-camera.js defaultOrbitStateForPreset 的 baseline
     （theta / phi / radius，单位弧度与世界单位），相机焦点始终是原点 */
  var PRESET_ORBIT = {
    0: { theta: 0.0, phi: 0.08, radius: 6.6 },
    1: { theta: 0.0, phi: 0.03, radius: 6.2 },
    2: { theta: 0.0, phi: 0.15, radius: 7.0 },
    3: { theta: 0.0, phi: 0.05, radius: 8.0 },
    4: { theta: 0.0, phi: 0.04, radius: 6.5 },
    5: { theta: 0.0, phi: 0.08, radius: 6.6 },
    6: { theta: 0.18, phi: 0.10, radius: 7.4 },
    /* 7/8 号音域回响：上游 SONIC_ORBIT_BASELINE = { theta: 0, phi: 0.18, radius: 8.4 } */
    7: { theta: 0.0, phi: 0.18, radius: 8.4 },
    8: { theta: 0.0, phi: 0.18, radius: 8.4 },
    9: { theta: -0.08, phi: 0.12, radius: 7.4 },
    10: { theta: 0.0, phi: 0.02, radius: 7.15 },
    11: { theta: 0.10, phi: 0.11, radius: 7.0 },
    12: { theta: -0.12, phi: 0.18, radius: 7.35 }
  };

  /* 上游 00-state/04-fx-defaults.js 的官方默认视觉快照里与粒子相关的字段 */
  var FX = {
    intensity: 0.85,
    depth: 0.2,
    point: 1.0,
    speed: 1.0,
    twist: 0.0,
    color: 1.10,
    scatter: 0.0,
    bgFade: 0.20,
    bloom: false,
    bloomStrength: 0.62,
    edge: false,
    coverResolution: 1.55
  };
  var PARAM_KEY = 'mjmj.mr.param';
  var PARAMS = { intensity: FX.intensity, point: FX.point, speed: FX.speed, scatter: FX.scatter, bloom: FX.bloomStrength };

  try {
    var saved = JSON.parse(localStorage.getItem(PARAM_KEY) || '{}') || {};
    Object.keys(PARAMS).forEach(function (k) {
      var v = Number(saved[k]);
      if (isFinite(v)) PARAMS[k] = v;
    });
  } catch (e) { /* 本地存档坏了就退回上游默认 */ }

  var renderer, scene, camera, geo, material, bloomMaterial, particles, bloomParticles;
  var uniforms, running = false, booted = false;
  var lastT = 0, timeAcc = 0, beatPulse = 0, burst = 0, prevEnergy = 0;
  var currentPreset = 0;
  var activePreset = -1;

  /* 上游第 228-256 行的粒子网格几何：position / aUv / aRand */
  function buildCoverParticleGeometry(grid) {
    var count = grid * grid;
    var nextGeo = new THREE.BufferGeometry();
    var nextPositions = new Float32Array(count * 3);
    var nextUvs = new Float32Array(count * 2);
    var nextRand = new Float32Array(count);
    var texelStep = 1 / grid;
    for (var i = 0; i < count; i++) {
      var gx = i % grid, gy = Math.floor(i / grid);
      var u = (gx + 0.5) * texelStep, v = (gy + 0.5) * texelStep;
      var px = gx / (grid - 1), py = gy / (grid - 1);
      nextPositions[i * 3] = (px - 0.5) * PLANE_SIZE;
      nextPositions[i * 3 + 1] = (py - 0.5) * PLANE_SIZE;
      nextPositions[i * 3 + 2] = 0;
      nextUvs[i * 2] = u;
      nextUvs[i * 2 + 1] = v;
      nextRand[i] = Math.random();
    }
    nextGeo.setAttribute('position', new THREE.BufferAttribute(nextPositions, 3));
    nextGeo.setAttribute('aUv', new THREE.BufferAttribute(nextUvs, 2));
    nextGeo.setAttribute('aRand', new THREE.BufferAttribute(nextRand, 1));
    nextGeo.userData.grid = grid;
    nextGeo.userData.count = count;
    return nextGeo;
  }

  /* 圆点笔刷：上游 uDotTex 的径向衰减（同等形状，尺寸小） */
  function makeDotTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.72)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    var t = new THREE.Texture(c);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  function makeSolidTexture(hex) {
    var c = document.createElement('canvas');
    c.width = c.height = 4;
    var x = c.getContext('2d');
    x.fillStyle = hex || '#1c1c28';
    x.fillRect(0, 0, 4, 4);
    var t = new THREE.Texture(c);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  /* 上游第 325-370 行的 uniform 全表（键名与着色器声明一一对应，缺一个都会编译失败） */
  function buildUniforms() {
    var coverTex = makeSolidTexture('#1c1c28');
    var edgeTex = makeSolidTexture('rgba(128,0,0,255)');
    var prevCoverTex = makeSolidTexture('#1c1c28');
    var rippleTex = makeSolidTexture('rgba(0,0,0,255)');
    return {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uBeat: { value: 0 },
      uEnergy: { value: 0 },
      uBurstAmt: { value: 0 },
      uVinylSpin: { value: 0 },
      /* 以下数值照抄上游 00-state/04-fx-defaults.js 的官方默认快照 */
      uPreset: { value: 0 },
      uIntensity: { value: FX.intensity },
      uDepth: { value: FX.depth },
      uPointScale: { value: FX.point },
      uSpeed: { value: FX.speed },
      uTwist: { value: FX.twist },
      uColorBoost: { value: FX.color },
      uScatter: { value: FX.scatter },
      uCoverRes: { value: FX.coverResolution },
      uBgFade: { value: FX.bgFade },
      uBloomStrength: { value: FX.bloom ? FX.bloomStrength : 0 },
      uBloomSize: { value: 2.65 },
      uTintColor: { value: new THREE.Color('#9db8cf') },
      uTintStrength: { value: 0 },
      uCoverTex: { value: coverTex },
      uPrevCoverTex: { value: prevCoverTex },
      uColorMixT: { value: 1.0 },
      uEdgeTex: { value: edgeTex },
      uRippleTex: { value: rippleTex },
      uRippleCount: { value: 0 },
      uDotTex: { value: makeDotTexture() },
      uHasCover: { value: 0 },
      uHasDepth: { value: 0 },
      uEdgeEnabled: { value: 1 },
      uAiBoost: { value: 0 },
      uMouseXY: { value: new THREE.Vector2(-999, -999) },
      uMouseActive: { value: 0 },
      uHandXY: { value: new THREE.Vector2(-999, -999) },
      uHandActive: { value: 0 },
      uGestureGrip: { value: 0 },
      uPixel: { value: 1 },
      uAlpha: { value: 0 },
      uParticleDim: { value: 1 },
      uBackdropAdapt: { value: 0.72 },
      uFloatAlpha: { value: 0 },
      uLoading: { value: 0 }
    };
  }

  function boot() {
    var host = document.getElementById(HOST_ID);
    if (!host) return false;
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'high-performance', premultipliedAlpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER_DPR_CAP));
    renderer.setSize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, (host.clientWidth || window.innerWidth) / (host.clientHeight || window.innerHeight), 0.1, 100);
    applyPresetCamera(activePreset < 0 ? 0 : activePreset);
    scene.add(camera);

    uniforms = buildUniforms();
    uniforms.uPixel.value = renderer.getPixelRatio();
    applyParams();

    geo = buildCoverParticleGeometry(GRID);

    material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: GLSL.vs,
      fragmentShader: GLSL.fs,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    /* 上游第 1015-1017 行：bloom 复用 vs，只替换两处声明与点径 */
    var bloomVs = GLSL.vs
      .replace('uniform float uMouseActive, uPixel, uColorMixT, uLoading;', 'uniform float uMouseActive, uPixel, uColorMixT, uLoading, uBloomSize;')
      .replace('gl_PointSize = sz * uPixel * uPointScale;', 'gl_PointSize = sz * uPixel * uPointScale * uBloomSize;');
    bloomMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: bloomVs,
      fragmentShader: GLSL.bloomFs,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });

    bloomParticles = new THREE.Points(geo, bloomMaterial);
    bloomParticles.frustumCulled = false;
    bloomParticles.renderOrder = 0;
    bloomParticles.visible = !!(PARAMS.bloom > 0.01);
    scene.add(bloomParticles);

    particles = new THREE.Points(geo, material);
    particles.frustumCulled = false;
    particles.renderOrder = 1;
    scene.add(particles);

    window.addEventListener('resize', onResize);
    booted = true;
    return true;
  }

  function applyPresetCamera(n) {
    if (!camera) return;
    var b = PRESET_ORBIT[n] || PRESET_ORBIT[0];
    camera.position.set(
      b.radius * Math.cos(b.phi) * Math.sin(b.theta),
      b.radius * Math.sin(b.phi),
      b.radius * Math.cos(b.phi) * Math.cos(b.theta)
    );
    camera.lookAt(0, 0, 0);
  }

  function onResize() {
    if (!renderer) return;
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    var w = host.clientWidth || window.innerWidth;
    var h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    uniforms.uPixel.value = renderer.getPixelRatio();
  }

  function readBands() {
    var cs = getComputedStyle(document.documentElement);
    var bass = parseFloat(cs.getPropertyValue('--bass')) || 0;
    var mid = parseFloat(cs.getPropertyValue('--mid')) || 0;
    var treble = parseFloat(cs.getPropertyValue('--treble')) || 0;
    var energy = parseFloat(cs.getPropertyValue('--energy')) || 0;
    return { bass: bass, mid: mid, treble: treble, energy: energy };
  }

  /* 音频控制逻辑：与面板「背景跟随节奏流动」开关联动，关掉就不喂频谱；
     播放暂停时全部包络归零，只留时间轴自转（同上游暂停态的处理） */
  function rhythmEnabled() {
    var el = document.getElementById('s-rhythm');
    return el ? !!el.checked : true;
  }

  /* 音频驱动：照上游 11-main-loop.js 483-582 行
     频段包络 → 攻击/释放包络 → 基础输出 → 预设 >= 4 的 ring 重采样与封顶 */
  var SMOOTH = { bass: 0, mid: 0, treble: 0, energy: 0 };
  function envLerp(prev, next, attack, release) {
    var k = next > prev ? attack : release;
    return prev + (next - prev) * k;
  }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function pushBands(dt) {
    var raw = rhythmEnabled() ? readBands() : { bass: 0, mid: 0, treble: 0, energy: 0 };
    var step = Math.max(0.001, dt || 0.016);
    var inten = PARAMS.intensity;
    /* 上游 smoothBass/Mid/Treb/Energy 的攻击与释放系数 */
    SMOOTH.bass = envLerp(SMOOTH.bass, Math.min(0.82, raw.bass * 0.78 + raw.energy * 0.025), 0.28, 0.075);
    SMOOTH.mid = envLerp(SMOOTH.mid, Math.min(0.68, raw.mid * 0.64 + raw.energy * 0.025), 0.18, 0.060);
    SMOOTH.treble = envLerp(SMOOTH.treble, Math.min(0.56, raw.treble * 0.54), 0.18, 0.055);
    SMOOTH.energy = envLerp(SMOOTH.energy, Math.min(0.72, raw.energy), 0.16, 0.055);
    /* beatPulse：上游 bassOnset 兜底分支 + pow(0.36, dt) 衰减 */
    var onset = Math.max(0, raw.energy - prevEnergy);
    prevEnergy = raw.energy;
    beatPulse = Math.max(beatPulse * Math.pow(0.36, step), Math.min(0.12, onset * 0.18));
    /* 基础输出 */
    var bass = Math.min(0.90, SMOOTH.bass * 1.05 + beatPulse * 0.18) * inten;
    var mid = Math.min(0.72, SMOOTH.mid * 1.12) * inten;
    var treble = Math.min(0.62, SMOOTH.treble * 1.20) * inten;
    /* 预设 >= 4 的分段增益：5 号星河、9-12 号作者粒子、其余走通用 ring */
    if (currentPreset >= 4) {
      var wallpaperAudio = currentPreset === 5;
      var authoredParticles = currentPreset >= 9 && currentPreset <= 12;
      var ringBassGain = wallpaperAudio ? 1.10 : (authoredParticles ? 1.32 : 1.58);
      var ringMidGain = wallpaperAudio ? 1.16 : (authoredParticles ? 1.48 : 1.82);
      var ringTrebleGain = wallpaperAudio ? 1.34 : (authoredParticles ? 1.72 : 2.28);
      var ringBeatGain = wallpaperAudio ? 0.18 : (authoredParticles ? 0.31 : 0.42);
      var ringBass = SMOOTH.bass * ringBassGain + beatPulse * ringBeatGain - SMOOTH.mid * 0.16 - SMOOTH.treble * 0.06;
      var ringMid = SMOOTH.mid * ringMidGain - SMOOTH.bass * 0.14 - SMOOTH.treble * 0.07;
      var ringTreble = SMOOTH.treble * ringTrebleGain - SMOOTH.mid * 0.10 - SMOOTH.bass * 0.05;
      bass = Math.pow(clamp01((ringBass - 0.050) / 0.58), 0.72) * inten;
      mid = Math.pow(clamp01((ringMid - 0.045) / 0.46), 0.78) * inten;
      treble = Math.pow(clamp01((ringTreble - 0.030) / 0.34), 0.84) * inten;
      if (wallpaperAudio) {
        bass = Math.min(bass, 0.46 * inten);
        mid = Math.min(mid, 0.40 * inten);
        treble = Math.min(treble, 0.36 * inten);
        beatPulse *= 0.34;
      } else if (authoredParticles) {
        bass = Math.min(bass, 0.72 * inten);
        mid = Math.min(mid, 0.62 * inten);
        treble = Math.min(treble, 0.58 * inten);
        beatPulse *= 0.72;
      }
    }
    uniforms.uBass.value = bass;
    uniforms.uMid.value = mid;
    uniforms.uTreble.value = treble;
    uniforms.uBeat.value = beatPulse;
    uniforms.uEnergy.value = Math.max(SMOOTH.energy, beatPulse * 0.30);
    burst *= 0.93;
    uniforms.uBurstAmt.value = burst;
    var paused = !!(window.Player && window.Player.state && window.Player.state.paused);
    /* 唱针转速同上游 (0.40 + smoothBass*0.09) * speed */
    uniforms.uVinylSpin.value = (uniforms.uVinylSpin.value + step * (0.40 + SMOOTH.bass * 0.09) * Math.max(0.05, PARAMS.speed) * (paused ? 0.35 : 1)) % (Math.PI * 2);
    uniforms.uSpeed.value = PARAMS.speed * (paused ? 0.35 : 1);
  }

  /* 7/8 号「音域回响」是上游完整的独立 THREE 场景（不是粒子着色器分支），
     直接调它自己的 update，音频按 Mineradio 的简化字段喂进去由它派生。 */
  var sonicPrevPreset = 0;
  function syncSonic(dt) {
    var ctxAudio = {
      bass: uniforms.uBass.value,
      mid: uniforms.uMid.value,
      treble: uniforms.uTreble.value,
      beat: uniforms.uBeat.value,
      energy: uniforms.uEnergy.value
    };
    var ctx = { fx: { preset: currentPreset }, scene: scene, audio: ctxAudio, time: timeAcc };
    if (window.MineradioSonicTopography && MineradioSonicTopography.update) MineradioSonicTopography.update(dt, ctx);
    if (window.MineradioSonicWorkshop && MineradioSonicWorkshop.update) MineradioSonicWorkshop.update(dt, ctx);
    if (sonicPrevPreset !== currentPreset) {
      if (window.MineradioSonicTopography && MineradioSonicTopography.onPresetChange) {
        MineradioSonicTopography.onPresetChange(sonicPrevPreset, currentPreset, { scene: scene, fx: { preset: currentPreset } });
      }
      if (window.MineradioSonicWorkshop && MineradioSonicWorkshop.onPresetChange) {
        MineradioSonicWorkshop.onPresetChange(sonicPrevPreset, currentPreset, { scene: scene, fx: { preset: currentPreset } });
      }
      sonicPrevPreset = currentPreset;
    }
  }

  function applyParams() {
    if (!uniforms) return;
    uniforms.uIntensity.value = PARAMS.intensity;
    uniforms.uPointScale.value = PARAMS.point;
    uniforms.uScatter.value = PARAMS.scatter;
    uniforms.uBloomStrength.value = PARAMS.bloom;
    if (bloomParticles) bloomParticles.visible = PARAMS.bloom > 0.01;
  }

  function setParam(name, value) {
    if (!(name in PARAMS)) return;
    var v = Number(value);
    if (!isFinite(v)) return;
    PARAMS[name] = v;
    try { localStorage.setItem(PARAM_KEY, JSON.stringify(PARAMS)); } catch (e) {}
    applyParams();
  }

  function frame(t) {
    if (!running) return;
    if (!lastT) lastT = t;
    var dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    timeAcc += dt;
    uniforms.uTime.value = timeAcc;
    pushBands(dt);
    syncSonic(dt);
    /* 出场淡入与上游 uAlpha 一致 */
    uniforms.uAlpha.value += (1 - uniforms.uAlpha.value) * 0.08;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function start() {
    if (!booted && !boot()) return;
    var host = document.getElementById(HOST_ID);
    if (host) host.classList.add('on');
    if (running) return;
    running = true;
    lastT = 0;
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    var host = document.getElementById(HOST_ID);
    if (host) host.classList.remove('on');
  }

  function setPreset(index) {
    if (!uniforms) return;
    var n = Number(index);
    if (!isFinite(n)) return;
    if (activePreset === n) return;
    activePreset = n;
    uniforms.uPreset.value = n;
    currentPreset = n;
    applyPresetCamera(n);
    burst = Math.max(burst, 0.18);   // 上游切预设的通用脉冲
    uniforms.uAlpha.value = 0;
    if (n === 3) {
      /* Preset 3 = VOID：上游明确「无粒子，适合自定义背景」 */
      uniforms.uParticleDim.value = 0;
    } else {
      uniforms.uParticleDim.value = 1;
    }
  }

  function wantedPreset() {
    var v = document.body && document.body.dataset ? document.body.dataset.foliaBg : '';
    if (!v) return null;
    var m = /^mrp([0-9]+)$/.exec(v);
    if (!m) return null;
    return Number(m[1]);
  }

  function sync() {
    var p = wantedPreset();
    if (p === null) {
      if (running) stop();
      return;
    }
    setPreset(p);
    start();
  }

  var mo = new MutationObserver(sync);
  mo.observe(document.body, { attributes: true, attributeFilter: ['data-folia-bg'] });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync);
  else sync();

  window.MJMJMrBg = { start: start, stop: stop, sync: sync, setPreset: setPreset, setParam: setParam };
})();
