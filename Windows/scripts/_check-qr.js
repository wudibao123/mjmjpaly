// 快速验证二维码接口返回结构
const api = require('NeteaseCloudMusicApi');
(async () => {
  try {
    const k = await api.login_qr_key({ timestamp: Date.now() });
    console.log('KEY code:', k.body && k.body.code);
    if (!k.body || k.body.code !== 200 || !k.body.data) { console.log('KEY BODY:', JSON.stringify(k.body).slice(0, 400)); return; }
    console.log('KEY data keys:', Object.keys(k.body.data));
    const c = await api.login_qr_create({ key: k.body.data.unikey, qrcodeWidth: 260, force: true });
    console.log('CREATE code:', c.body && c.body.code);
    if (c.body && c.body.data) {
      console.log('CREATE data keys:', Object.keys(c.body.data));
      const d = c.body.data;
      if (d.qrimg) console.log('qrimg head:', String(d.qrimg).slice(0, 60), 'len=', d.qrimg.length);
      if (d.qrurl) console.log('qrurl:', d.qrurl);
    } else {
      console.log('CREATE BODY:', JSON.stringify(c.body).slice(0, 400));
    }
  } catch (e) {
    console.error('ERR', e.message);
  }
})();
