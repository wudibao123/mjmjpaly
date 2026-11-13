// 无头音频自检：起本地服务 → 隐藏窗口加载渲染层 → 在页面内用真实 /proxy 音频跑一遍
// 输出：AudioContext 状态、audio 元素状态、是否真的在推进、频谱峰值、错误码
const { app, BrowserWindow } = require('electron');
const path = require('path');
const mjmj = require('../server/ncm-server.js');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

async function main() {
  const root = path.resolve(__dirname, '..');
  const srv = await mjmj.start({
    mainPort: 32199,
    ncmPort: 32198,
    dataDir: path.join(root, 'data'),
    rendererDir: path.join(root, 'renderer'),
  });

  const win = new BrowserWindow({ show: false, width: 1000, height: 700 });
  await win.loadURL(srv.url + '/');

  const probe = await win.webContents.executeJavaScript(`
    (async () => {
      const out = {};
      try {
        let r = await fetch('/api/song/url/v1?id=347230&level=standard').then(x => x.json());
        let u = r && r.data && r.data[0] && r.data[0].url;
        if (!u) {
          r = await fetch('/api/song/url?id=347230&br=128000').then(x => x.json());
          u = r && r.data && r.data[0] && r.data[0].url;
        }
        out.songUrl = u ? (u.slice(0, 60) + '...') : null;
        out.songSrc = r && r.code;
        if (!u) return { fail: 'no url', r };

        const a = new Audio('/proxy?url=' + encodeURIComponent(u));
        out.proxyOk = true;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        out.ctxInit = ctx.state;
        try { await ctx.resume(); } catch (e) { out.resumeErr = String(e); }
        out.ctxAfterResume = ctx.state;
        const src = ctx.createMediaElementSource(a);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        an.connect(ctx.destination);
        let errName = null;
        a.onerror = () => { errName = (a.error && a.error.code) || 'err'; };
        await a.play().catch(e => { errName = e.name; });
        await new Promise(ok => setTimeout(ok, 4000));
        const arr = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(arr);
        out.readyState = a.readyState;
        out.paused = a.paused;
        out.currentTime = a.currentTime;
        out.duration = a.duration;
        out.volume = a.volume;
        out.muted = a.muted;
        out.error = errName;
        out.peak = Math.max.apply(null, Array.from(arr));
        out.ctxFinal = ctx.state;
        return out;
      } catch (e) { return { exception: String(e && (e.stack || e.message || e)) }; }
    })()
  `, true);

  console.log('PROBE=' + JSON.stringify(probe));
  win.destroy();
  app.quit();
}

app.whenReady().then(main).catch((e) => {
  console.log('PROBE_FAIL=' + (e && (e.stack || e.message)));
  app.quit();
});
