/* MJMJ · 播放核心：音源队列 / 循环模式 / 歌词解析 / 状态暴露给液态玻璃渲染循环 */
(function () {
  'use strict';

  const audioEl = new Audio();
  audioEl.loop = false;
  audioEl.preload = 'auto';
  // 音频对象不在 DOM 里（new Audio），暴露一个只读引用给主进程探针 /cli/audio 读取起播状态
  try { window.__mjmjAudio = audioEl; } catch (e) {}

  const state = {
    audioEl,
    analyser: null,
    envelope: null,      // 离线频谱包络 {rate, frames, bass, mid, treble}
    envelopeKey: '',
    dataArray: new Uint8Array(256),
    paused: true,
    duration: 0,
    currentTime: 0,
    currentTrack: null,
    bass: 0, mid: 0, treble: 0, energy: 0,
    lyricsData: [],
    cachedLyricPositions: [],
    currentLyricIndex: -1,
    isLyricSettled: false,
    walkerTextWidth: 0,
  };

  let queue = [];
  let qIndex = -1;
  let loopMode = 'list'; // list | one | random
  let mediaFallback = null; // 当前歌曲的取流备选链
  const listeners = [];

  function onChange() { listeners.forEach((fn) => { try { fn(state); } catch (e) {} }); }

  let audioCtx = null;

  /**
   * 建 WebAudio 分析链。关键：AudioContext 只有 running 时才允许接管音频元素——
   * suspended 下 createMediaElementSource 会把声音全吞掉（=「有歌词没声音、频谱不动、也不报音源失败」）。
   * 所以先 resume，resume 不动就先不接管，让音频直接出声，等用户手势后再接管拿频谱。
   */
  async function ensureAudio() {
    // 直链（跨域）绝不接管：createMediaElementSource 一接上就静音，进度却照走。
    // 只有明确同源的 /proxy 源才允许建分析链；直链模式下宁可没有频谱。
    if (String(audioEl.currentSrc || audioEl.src).indexOf('/proxy') < 0) return false;
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state !== 'running') {
      try { await audioCtx.resume(); } catch (e) {}
    }
    if (audioCtx.state !== 'running') return false;
    if (state.analyser) return true;
    try {
      const src = audioCtx.createMediaElementSource(audioEl);
      const an = audioCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      an.connect(audioCtx.destination);
      state.analyser = an;
      state.dataArray = new Uint8Array(an.frequencyBinCount);
    } catch (e) { console.warn('web audio chain failed', e); return false; }
    return true;
  }

  // 音频输出走 WebAudio(analyser→destination)，AudioContext 一旦 suspended 就会「有播放进度但没声音、频谱不动」
  async function resumeCtx() {
    try {
      await ensureAudio();
      if (audioCtx && audioCtx.state !== 'running') await audioCtx.resume();
    } catch (e) { console.warn('resume audio ctx failed', e); }
  }

  // 任意用户手势都补一次 resume（手机 WebView 对自动播放更严格）
  ['pointerdown', 'keydown', 'touchstart', 'click'].forEach(function (ev) {
    document.addEventListener(ev, function () { resumeCtx(); }, { passive: true });
  });

  // 播放过程中每分钟检查一次，ctx 被系统挂起就立刻拉回来，避免「看着在放却没声」
  setInterval(function () {
    if (state.analyser && audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
  }, 1000);

  /* ================= 逐字歌词（yrc） =================
     yrc 行格式：[行起始ms,行时长ms](字起始ms,字时长ms,0)字…(…)字…
     每个字自带绝对起止时间，卡拉OK进度就按这个算，不做任何均分。
     这就是 Folia 那种“周杰伦念白慢、高亮也跟着慢”的数据来源。 */
  function parseYrcLines(text) {
    const out = [];
    (text || '').replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line) => {
      const m = /^\[(\d+),(\d+)\](.*)$/.exec(line);
      if (!m) return;
      const start = parseInt(m[1], 10) / 1000;
      const dur = parseInt(m[2], 10) / 1000;
      const words = [];
      const re = /\((\d+),(\d+),(\d+)\)([^(]*)/g;
      let w;
      while ((w = re.exec(m[3])) !== null) {
        const ws = parseInt(w[1], 10) / 1000;
        const wd = parseInt(w[2], 10) / 1000;
        const wt = w[4];
        if (!wt) continue;
        words.push({ text: wt, start: ws, end: ws + wd });
      }
      if (!words.length) return;
      out.push({
        time: start,
        end: start + dur,
        text: words.map(function (x) { return x.text; }).join(''),
        tr: '',
        words: words,
      });
    });
    return out;
  }

  /* 间奏“准备唱”点阵：照抄 Folia src/utils/lyrics/parserCore.ts 的 attachInterludes。
     正文 '......' 六个点，每个点各带 start/end（整段时长均分），所以点是逐点点亮的，
     不是一张静态图片。规则：
       首行前间隔 > 3s → 补一段 0.5 → (首行 - 0.5)
       相邻两行间隔 > 3s → 插 (当前行结束 + 0.05) → (下一行开始 - 0.05) */
  const INTERLUDE_TEXT = '......';

  function lineEnd(line) {
    if (line.words && line.words.length) return line.words[line.words.length - 1].end;
    if (typeof line.end === 'number') return line.end;
    return line.time;
  }

  // 只有行级 lrc 的行没有结束时间，按字数给一个保守时长，仅用于算“间奏间隙”，不参与逐字高亮
  function estimateLrcEnd(line, next) {
    const body = (line.text || '').replace(/\s/g, '');
    const est = Math.max(1.2, body.length * 0.28);
    const cap = next ? Math.max(est, next.time - line.time - 0.05) : est;
    return line.time + Math.min(est, cap);
  }

  function attachInterludes(lines) {
    if (!lines || !lines.length) return lines;
    const out = [];
    const makeInterlude = function (start, end) {
      const dur = Math.max(0.2, end - start);
      const step = dur / 6;
      const words = [];
      for (let i = 0; i < 6; i++) {
        words.push({ text: '.', start: start + i * step, end: start + (i + 1) * step });
      }
      return { time: start, end: end, text: INTERLUDE_TEXT, tr: '', words: words };
    };
    if (lines[0].time > 3) out.push(makeInterlude(0.5, lines[0].time - 0.5));
    for (let i = 0; i < lines.length; i++) {
      out.push(lines[i]);
      const next = lines[i + 1];
      if (!next) continue;
      const cur = lines[i];
      const curEnd = (cur.words && cur.words.length) ? lineEnd(cur) : estimateLrcEnd(cur, next);
      if (next.time - curEnd > 3) out.push(makeInterlude(curEnd + 0.05, next.time - 0.05));
    }
    return out;
  }

  /* 译文时间轴：同时认 yrc 的 [起始ms,时长ms] 和普通 lrc 的 [mm:ss.xx] */
  function parseTimedText(text) {
    const out = [];
    (text || '').replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line) => {
      const y = /^\[(\d+),(\d+)\](.*)$/.exec(line);
      if (y) {
        const body = y[3].replace(/\(\d+,\d+,\d+\)/g, '').trim();
        if (body) out.push({ time: parseInt(y[1], 10) / 1000, text: body });
        return;
      }
      const l = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/.exec(line);
      if (l) {
        const body = l[4].trim();
        if (body) {
          out.push({
            time: parseInt(l[1], 10) * 60 + parseInt(l[2], 10) +
              (l[3].length === 2 ? parseInt(l[3], 10) * 10 : parseInt(l[3], 10)) / 1000,
            text: body,
          });
        }
      }
    });
    return out;
  }

  function attachTranslation(lines, trText) {
    const trs = parseTimedText(trText);
    if (!trs.length) return lines;
    lines.forEach(function (line) {
      for (let i = 0; i < trs.length; i++) {
        if (Math.abs(trs[i].time - line.time) < 0.12) { line.tr = trs[i].text; break; }
      }
    });
    return lines;
  }

  function parseLyric(raw) {
    // raw 可以是 {yrc,lrc,tr,ytr}（新逐字接口），也可以是纯 lrc 字符串（兜底）
    const pack = (typeof raw === 'string') ? { yrc: '', lrc: raw, tr: '', ytr: '' } : (raw || {});
    if (pack.yrc) {
      const ylines = parseYrcLines(pack.yrc);
      if (ylines.length) {
        attachTranslation(ylines, pack.ytr || pack.tr);
        return attachInterludes(ylines);
      }
    }
    const lines = (pack.lrc || '').split('\n');
    const rows = [];
    const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    lines.forEach((line) => {
      const match = timeReg.exec(line);
      if (match) {
        const time = parseInt(match[1]) * 60 + parseInt(match[2]) +
          (match[3].length === 2 ? parseInt(match[3]) * 10 : parseInt(match[3])) / 1000;
        const text = match[4].trim();
        if (text) rows.push({ time, text });
      }
    });
    rows.sort((a, b) => a.time - b.time);

    // 网易云的翻译歌词有时会被并进主 lrc：同一时间戳出现两条（原文 + 译文），
    // 或者译文紧跟在原文后面一点点。以前不做归并，译文就被当成一句歌自己唱了一整遍。
    const isCJK = (s) => /[\u4e00-\u9fa5]/.test(s);
    const isLatin = (s) => /[A-Za-z]/.test(s) && !isCJK(s);
    const out = [];
    rows.forEach((row) => {
      const last = out[out.length - 1];
      if (last) {
        // 1) 时间戳几乎相同：视为同一句的译文
        if (Math.abs(row.time - last.time) < 0.09) {
          if (!last.tr && row.text !== last.text) last.tr = row.text;
          return;
        }
        // 2) 英文句后紧跟一句中文，且间隔很短：判为译文
        if (!last.tr && isLatin(last.text) && isCJK(row.text) && (row.time - last.time) < 1.2) {
          last.tr = row.text;
          return;
        }
      }
      out.push({ time: row.time, text: row.text, tr: '' });
    });
    attachTranslation(out, pack.tr);
    return attachInterludes(out);
  }

  function buildPositions(lyrics) {
    return lyrics.map(() => ({
      baseX: 0.1 + Math.random() * 0.8,
      baseY: 0.12 + Math.random() * 0.76,
      baseRot: (-20 + Math.random() * 40) * Math.PI / 180,
      size: 14 + Math.random() * 16,
      currX: 0, currY: 0, currRot: 0, currScale: 0.6, currAlpha: 0.85, isInit: false,
    }));
  }

  async function loadLyric(id) {
    state.lyricsData = [];
    state.cachedLyricPositions = [];
    state.currentLyricIndex = -1;
    try {
      const raw = await NCM.lyric(id);
      // 切歌时旧请求可能晚回来，别把上一首的歌词盖到当前这首上
      if (String((state.currentTrack && state.currentTrack.id) || '') !== String(id)) return;
      if (raw) {
        state.lyricsData = parseLyric(raw);
        state.cachedLyricPositions = buildPositions(state.lyricsData);
      }
    } catch (e) { console.warn('lyric failed', e); }
  }

  let sourceWatchdog = null;
  let waitTimer = null;

  function mediaSkip() {
    if (state._skipGuard) return;
    state._skipGuard = true;
    toast('音源失效，自动跳过');
    const n = qIndex >= queue.length - 1 ? 0 : qIndex + 1;
    playAt(n, true).finally(() => { state._skipGuard = false; });
  }

  /**
   * 换到备选链里的第 idx 个音源。
   * 三条硬规则：
   * 1. 设完 src 立刻 play（以前先 await 歌词再 play，中间几百毫秒到几秒不等，
   *    表现就是「歌词出来了、进度条不动」）；
   * 2. 3.2 秒内读不出音频数据（readyState < 2）就主动换下一个源，
   *    不能傻等——代理或上游卡住时 audio 不会报 error，只会一直 pending；
   * 3. 全部源都失败才提示并跳过，保证任何失败都有声音以外的东西告诉用户。
   */
  function applySource(idx, autoplay) {
    if (!mediaFallback) return;
    mediaFallback.idx = idx;
    const u = mediaFallback.chain[idx];
    clearTimeout(sourceWatchdog);
    audioEl.src = u;
    audioEl.load();
    if (autoplay) {
      audioEl.play().catch((e) => {
        console.warn('play blocked:', (e && e.name) || e, String(u).slice(0, 90));
        toast('播放没有启动：' + ((e && e.name) || '未知原因'));
      });
    }
    sourceWatchdog = setTimeout(() => {
      if (!mediaFallback || mediaFallback.idx !== idx) return;
      if (audioEl.readyState >= 2 || audioEl.currentTime > 0) return;
      console.warn('source #' + idx + ' 3.2s 未就绪 readyState=' + audioEl.readyState);
      if (idx < mediaFallback.chain.length - 1) applySource(idx + 1, autoplay);
      else toast('音源加载失败，再点一次播放重试');
    }, 3200);
  }

  let loadSeq = 0;

  async function loadTrack(track, autoplay = true) {
    // 同一时刻只让最后一次点播生效：启动恢复播放、命令行点歌、列表点击会并发取源，
    // 旧请求晚回来会把刚设好的音源覆盖掉，表现就是「播两秒进度归零」或莫名跳歌。
    const seq = ++loadSeq;
    state.currentTrack = track;
    onChange();
    try {
      const url = await NCM.songUrl(track.id);
      if (seq !== loadSeq) return false;
      if (!url) { toast('该歌曲暂无可用音源（可能需要 VIP）'); return false; }
      // 直链播放（用户要求：不走代理）：CDN 直链 http 先试、https 兜底。
      // 跨域直链下绝不接 WebAudio——createMediaElementSource 一接管就是「有进度、没声音」。
      mediaFallback = {
        chain: [url, url.replace(/^http:\/\//i, 'https://')],
        idx: 0,
        active: true,
      };
      audioEl.onerror = null;
      applySource(0, autoplay);
      loadLyric(track.id);   // 歌词并行取，不挡播放
      // 直链拿不到 AnalyserNode，这里离线解一遍音源算频谱包络，供背景着色器驱动
      if (window.MJMJAudioEnv) {
        state.envelope = null;
        MJMJAudioEnv.analyzeTrack(track, url);
      }
      return true;
    } catch (e) {
      console.error('load track failed', e);
      toast('播放失败：' + (e.message || e));
      return false;
    }
  }

  function currentIndex() {
    if (!queue.length) return -1;
    if (qIndex >= 0 && qIndex < queue.length) return qIndex;
    return 0;
  }

  async function playAt(idx, autoplay = true) {
    if (!queue.length) return;
    qIndex = ((idx % queue.length) + queue.length) % queue.length;
    await loadTrack(queue[qIndex], autoplay);
  }

  async function playQueue(tracks, start = 0) {
    queue = tracks;
    await playAt(start, true);
  }

  function nextIndex(auto) {
    if (loopMode === 'random') {
      if (queue.length < 2) return qIndex;
      let n = qIndex;
      while (n === qIndex) n = Math.floor(Math.random() * queue.length);
      return n;
    }
    if (qIndex >= queue.length - 1) return auto && loopMode === 'list' ? 0 : qIndex;
    return qIndex + 1;
  }

  function prevIndex() {
    if (qIndex <= 0) return queue.length - 1;
    return qIndex - 1;
  }

  async function next(auto = false) {
    const n = nextIndex(auto);
    if (n === qIndex) return;
    await playAt(n, true);
  }

  async function prev() {
    if (state.currentTime > 3) { audioEl.currentTime = 0; return; }
    await playAt(prevIndex(), true);
  }

  async function toggle() {
    if (audioEl.paused) {
      // 直链一律不接 WebAudio（跨域接管必静音），直接出声
      try { await audioEl.play(); } catch (e) { console.warn('play blocked', e && e.name); }
    } else {
      audioEl.pause();
    }
  }

  function seekTo(t) {
    if (isNaN(t)) return;
    audioEl.currentTime = Math.max(0, Math.min(t, state.duration || t));
  }

  /* ===== 进度条（底部导航栏上方） ===== */
  const progressWrapper = document.getElementById('progressWrapper');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const currentTimeLabel = document.getElementById('currentTimeLabel');
  const totalTimeLabel = document.getElementById('totalTimeLabel');

  function fmtTime(sec) {
    if (isNaN(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function updateProgressUI() {
    const d = state.duration || 0;
    const t = Math.max(0, state.currentTime || 0);
    if (currentTimeLabel) currentTimeLabel.textContent = fmtTime(t);
    if (totalTimeLabel) totalTimeLabel.textContent = fmtTime(d);
    if (progressFill) progressFill.style.width = d > 0 ? (t / d * 100) + '%' : '0%';
    if (progressWrapper) progressWrapper.classList.toggle('active', d > 0);
  }
  let progressDrag = false;
  function seekFromEvent(e) {
    if (!progressContainer) return;
    const rect = progressContainer.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    seekTo((state.duration || 0) * Math.max(0, Math.min(1, ratio)));
    updateProgressUI();
  }
  if (progressContainer) {
    progressContainer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      progressDrag = true;
      progressContainer.classList.add('dragging');
      seekFromEvent(e);
    });
    window.addEventListener('pointermove', (e) => { if (progressDrag) seekFromEvent(e); });
    window.addEventListener('pointerup', () => {
      if (progressDrag) { progressDrag = false; progressContainer.classList.remove('dragging'); }
    });
  }
  updateProgressUI();

  function cycleLoopMode() {
    loopMode = loopMode === 'list' ? 'one' : loopMode === 'one' ? 'random' : 'list';
    return loopMode;
  }

  /* 事件 */
  audioEl.addEventListener('play', () => { state.paused = false; onChange(); });
  audioEl.addEventListener('pause', () => { state.paused = true; onChange(); });
  audioEl.addEventListener('loadedmetadata', () => { state.duration = audioEl.duration || 0; onChange(); updateProgressUI(); });
  audioEl.addEventListener('timeupdate', () => {
    state.currentTime = audioEl.currentTime;
    updateProgressUI();
    if (state.lyricsData.length) {
      const t = audioEl.currentTime;
      let idx = -1;
      for (let i = 0; i < state.lyricsData.length; i++) {
        if (t >= state.lyricsData[i].time) idx = i; else break;
      }
      if (idx !== -1 && idx !== state.currentLyricIndex) {
        state.currentLyricIndex = idx;
        state.isLyricSettled = false;
        onChange();
      }
    }
  });
  audioEl.addEventListener('ended', () => {
    if (loopMode === 'one') { audioEl.currentTime = 0; audioEl.play().catch(() => {}); return; }
    next(true);
  });
  // 音源失效（HTTP 400/404/失效链接）：先换代理/直连/http 再试，全失败才自动跳过
  audioEl.addEventListener('error', () => {
    if (!state.currentTrack) return;
    const code = audioEl.error ? audioEl.error.code : 0;
    console.warn('audio error:', code, String(audioEl.src).slice(0, 90));
    if (mediaFallback && mediaFallback.active && mediaFallback.idx < mediaFallback.chain.length - 1) {
      applySource(mediaFallback.idx + 1, true);
      return;
    }
    toast('音源失效，再点一次播放重试');
  });

  // 直链是跨域音源：这里绝不 resumeCtx / 接 WebAudio——createMediaElementSource 一接管就静音，
  // 症状正是「进度条在走、歌词在滚、就是没声音」。宁可没有频谱，也要有声音。

  // 播放中途断流：waiting 超过 6 秒还停在低位 readyState，就换源，不要一直僵在那
  audioEl.addEventListener('waiting', () => {
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => {
      if (audioEl.paused || audioEl.readyState >= 3) return;
      console.warn('playback stalled readyState=' + audioEl.readyState);
      if (mediaFallback && mediaFallback.idx < mediaFallback.chain.length - 1) applySource(mediaFallback.idx + 1, true);
    }, 6000);
  });
  audioEl.addEventListener('playing', () => {
    clearTimeout(waitTimer);
    clearTimeout(sourceWatchdog);
    state.paused = false;
    onChange();
  });
  audioEl.addEventListener('pause', () => { state.paused = true; onChange(); });

  window.Player = {
    state,
    get queue() { return queue; },
    get qIndex() { return qIndex; },
    get loopMode() { return loopMode; },
    ensureAudio,
    playQueue,
    playAt,
    next,
    prev,
    toggle,
    seekTo,
    cycleLoopMode,
    loadTrack,
    onChange: (fn) => listeners.push(fn),
  };
})();
