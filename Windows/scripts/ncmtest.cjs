const N = require('NeteaseCloudMusicApi');
(async () => {
  try {
    const r = await N.login_qr_key({});
    console.log('NODE_RESP=' + JSON.stringify(r.body).substring(0, 300));
  } catch (e) { console.log('NODE_ERR=' + e.message); }
})();