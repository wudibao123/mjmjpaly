// E2E 截图验证：启动真实后端 + 渲染层，驱动 UI 各状态并截图
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const ncmServer = require('../server/ncm-server');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'assets', 'verify');
fs.mkdirSync(outDir, { recursive: true });

app.whenReady().then(async () => {
  try {
    const { url } = await ncmServer.start({
      mainPort: 31999,
      dataDir: app.getPath('userData'),
      rendererDir: path.join(root, 'renderer'),
    });
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(root, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    const errors = [];
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) errors.push(message);
    });
    await win.loadURL(url);
    await new Promise((r) => setTimeout(r, 3000));

    const shot = async (name) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
    };

    await shot('01-boot');

    await win.webContents.executeJavaScript(`document.getElementById('lmClose').click(); true`);
    await new Promise((r) => setTimeout(r, 700));
    await shot('02-main');

    await win.webContents.executeJavaScript(
      `document.getElementById('dynamic-island').classList.add('expanded'); document.getElementById('tabBg').click(); true`
    );
    await new Promise((r) => setTimeout(r, 800));
    await shot('03-island-bg');

    await win.webContents.executeJavaScript(`document.querySelector('.bg-mode[data-mode="aurora"]').click(); true`);
    await new Promise((r) => setTimeout(r, 1000));
    await shot('04-aurora');

    await win.webContents.executeJavaScript(`document.getElementById('plistBtn').click(); true`);
    await new Promise((r) => setTimeout(r, 800));
    await shot('05-playlist');

    await win.webContents.executeJavaScript(`document.getElementById('searchBtn').click(); true`);
    await new Promise((r) => setTimeout(r, 600));
    await shot('08-search');

    const searchRes = await win.webContents.executeJavaScript(
      `NCM.search('晴天', 3).then(s => JSON.stringify(s.map(t => t.name + ' - ' + t.artists))).catch(e => 'ERR:' + e.message)`
    );
    fs.writeFileSync(path.join(outDir, 'search-result.txt'), String(searchRes));

    await win.webContents.executeJavaScript(`document.querySelector('.bg-mode[data-mode="desktop"]').click(); true`);
    await new Promise((r) => setTimeout(r, 600));
    await shot('06-desktop');

    // 玻璃参数 tab
    await win.webContents.executeJavaScript(`document.getElementById('tabGlass').click(); true`);
    await new Promise((r) => setTimeout(r, 600));
    await shot('07-glass-params');

    fs.writeFileSync(path.join(outDir, 'console-errors.txt'), errors.join('\n') || '(none)');
    console.log('SHOT DONE');
  } catch (e) {
    console.error('SHOT FAIL', e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
