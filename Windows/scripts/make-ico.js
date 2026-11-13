// 合成 mjmj.ico（纯 Node，无需 Electron）：npm run icon 时在 render-icon.js 之后执行
const path = require('path');
const fs = require('fs');
const pngToIco = require('png-to-ico').default || require('png-to-ico');

const iconDir = path.join(__dirname, '..', 'assets', 'icon');
const sizes = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  const ico = await pngToIco(sizes.map((s) => path.join(iconDir, `mjmj-${s}.png`)));
  fs.writeFileSync(path.join(iconDir, 'mjmj.ico'), ico);
  console.log('mjmj.ico written (' + ico.length + ' bytes)');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
