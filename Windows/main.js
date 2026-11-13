// MJMJ Electron 主进程
const { app, BrowserWindow, ipcMain, clipboard, screen, desktopCapturer, session } = require('electron');

// 只给网易云音源域名补 CORS 头：渲染层需要 fetch 整条音源到本地解码出频谱包络，
// 不改任何接口，也不改变播放路径（播放仍是 CDN 直链）。
app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const url = String(details.url || '');
    if (!/(music\.126\.net|music\.163\.com|163cn\.tv)/i.test(url)) return cb({});
    const h = Object.assign({}, details.responseHeaders || {});
    h['Access-Control-Allow-Origin'] = ['*'];
    h['Access-Control-Allow-Headers'] = ['*'];
    h['Access-Control-Allow-Methods'] = ['GET', 'HEAD'];
    cb({ responseHeaders: h });
  });
});

// WebAudio 无手势时保持 running，否则 AudioContext 停在 suspended：有播放进度、没声音、频谱不动
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const path = require('path');
const http = require('http');
const ncmServer = require('./server/ncm-server');

const MAIN_PORT = 31999;
// 命令行控制端口：只服务 mjplay，和对外 API 完全分离（旧接口不受影响）
const CONTROL_PORT = 31997;
let controlServer = null;
let win = null;
let prevBounds = null;
let manualFullscreen = false;

app.setAppUserModelId('com.mjmj.player');

function syncFsState() {
  const fs = !!(win && (win.isFullScreen() || win.isMaximized() || manualFullscreen));
  if (win && !win.isDestroyed()) win.webContents.send('win:fullscreen-changed', fs);
  return fs;
}

ipcMain.handle('win:minimize', () => {
  if (!win || win.isDestroyed()) return false;
  try {
    // 全屏 / 最大化状态下 Windows 会吞掉最小化请求，先退回普通窗口再最小化
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    if (manualFullscreen) { manualFullscreen = false; if (prevBounds) win.setBounds(prevBounds); }
    syncFsState();
    win.setSkipTaskbar(false); // 确保任务栏有项可以点回来
    win.minimize();
    return true;
  } catch (e) {
    console.error('[MJMJ] minimize failed', e);
    return false;
  }
});
ipcMain.handle('win:close', () => win && win.close());
// 全屏/还原：优先 setFullScreen（真全屏、盖任务栏）；
// 透明窗口在 Windows 上 setFullScreen 可能无效，500ms 后检测并手动铺满屏幕（display.bounds）兜底
ipcMain.handle('win:fullscreen', () => {
  if (!win) return false;
  if (win.isFullScreen() || win.isMaximized() || manualFullscreen) {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    if (manualFullscreen) {
      manualFullscreen = false;
      if (prevBounds) win.setBounds(prevBounds);
    }
  } else {
    prevBounds = win.getBounds();
    manualFullscreen = false;
    win.setFullScreen(true);
    setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isFullScreen() && !win.isMaximized()) {
        const display = screen.getDisplayMatching(win.getBounds());
        manualFullscreen = true;
        win.setBounds(display.bounds);
        win.webContents.send('win:fullscreen-changed', true);
      }
    }, 500);
  }
  return syncFsState();
});
ipcMain.handle('win:isFullscreen', () => !!(win && (win.isFullScreen() || win.isMaximized() || manualFullscreen)));
ipcMain.handle('clipboard:read', () => clipboard.readText());
// 桌面截屏：供「透出桌面」模式下玻璃折射真实桌面内容（静态快照，周期刷新）
ipcMain.handle('desktop:capture', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    if (!sources.length) return null;
    const primary = screen.getPrimaryDisplay();
    const src = sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0];
    if (src && src.thumbnail && !src.thumbnail.isEmpty()) return src.thumbnail.toDataURL();
    return null;
  } catch (e) {
    console.error('desktop capture failed', e);
    return null;
  }
});

