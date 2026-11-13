// 验证 /api/qr-image 路由生成二维码
const os = require('os');
const path = require('path');
const { start } = require('../server/ncm-server');

(async () => {
  const { url } = await start({ dataDir: path.join(os.tmpdir(), 'mjmj-qr-test'), rendererDir: path.join(__dirname, '..', 'renderer') });
  const r = await fetch(url + '/api/qr-image?url=' + encodeURIComponent('https://music.163.com/login?codekey=test-key-123'));
  const j = await r.json();
  console.log('ok:', j.ok);
  console.log('data head:', String(j.data).slice(0, 40));
  console.log('data len:', j.data ? j.data.length : 0);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
