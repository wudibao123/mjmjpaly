/* MJMJ · 网易云 API 客户端 + 登录态管理 */
(function () {
  'use strict';

  const NCM = {
    cookie: null,
    profile: null,
    handlers: [],
  };

  // 登录态变化订阅
  NCM.onAuth = (fn) => { NCM.handlers.push(fn); };
  function emitAuth() { NCM.handlers.forEach((fn) => { try { fn(NCM); } catch (e) {} }); }

  /**
   * Cookie 归一化。本地存的是整条 Set-Cookie 串（MUSIC_R_T=...; Max-Age=...; Expires=...; Path=/api/clientlog; ...），
   * 直接拼进请求头会被网易云当成畸形 Cookie → /song/url 一律 400/-460，表现就是「能搜到、有歌词、就是没音源」。
   * 这里只保留 name=value 对，去掉属性段，同一键只留第一次出现的值。
   */
  function cookieHeader(raw) {
    if (!raw) return '';
    const out = [];
    const seen = Object.create(null);
    String(raw).split(';').forEach((part) => {
      const seg = part.trim();
      if (!seg) return;
      const eq = seg.indexOf('=');
      if (eq <= 0) return;
      const k = seg.slice(0, eq).trim();
      const v = seg.slice(eq + 1).trim();
      if (!k || !v) return;
      if (/^(max-age|expires|path|domain|secure|httponly|samesite|version|comment)$/i.test(k)) return;
      if (seen[k]) return;
      seen[k] = 1;
      out.push(k + '=' + v);
    });
    return out.join('; ');
  }

  // 统一请求：同源 /api，登录后自动带 cookie
  NCM.get = async function (path, params = {}) {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) p.set(k, v);
    });
    if (NCM.cookie && !p.has('cookie')) p.set('cookie', cookieHeader(NCM.cookie));
    const res = await fetch('/api' + path + '?' + p.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  // 登录状态校验（兼容 profile / account 两种返回结构，profile 为空但 account 有 id 也算已登录）
  NCM.checkLoginStatus = async function () {
    try {
      const j = await NCM.get('/login/status', { timestamp: Date.now() });
      // 三种返回形态：Java 侧 {code,data:{profile,account}}；NeteaseCloudMusicApi 侧 {data:{code,account,profile}}；
      // 少数版本还会再包一层 data.data —— 一路往 data 里剥，直到出现 profile/account 或剥不下去
      let d = j;
      for (let i = 0; i < 3; i++) {
        if (!d || typeof d !== 'object') break;
        if (d.profile || d.account) break;
        if (!d.data || typeof d.data !== 'object') break;
        d = d.data;
      }
      const p = d && d.profile;
      const a = d && d.account;
      // 判据只看「有没有身份」：有 profile，或 account 里有 id，就算已登录。
      // 不能把 code 挂在外层 j 上当硬条件——NeteaseCloudMusicApi 把 code 包在 data 里，外层永远是 undefined
      if (p || (a && a.id)) {
        NCM.profile = p || { userId: a.id, nickname: a.userName || '网易云用户', avatarUrl: a.avatarUrl || '' };
        emitAuth();
        return true;
      }
    } catch (e) { console.warn('login status check failed', e); }
    NCM.profile = null;
    return false;
  };

  // 从本地缓存恢复登录态
  NCM.restore = async function () {
    try {
      const r = await fetch('/auth/load');
      const j = await r.json();
      if (j.ok && j.data && j.data.cookie) {
        NCM.cookie = j.data.cookie;
        if (await NCM.checkLoginStatus()) {
          NCM.profile = j.data.profile || NCM.profile;
          emitAuth();
          return true;
        }
        // cookie 失效则清除
        NCM.cookie = null;
        await fetch('/auth/clear', { method: 'POST' });
      }
    } catch (e) { console.warn('restore auth failed', e); }
    return false;
  };

  NCM.save = async function () {
    if (!NCM.cookie) return;
    try {
      await fetch('/auth/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: NCM.cookie, profile: NCM.profile }),
      });
    } catch (e) { console.warn('save auth failed', e); }
  };

  NCM.setLoggedIn = async function (cookie) {
    NCM.cookie = cookie;
    if (await NCM.checkLoginStatus()) {
      await NCM.save();
      emitAuth();
      return true;
    }
    NCM.cookie = null;
    return false;
  };

  NCM.logout = async function () {
    try { await NCM.get('/logout', { timestamp: Date.now() }); } catch (e) {}
    NCM.cookie = null;
    NCM.profile = null;
    try { await fetch('/auth/clear', { method: 'POST' }); } catch (e) {}
    emitAuth();
  };

  /* ===== 二维码登录 ===== */
  // 本地生成二维码（qrcodejs）：qrurl 是登录网页地址而不是图片，
  // 抓取网页当图片必然白板，必须在客户端把它编码成二维码位图。
  function localQrDataUrl(text, size) {
    return new Promise((resolve) => {
      try {
        if (typeof QRCode === 'undefined') { resolve(''); return; }
        const holder = document.createElement('div');
        holder.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
        document.body.appendChild(holder);
        new QRCode(holder, {
          text: text,
          width: size,
          height: size,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M,
        });
        setTimeout(() => {
          try {
            const c = holder.querySelector('canvas');
            const img = holder.querySelector('img');
            let out = '';
            if (c && typeof c.toDataURL === 'function') out = c.toDataURL('image/png');
            if (!out && img && img.src) out = img.src;
            if (holder.parentNode) holder.parentNode.removeChild(holder);
            resolve(out);
          } catch (e) { resolve(''); }
        }, 80);
      } catch (e) { resolve(''); }
    });
  }

  // 网易云 API 新旧返回结构兼容：字段可能直接在顶层，也可能包在 data 里
  function pickField(obj, key) {
    if (!obj) return undefined;
    if (obj.data && obj.data[key] !== undefined && obj.data[key] !== null && obj.data[key] !== '') return obj.data[key];
    return obj[key];
  }

  NCM.qr = {
    key: null,
    timer: null,
    _onState: null,
    _startedAt: 0,
    start: async function (onState) {
      this.stop();
      this._onState = onState;
      this._startedAt = Date.now();
      try {
        const k = await NCM.get('/login/qr/key', { timestamp: Date.now() });
        const unikey = pickField(k, 'unikey');
        if (k.code !== 200 || !unikey) throw new Error('获取二维码失败');
        this.key = unikey;
        // 不强制创建新 key、不传 qrcodeWidth：减少触发网易云风控的频次
        const c = await NCM.get('/login/qr/create', { key: this.key });
        const qrurlFromApi = pickField(c, 'qrurl');
        const qrimg = pickField(c, 'qrimg');
        // 新版接口有时把 key 吞掉、qrurl/qrimg 都是空，直接用 unikey 本地拼（与 Folia 一致）
        const qrurl = qrurlFromApi && qrurlFromApi.indexOf('codekey=' + this.key) >= 0
          ? qrurlFromApi
          : 'https://music.163.com/login?codekey=' + this.key;
        let img = qrimg;
        if (!img) {
          img = await localQrDataUrl(qrurl, 240);
        }
        if (!img) throw new Error('生成二维码失败');
        onState({ stage: 'qr', qrimg: img });
        // 轮询 6 秒一次，避免高频请求被网易云风控
        this.timer = setInterval(() => this.poll(), 6000);
        this.poll();
      } catch (e) {
        onState({ stage: 'error', message: e.message });
      }
    },
    poll: async function () {
      if (!this.key) return;
      // 3 分钟未完成扫码则停止，提示刷新或改用 Cookie
      if (Date.now() - this._startedAt > 180000) {
        this.stop();
        this._onState && this._onState({ stage: 'timeout' });
        return;
      }
      try {
        const j = await NCM.get('/login/qr/check', { key: this.key, timestamp: Date.now() });
        const cookie = pickField(j, 'cookie');
        if (j.code === 803 && cookie) {
          this.stop();
          this._onState && this._onState({ stage: 'authorized' });
          const ok = await NCM.setLoggedIn(cookie);
          this._onState && this._onState(ok ? { stage: 'success' } : { stage: 'error', message: '登录状态无效' });
          return;
        }
        // 802 等待扫码 / 801 已扫码待确认 / 800 过期 / 其他码视为异常（风控、参数错误等）
        if (j.code === 800) {
          this.stop();
          this._onState && this._onState({ stage: 'expired' });
          return;
        }
        if (j.code !== 801 && j.code !== 802) {
          this.stop();
          this._onState && this._onState({ stage: 'blocked', code: j.code });
          return;
        }
        this._onState && this._onState({ stage: 'wait', code: j.code });
      } catch (e) {
        this._onState && this._onState({ stage: 'error', message: '轮询失败' });
      }
    },
    stop: function () {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    },
  };

  NCM.cookieLogin = async function (cookie) {
    if (!cookie || !/=/i.test(cookie)) throw new Error('Cookie 格式不正确');
    if (!await NCM.setLoggedIn(cookie)) throw new Error('Cookie 无效或已过期');
    return NCM.profile;
  };

  /* ===== 歌单 / 曲目 / 搜索 ===== */
  NCM.myPlaylists = async function (uid) {
    const j = await NCM.get('/user/playlist', { uid: uid || (NCM.profile && NCM.profile.userId), limit: 200 });
    if (j.code !== 200) throw new Error('获取歌单失败');
    return j.playlist || [];
  };

  NCM.playlistTracks = async function (id) {
    const j = await NCM.get('/playlist/track/all', { id, limit: 1000 });
    if (j.code !== 200) throw new Error('获取歌单歌曲失败');
    return j.songs || j.tracks || [];
  };

  NCM.search = async function (keywords, limit = 30) {
    const j = await NCM.get('/cloudsearch', { keywords, limit, type: 1 });
    if (j.code !== 200 || !j.result) throw new Error('搜索失败');
    return (j.result.songs || []).map(normalizeTrack);
  };

  NCM.songUrl = async function (id) {
    // 原样返回 CDN 给的地址（多为 http）：走本机 /proxy 抓取，服务端不受页面混合内容限制，
    // 这里硬升 https 会让 mXXX.music.126.net 的 https 抓不到音源，代理一挂就退回跨域直连 → WebAudio 静音
    const pick = (j) => (j && j.code === 200 && j.data && j.data[0] && j.data[0].url ? String(j.data[0].url) : null);
    /**
     * 每一档重试 3 次。网易云对同一出口 IP 会间歇性回 -460「检测到您的网络环境存在风险」，
     * 同一个请求隔一两百毫秒重发基本就能过；以前一次失败就换下一档、4 档全败就返回 null，
     * 结果就是明明有音源却弹「暂无可用音源」、进度条一动不动。
     */
    const once = async (path, params) => {
      for (let i = 0; i < 3; i++) {
        try {
          const j = await NCM.get(path, params);
          if (j && j.code === 200) return j;   // 200 却没 url = 这档真没音源，交给上层换档，不做无意义重试
        } catch (e) { /* HTTP 400 / -460，重试 */ }
        await new Promise((r) => setTimeout(r, 160 * (i + 1)));
      }
      return null;
    };
    // v1 接口多档位降级：exhigh → higher → standard → lossless
    for (const level of ['exhigh', 'higher', 'standard', 'lossless']) {
      let u = pick(await once('/song/url/v1', { id, level }));
      // 登录态可能早就失效了：带 cookie 全灭时再以游客身份试一次，别让一条过期 cookie 把整首歌唱死
      if (!u) u = pick(await once('/song/url/v1', { id, level, cookie: '' }));
      if (u) return u;
    }
    // 老接口兜底：部分歌曲 v1 全档拿不到（-460 风控），老 /song/url 仍可拿到 128k
    let legacy = pick(await once('/song/url', { id, br: 128000 }));
    if (!legacy) legacy = pick(await once('/song/url', { id, br: 128000, cookie: '' }));
    return legacy;
  };

  NCM.lyric = async function (id) {
    const j = await NCM.get('/lyric', { id });
    if (j.code === 200 && j.lrc && j.lrc.lyric) return j.lrc.lyric;
    return '';
  };

  /* 我喜欢的音乐（收藏） */
  NCM.likedTracks = async function (uid) {
    const uid2 = uid || (NCM.profile && NCM.profile.userId);
    if (!uid2) throw new Error('未登录');
    const j = await NCM.get('/likelist', { uid: uid2 });
    if (j.code !== 200 || !j.ids) throw new Error('获取收藏列表失败');
    const ids = j.ids.slice(0, 1000);
    if (!ids.length) return [];
    const d = await NCM.get('/song/detail', { ids: ids.join(',') });
    if (d.code !== 200 || !d.songs) throw new Error('获取收藏歌曲失败');
    return d.songs.map(normalizeTrack);
  };

  /* 收藏状态缓存（Folia getLikedSongs 带 timestamp 破两分钟缓存） */
  let likeCache = { at: 0, ids: null };

  NCM.likedIds = async function (force) {
    const now = Date.now();
    if (!force && likeCache.ids && now - likeCache.at < 30000) return likeCache.ids;
    const uid = NCM.profile && NCM.profile.userId;
    if (!uid) throw new Error('未登录');
    const j = await NCM.get('/likelist', { uid: uid, timestamp: now });
    if (j.code !== 200 || !j.ids) throw new Error('获取收藏列表失败');
    likeCache = { at: now, ids: new Set(j.ids) };
    return likeCache.ids;
  };

  /* 收藏 / 取消收藏：Folia netease.ts 的 likeSong(id, like) → /like?id=&like= */
  NCM.setLike = async function (id, like) {
    const j = await NCM.get('/like', { id: id, like: like ? 'true' : 'false' });
    if (j.code === 301) throw new Error('请先登录');
    if (j.code !== 200) throw new Error(j.msg || j.message || ('收藏接口返回 ' + (j.code || '?') + '）'));
    if (!likeCache.ids || !likeCache.at) {
      likeCache.at = 0;
    } else if (like) {
      likeCache.ids.add(id);
    } else {
      likeCache.ids.delete(id);
    }
    return j;
  };

  function normalizeTrack(t) {
    const ar = t.ar || t.artists || [];
    return {
      id: t.id,
      name: t.name,
      artists: ar.map((a) => a.name).join(' / '),
      artistsList: ar.map((a) => ({ id: a.id, name: a.name })),
      album: ((t.al || t.album || {}).name || ''),
      pic: ((t.al || t.album || {}).picUrl || ''),
      duration: t.dt || t.duration || 0,
    };
  }

  // 歌手全部歌曲（Folia：eapi /api/v1/artist/songs，失败退 /api/artist/top/song）
  NCM.artistSongs = async function (id, limit = 100) {
    try {
      const j = await NCM.get('/artist/songs', { id, limit, offset: 0, order: 'hot' });
      const list = j.songs || (j.data && j.data.songs) || [];
      return list.map(normalizeTrack);
    } catch (e) { console.warn('artist songs failed', e); }
    return [];
  };

  NCM.normalizeTrack = normalizeTrack;

  window.NCM = NCM;
})();
