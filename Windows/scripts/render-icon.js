// MJMJ 图标渲染脚本：SVG 字标 → 512 矢量母版 → 多尺寸 PNG → 合成 ICO
// 用法：npm run icon  (electron scripts/render-icon.js)
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const pngToIco = require('png-to-ico').default || require('png-to-ico');

const iconDir = path.join(__dirname, '..', 'assets', 'icon');
const svgFile = path.join(iconDir, 'mjmj-icon.svg');

const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

app.whenReady().then(async () => {
  try {
    // 1) 渲染 512 矢量母版：ASCII 临时路径 file:// 包装页 + 内嵌 data:image/svg+xml
    const svgData = fs.readFileSync(svgFile, 'utf8');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjmj-icon-'));
    const wrapper = path.join(tmpDir, 'icon.html');
    fs.writeFileSync(
      wrapper,
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>` +
        `html,body{margin:0;padding:0;overflow:hidden;background:transparent}` +
        `img{display:block;width:100vw;height:100vh}</style></head><body>` +
        `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}">` +
        `</body></html>`
    );

    const win = new BrowserWindow({
      width: 512,
      height: 512,
      show: false,
      frame: false,
      transparent: true,
      useContentSize: true,
    });
    await win.loadFile(wrapper);
    await new Promise((r) => setTimeout(r, 300));
    const master = (await win.webContents.capturePage()).toPNG();
    fs.writeFileSync(path.join(iconDir, 'mjmj-512.png'), master);
    win.destroy();
    console.log('rendered 512 (master)');

    // 2) Skia 高质量缩放出其余尺寸
    const base = nativeImage.createFromPath(path.join(iconDir, 'mjmj-512.png'));
    for (const s of sizes) {
      if (s === 512) continue;
      const img = base.resize({ width: s, height: s, quality: 'good' });
      fs.writeFileSync(path.join(iconDir, `mjmj-${s}.png`), img.toPNG());
      console.log('rendered', s);
    }

    // 3) 合成 ICO
    const paths = icoSizes.map((s) => path.join(iconDir, `mjmj-${s}.png`));
    const ico = await pngToIco(paths);
    fs.writeFileSync(path.join(iconDir, 'mjmj.ico'), ico);
    console.log('ico written: mjmj.ico');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {
    console.error('icon render failed:', e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
