/* MJMJ · 音频包络预分析（离线频谱）
   ---------------------------------------------------------------------------
   用途：直链播放拿不到 WebAudio AnalyserNode（跨域 createMediaElementSource 会静音），
   背景着色器缺少音频驱动就只剩时间轴漂移。这里复刻 Mineradio
   03-beat/01-audio-beat-analysis.js 的做法：fetch 整条音源 → decodeAudioData →
   按频段算能量包络表，播放时用 currentTime 查表。

   频段边界同 11-main-loop.js 的真实分段：
     kick 52-165 Hz（含 38-74 sub、165-420 body）
     vocal 420-2600 Hz
     instrument 2600-6200 Hz
     air 6200-16000 Hz
   这里用一阶 IIR 低通把 160 / 2600 / 6200 Hz 三条分界切出来，逐窗求 RMS。
   ------------------------------------------------------------------------- */
(function () {
  var RATE = 25;                    // 每秒 25 个包络点（40ms），与上游 audioStepDt 同量级
  var DECIMATE_RATE = 11025;        // 分析用降采样率，足够覆盖 6.2k 分界
  var cache = Object.create(null);  // key -> { rate, frames, bass, mid, treble }
  var pending = Object.create(null);

  function keyOf(track) {
    return track && track.id != null ? String(track.id) : '';
  }

  function analyzeBuffer(buffer) {
    var ch = buffer.getChannelData(0);
    var sr = buffer.sampleRate || 44100;
    var step = Math.max(1, Math.floor(sr / DECIMATE_RATE));
    var sr2 = sr / step;
    var a1 = Math.exp(-2 * Math.PI * 160 / sr2);
    var a2 = Math.exp(-2 * Math.PI * 2600 / sr2);
    var a3 = Math.exp(-2 * Math.PI * 6200 / sr2);
    var win = Math.max(8, Math.round(sr2 / RATE));
    var bass = [], mid = [], treble = [];
    var y1 = 0, y2 = 0, y3 = 0;
    var s1 = 0, s2 = 0, s3 = 0, n = 0;
    for (var i = 0; i < ch.length; i += step) {
      var x = ch[i];
      if (!isFinite(x)) x = 0;
      y1 = (1 - a1) * x + a1 * y1;
      y2 = (1 - a2) * x + a2 * y2;
      y3 = (1 - a3) * x + a3 * y3;
      var b = y2 - y1;            // 160-2600 带
      var t = y3 - y2;            // 2600-6200 带
      s1 += y1 * y1;
      s2 += b * b;
      s3 += t * t;
      n++;
      if (n >= win) {
        bass.push(Math.sqrt(s1 / n));
        mid.push(Math.sqrt(s2 / n));
        treble.push(Math.sqrt(s3 / n));
        s1 = s2 = s3 = 0;
        n = 0;
      }
    }
    return { rate: RATE, frames: bass.length, bass: bass, mid: mid, treble: treble };
  }

  /* 峰值归一化 + 软压缩（上游对 rb/rm/rt 用的是 pow(..., 0.78~0.92) 那套） */
  function normalize(list, power, floor) {
    var peak = 0;
    for (var i = 0; i < list.length; i++) if (list[i] > peak) peak = list[i];
    if (peak <= 0.0006) return list.map(function () { return 0; });
    var out = new Array(list.length);
    for (var j = 0; j < list.length; j++) {
      var v = list[j] / peak;
      out[j] = Math.min(1, Math.max(floor, Math.pow(v, power)));
    }
    return out;
  }

  function analyzeTrack(track, url) {
    var key = keyOf(track);
    if (!key || !url || cache[key] || pending[key]) return;
    pending[key] = true;
    var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var Aec = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !Aec) return;
    function grab(u) {
      return fetch(u, { credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.arrayBuffer();
      });
    }
    // 直链被拦（CORS/防盗链）时退回本机同源代理取一次数据——只用于分析，播放仍是直链
    grab(url).catch(function () {
      return grab('/proxy?url=' + encodeURIComponent(url));
    })
      .then(function (buf) {
        var ac = new Aec();
        return ac.decodeAudioData(buf).then(function (b) {
          try { ac.close && ac.close(); } catch (e) {}
          return b;
        });
      })
      .then(function (buffer) {
        var raw = analyzeBuffer(buffer);
        cache[key] = {
          rate: raw.rate,
          frames: raw.frames,
          bass: normalize(raw.bass, 0.78, 0),
          mid: normalize(raw.mid, 0.86, 0),
          treble: normalize(raw.treble, 0.92, 0)
        };
        if (window.Player && Player.state && keyOf(Player.state.currentTrack) === key) {
          Player.state.envelope = cache[key];
          Player.state.envelopeKey = key;
        }
      })
      .catch(function (e) {
        console.warn('[audio-env] 分析失败（直链不可读则无频谱）', (e && e.message) || e);
      });
  }

  function at(env, time) {
    if (!env || !env.frames) return null;
    var i = Math.round((time || 0) * env.rate);
    if (i < 0) i = 0;
    if (i >= env.frames) i = env.frames - 1;
    return { bass: env.bass[i], mid: env.mid[i], treble: env.treble[i] };
  }

  window.MJMJAudioEnv = { analyzeTrack: analyzeTrack, at: at, cache: cache };
})();
