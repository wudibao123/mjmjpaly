// MJMJ 本地后端
// 职责：静态托管渲染层 / 网易云 API 反向代理 / 音频流代理（同源，供 WebAudio 分析）/ 登录态本地持久化
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const express = require('express');
const NeteaseCloudMusicApi = require('NeteaseCloudMusicApi');
const QRCode = require('qrcode');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > start + 50) return reject(new Error('no free port'));
      const srv = http.createServer();
      srv.once('error', () => { tryPort(p + 1); });
      srv.listen(p, '127.0.0.1', () => {
        srv.close(() => resolve(p));
      });
    };
    tryPort(start);
  });
}

/** 流式转发远程音频（带 Range/重定向支持） */
function streamRemote(urlStr, req, res) {
  if (!urlStr || !/^https?:\/\//i.test(urlStr)) {
    return res.status(400).send('bad url');
  }
  const fetchStream = (target) => {
    const u = new URL(target);
    const mod = u.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': UA,
      Referer: 'https://music.163.com/',
      Origin: 'https://music.163.com',
      Accept: '*/*',
    };
    if (req.headers.range) headers.Range = req.headers.range;
    let settled = false;
    const r = mod.get(u.href, { headers }, (resp) => {
      settled = true;
      if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
        resp.resume();
        return fetchStream(new URL(resp.headers.location, target).href);
      }
      if (resp.statusCode !== 200 && resp.statusCode !== 206) {
        resp.resume();
        return res.status(502).send('upstream ' + resp.statusCode);
      }
      const h = {};
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        if (resp.headers[k]) h[k] = resp.headers[k];
      }
      res.writeHead(resp.statusCode, h);
      resp.pipe(res);
    });
    // 8 秒拿不到响应头就判失败：没有这道超时，上游卡住时播放器会永远 pending，
    // 用户看到的就是「进度条不动、也不弹音源失败」
    r.setTimeout(8000, () => {
      if (settled || res.headersSent) return;
      settled = true;
      try { r.destroy(); } catch (e) {}
      try { res.status(502).end('upstream timeout'); } catch (e) {}
    });
    r.on('error', () => {
      if (settled || res.headersSent) return;
      settled = true;
      try { res.status(502).end('proxy error'); } catch (e) {}
    });
  };
  fetchStream(urlStr);
}

/** 反向代理到内部网易云 API 服务 */
function proxyToNcm(req, res, ncmPort) {
  const targetPath = req.originalUrl.replace(/^\/api/, '') || '/';
  const options = {
    hostname: '127.0.0.1',
    port: ncmPort,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: '127.0.0.1:' + ncmPort },
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => { try { res.status(502).send('api proxy error'); } catch (e) {} });
  req.pipe(proxyReq);
}

/**
 * 启动 MJMJ 本地后端
 * @param {{mainPort?:number, ncmPort?:number, dataDir:string, rendererDir:string}} opts
 */
async function start(opts) {
  const mainPort = opts.mainPort || 31999;
  const dataDir = opts.dataDir;
  const rendererDir = opts.rendererDir;
  const authFile = path.join(dataDir, 'auth.json');
  fs.mkdirSync(dataDir, { recursive: true });

  // 1) 内部网易云 API 服务（独立端口）
  const ncmPort = await findFreePort(opts.ncmPort || 31998);
  await NeteaseCloudMusicApi.serveNcmApi({
    port: ncmPort,
    host: '127.0.0.1',
    checkVersion: false,
  });

  // 2) 主服务
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // ===== 局域网访问开关（默认关；开启后同一局域网可用浏览器打开本播放器）=====
  const lanFile = path.join(dataDir, 'lan.json');
  let lanAllowed = false;
  try { lanAllowed = JSON.parse(fs.readFileSync(lanFile, 'utf8')).allowed === true; } catch (e) {}
  const lanUrls = () => {
    const urls = [];
    try {
      const nets = os.networkInterfaces();
      Object.keys(nets).forEach((name) => {
        (nets[name] || []).forEach((ni) => {
          if (ni.family === 'IPv4' && !ni.internal) urls.push('http://' + ni.address + ':' + mainPort);
        });
      });
    } catch (e) {}
    return urls;
  };
  app.get('/lan', (req, res) => {
    if (req.query.allow !== undefined) {
      lanAllowed = String(req.query.allow) === '1';
      try { fs.writeFileSync(lanFile, JSON.stringify({ allowed: lanAllowed })); } catch (e) {}
    }
    res.json({ ok: true, allowed: lanAllowed, urls: lanUrls() });
  });
  // 门禁：未开启时，非本机来源一律 403（本机 WebView / 浏览器不受影响）
  app.use((req, res, next) => {
    if (lanAllowed || req.path === '/lan') return next();
    const ip = (req.socket && req.socket.remoteAddress) || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLocal) return next();
    res.status(403).type('text/plain; charset=utf-8').send('本机未允许其他设备访问：请在灵动岛「设置」中打开“允许其他设备访问”');
  });

  // 静态托管渲染层
  app.use(express.static(rendererDir));

  // 音频代理：/proxy?url=...（同源，WebAudio 分析可用）
  app.get('/proxy', (req, res) => streamRemote(req.query.url, req, res));

  // 二维码生成：/api/qr-image?url=...（qr/create 的 qrimg 可能为空，用 qrurl 生成）
  app.get('/api/qr-image', async (req, res) => {
    const url = req.query.url;
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'bad url' });
    try {
      const data = await QRCode.toDataURL(url, { width: 260, margin: 1 });
      res.json({ ok: true, data });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e && e.message || e) });
    }
  });

  // 网易云 API 反向代理：/api/xxx -> 127.0.0.1:ncmPort/xxx
  app.use('/api', (req, res) => proxyToNcm(req, res, ncmPort));

  // 登录态本地持久化
  app.get('/auth/load', (req, res) => {
    try {
      if (fs.existsSync(authFile)) {
        const data = JSON.parse(fs.readFileSync(authFile, 'utf8'));
        return res.json({ ok: true, data });
      }
      res.json({ ok: true, data: null });
    } catch (e) {
      res.json({ ok: false, error: String(e && e.message || e) });
    }
  });
  app.post('/auth/save', (req, res) => {
    try {
      const { cookie, profile } = req.body || {};
      if (!cookie) return res.json({ ok: false, error: 'no cookie' });
      fs.writeFileSync(authFile, JSON.stringify({ cookie, profile, savedAt: Date.now() }, null, 2), 'utf8');
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: String(e && e.message || e) });
    }
  });
  app.post('/auth/clear', (req, res) => {
    try {
      if (fs.existsSync(authFile)) fs.unlinkSync(authFile);
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, error: String(e && e.message || e) });
    }
  });

  // 首页兜底
  app.get('/', (req, res) => res.sendFile(path.join(rendererDir, 'index.html')));

  await new Promise((resolve, reject) => {
    const srv = app.listen(mainPort, '0.0.0.0', resolve);
    srv.on('error', reject);
  });

  return { url: `http://127.0.0.1:${mainPort}`, mainPort, ncmPort };
}

module.exports = { start };
