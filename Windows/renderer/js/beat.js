/* MJMJ · 全局节拍脉冲（真跟音频，不是固定节奏）
   -------------------------------------------------------------------------
   上游 11-main-loop.js 驱动背景"跳一下"的是 beatPulse：
       命中时 beatPulse = max(beatPulse, 强度)
       每帧 beatPulse *= pow(0.36, dt)

   强度必须来自音频的**真实上升沿**，而且要分强弱拍：
     · 取 audio-env 的离线频谱包络（25 点/秒，bass/mid/treble 按峰值归一），
       用 at(t) 与 at(t - 0.04) 的差当 onset —— 40ms 前后对比，才是鼓点的入口。
     · onset 再按"最近 1.2 秒内的最强 onset"做自适应归一：
       强拍≈1，弱拍≈0.2，不再是每一下都顶满（那样看起来就是预设节奏）。
     · 没有包络时（分析失败 / 还没分析完）退回 CSS 变量那条通道，仍然有起伏。
   ------------------------------------------------------------------------- */
(function () {
  var pulse = 0;
  var zoomPulse = 0;

  var onsetPeak = 0.02;
  var prevEnergy = 0;
  var prevBass = 0;
  var lastT = 0;
  var envSeen = '';

  function readFromEnvelope() {
    var st = window.Player && window.Player.state;
    if (!st || !st.envelope || !window.MJMJAudioEnv) return null;
    var env = st.envelope;
    var key = st.envelopeKey || '';
    if (key !== envSeen) {
      /* 换歌：先看一个采样点再开始算，避免上一首的尾巴当成这一首的第一拍 */
      envSeen = key;
      onsetPeak = 0.02;
    }
    var t = st.audioEl ? (st.audioEl.currentTime || 0) : 0;
    var now = window.MJMJAudioEnv.at(env, t);
    var before = window.MJMJAudioEnv.at(env, t - 0.04);
    if (!now || !before) return null;
    var bassOnset = Math.max(0, now.bass - before.bass);
    var midOnset = Math.max(0, now.mid - before.mid);
    var energy = now.bass * 0.52 + now.mid * 0.30 + now.treble * 0.18;
    return {
      energy: energy,
      bass: now.bass,
      onset: Math.max(bassOnset * 1.6, midOnset * 0.9)
    };
  }

  function readFromCss() {
    var cs = document.documentElement;
    var energy = parseFloat(cs.style.getPropertyValue('--energy')) || 0;
    var bass = parseFloat(cs.style.getPropertyValue('--bass')) || 0;
    var energyOnset = Math.max(0, energy - prevEnergy);
    var bassOnset = Math.max(0, bass - prevBass);
    prevEnergy = energy;
    prevBass = bass;
    return { energy: energy, bass: bass, onset: Math.max(energyOnset * 0.9, bassOnset * 0.9) };
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (!lastT) lastT = t;
    var dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;

    var paused = !!(window.Player && window.Player.state && window.Player.state.paused);
    var src = paused ? null : readFromEnvelope();
    if (!src) src = readFromCss();

    var onset = paused ? 0 : src.onset;
    /* 自适应归一：以最近 1.2 秒内最强的一次 onset 为满幅，强拍跳得大、弱拍只轻轻一顶 */
    onsetPeak *= Math.pow(0.5, dt / 1.2);
    if (onset > onsetPeak) onsetPeak = onset;
    var norm = onset / Math.max(0.02, onsetPeak * 0.55);
    norm = Math.min(1, Math.max(0, norm));

    if (!paused && norm > 0.12) {
      pulse = Math.max(pulse, norm);
      zoomPulse = Math.max(zoomPulse, norm);
    }
    pulse *= Math.pow(0.36, dt);
    /* 推拉回落更快（约 0.4 秒见底），推上去之后能看见画面退回来 */
    zoomPulse *= Math.pow(0.12, dt);

    var root = document.documentElement.style;
    root.setProperty('--beat', (paused ? 0 : pulse).toFixed(3));
    root.setProperty('--beat-zoom', (paused ? 0 : zoomPulse).toFixed(3));
    /* 给背景层的低频起伏用：这一帧的真实低频值，不是平滑过的 */
    root.setProperty('--beat-bass', (paused ? 0 : src.bass).toFixed(3));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { requestAnimationFrame(frame); });
  } else {
    requestAnimationFrame(frame);
  }

  window.MJMJBeat = {
    get pulse() { return pulse; },
    get zoomPulse() { return zoomPulse; }
  };
})();
