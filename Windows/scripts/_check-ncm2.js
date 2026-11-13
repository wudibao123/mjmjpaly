const m = require('NeteaseCloudMusicApi');
const fs = require('fs');
const out = {
  serverType: typeof m.server,
  serverHasListen: !!(m.server && typeof m.server.listen === 'function'),
  serverHasRoutes: !!(m.server && m.server._router && m.server._router.stack.length),
  serveNcmApiType: typeof m.serveNcmApi,
  serveNcmApiSrc: typeof m.serveNcmApi === 'function' ? m.serveNcmApi.toString().slice(0, 600) : '',
};
fs.writeFileSync('D:\\我的作品\\ncm-exports2.json', JSON.stringify(out, null, 2));
