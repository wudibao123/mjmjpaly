// 后端冒烟测试：启动服务 → 搜索 API → 登录二维码 key
const srv = require('../server/ncm-server');
const path = require('path');
const fs = require('fs');
const os = require('os');

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjmj-test-'));
  const { url } = await srv.start({
    mainPort: 31999,
    dataDir,
    rendererDir: path.join(__dirname, '..', 'renderer'),
  });

  const search = await fetch(url + '/api/search?keywords=%E6%99%B4%E5%A4%A9&limit=1');
  const sj = await search.json();

  const qrKey = await fetch(url + '/api/login/qr/key');
  const qj = await qrKey.json();

  const out = {
    mainUrl: url,
    searchHttp: search.status,
    searchCode: sj.code,
    firstSong: sj.result && sj.result.songs && sj.result.songs[0] && sj.result.songs[0].name,
    qrKeyHttp: qrKey.status,
    qrCode: qj.code,
    unikey: qj.data && qj.data.unikey,
  };
  fs.writeFileSync('D:\\我的作品\\smoke.json', JSON.stringify(out, null, 2));
  console.log('SMOKE OK');
  process.exit(0);
})().catch((e) => {
  fs.writeFileSync('D:\\我的作品\\smoke.json', JSON.stringify({ error: String((e && e.stack) || e) }, null, 2));
  console.error('SMOKE FAIL', e);
  process.exit(1);
});