async function createWindow() {
  const { url } = await ncmServer.start({
    mainPort: MAIN_PORT,
    dataDir: app.getPath('userData'),
    rendererDir: path.join(__dirname, 'renderer'),
  });

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    icon: path.join(__dirname, 'assets', 'icon', 'mjmj.ico'),
    title: 'MJMJ · 播放器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadURL(url);
  win.once('ready-to-show', () => win.show());
  // 把渲染进程的 console 转到主进程 stdout：没有这层，播放/音源出问题时日志里什么都看不到
  win.webContents.on('console-message', (event, level, message) => {
    const text = typeof message === 'string' ? message : (event && event.message) || '';
    if (text) console.log('[renderer] ' + text);
  });
  // F12（或 Ctrl+Shift+I）打开开发者工具，再按一次关闭；detach 模式不打乱透明窗口布局
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const isF12 = key === 'f12';
    const isCombo = input.control && input.shift && key === 'i';
    if (!isF12 && !isCombo) return;
    e.preventDefault();
    if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
    else win.webContents.openDevTools({ mode: 'detach' });
  });
  win.on('fullscreen', syncFsState);
  win.on('leave-full-screen', () => { manualFullscreen = false; syncFsState(); });
  win.on('maximize', syncFsState);
  win.on('unmaximize', syncFsState);
  // 从最小化恢复：通知渲染层重算画布/玻璃尺寸，避免恢复后画面错位或停帧
  win.on('restore', () => {
    if (!win || win.isDestroyed()) return;
    syncFsState();
    try { win.webContents.send('win:restored'); } catch (e) {}
  });
  win.on('closed', () => { win = null; });
  startControlServer();
}

/**
 * mjplay 命令行控制服务：GET /ping 探活，POST /cli/play 指定曲目播放。
 * CLI 只走这里，不碰 /api 旧接口；收到后把曲目转给渲染层，UI 自动同步。
 */
function startControlServer() {
  if (controlServer) return;
  controlServer = http.createServer((req, res) => {
    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'GET' && req.url === '/ping') {
      json(200, { ok: true, app: 'MJMJ', ready: !!(win && !win.isDestroyed()) });
      return;
    }
    // 只读探针：读渲染层真实的音频状态，用来判断音源到底有没有起播（进度条走不走看 cur）
    if (req.method === 'GET' && req.url === '/cli/audio') {
      if (!win || win.isDestroyed()) { json(503, { ok: false, error: '窗口未就绪' }); return; }
      const probe = "(() => { const a = window.__mjmjAudio || document.querySelector('audio'); if (!a) return { found: false };"
        + " return { found: true, src: String(a.currentSrc || a.src).slice(0, 140),"
        + " cur: Math.round(a.currentTime * 100) / 100, dur: Math.round((a.duration || 0) * 100) / 100,"
        + " paused: a.paused, ready: a.readyState, err: a.error ? a.error.code : 0 }; })()";
      win.webContents.executeJavaScript(probe)
        .then((v) => json(200, Object.assign({ ok: true }, v)))
        .catch((e) => json(500, { ok: false, error: String((e && e.message) || e) }));
      return;
    }
    if (req.method === 'POST' && req.url === '/cli/play') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 65536) req.destroy();
      });
      req.on('end', () => {
        try {
          const track = JSON.parse(body || '{}');
          if (!track || !track.id) throw new Error('缺少歌曲 id');
          if (!win || win.isDestroyed()) throw new Error('窗口未就绪');
          win.webContents.send('cli:play', track);
          if (win.isMinimized()) win.restore();
          win.show();
          json(200, { ok: true, playing: track.name || String(track.id) });
        } catch (e) {
          json(400, { ok: false, error: e.message });
        }
      });
      return;
    }
    json(404, { ok: false, error: 'not found' });
  });
  controlServer.on('error', (e) => console.error('[MJMJ] control server:', e.message));
  controlServer.listen(CONTROL_PORT, '127.0.0.1', () => {
    console.log('[MJMJ] 命令行控制端口已就绪:', CONTROL_PORT);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
