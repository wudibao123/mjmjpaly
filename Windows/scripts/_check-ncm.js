const m = require('NeteaseCloudMusicApi');
const fs = require('fs');
const out = {
  type: typeof m,
  keys: Object.keys(m),
};
fs.writeFileSync('D:\\我的作品\\ncm-exports.json', JSON.stringify(out, null, 2));
