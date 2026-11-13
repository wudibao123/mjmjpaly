package com.mjmj.player;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * 网易云音乐 API 代理（Java 实现，对齐 NeteaseCloudMusicApi 调用契约）。
 * 双轨加密：eapi（interface.music.163.com，AES-ECB + header cookie）
 *           weapi（music.163.com，AES-CBC + 匿名合成 cookie）。
 * 各接口加密方式与 Node 版 module/*.js 的 createOption 一致。
 */
public class NcmApi {

    public static final String API_HOST = "https://music.163.com";
    public static final String API_DOMAIN = "https://interface.music.163.com";
    // weapi UA（userAgentMap.weapi.pc）
    private static final String UA_WEAPI =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
    // eapi/api UA（userAgentMap.api.iphone）
    private static final String UA_API =
            "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";
    private static final String ID_XOR_KEY = "3go8&$8*3*3h0k(2)2";
    private static final String BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final String HEX_CHARS = "0123456789ABCDEF";
    private static final Random RAND = new Random();

    private static volatile String anonToken = ""; // MUSIC_A
    private static volatile String deviceId = "";   // 与 MUSIC_A 绑定的固定 deviceId
    private static File dataDirRef;                  // 身份文件目录（ensureAnonToken 时注入）
    private static volatile String nuid = "";        // _ntes_nuid
    private static volatile String wnmcid = "";      // WNMCID
    /** Folia 同款 Cookie 头白名单字段（Be(header) 语义） */
    private static final String[] COOKIE_FIELDS = {
            "osver", "deviceId", "appver", "versioncode", "mobilename", "buildver", "resolution",
            "__csrf", "os", "channel", "requestId", "_ntes_nuid", "_ntes_nnid", "WNMCID", "WEVNSM",
            "__remember_me", "ntes_kaola_ad", "NMTID", "MUSIC_U", "MUSIC_A", "MUSIC_R_U",
            "sDeviceId", "WM_TID", "WM_NI", "WM_NIKE"
    };

    private NcmApi() {}

    // ============ 匿名 token 管理 ============
    public static String getAnonToken() { return anonToken; }
    public static void setAnonToken(String t) { anonToken = t == null ? "" : t; }
    public static String getDeviceId() { return deviceId; }
    public static void setDeviceId(String d) { deviceId = d == null ? "" : d; }

    /**
     * 启动时确保匿名身份：优先用本地缓存（anon_token + device_id 成对），否则重新注册。
     * deviceId 必须与 MUSIC_A 同源（注册时绑定），后续 eapi 请求复用同一 deviceId，
     * 否则网易云返回 400 参数错误。
     */
    public static synchronized void ensureAnonToken(File dataDir) {
        dataDirRef = dataDir;
        File tokFile = new File(dataDir, "anon_token");
        File devFile = new File(dataDir, "device_id");
        if (tokFile.exists() && devFile.exists()) {
            try {
                anonToken = new String(readAllBytes(new FileInputStream(tokFile)), StandardCharsets.UTF_8).trim();
                deviceId = new String(readAllBytes(new FileInputStream(devFile)), StandardCharsets.UTF_8).trim();
            } catch (Exception ignored) {}
        }
        if (anonToken.isEmpty() || deviceId.isEmpty()) {
            try {
                registerAnon(dataDir);
            } catch (Exception e) {
                System.out.println("[MJMJ] 匿名注册失败: " + e.getMessage());
            }
        }
    }

    /** weapi POST /api/register/anonimous 拿 MUSIC_A（weapi 加密已对齐 Node） */
    private static void registerAnon(File dataDir) throws Exception {
        if (deviceId.isEmpty()) deviceId = generateDeviceId();
        String xorId = cloudmusicDllEncodeId(deviceId);
        String username = Base64.getEncoder().encodeToString(
                (deviceId + " " + xorId).getBytes(StandardCharsets.UTF_8));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", username);

        HttpURLConnection conn = openConn(API_HOST + "/weapi/register/anonimous", UA_WEAPI);
        conn.setRequestProperty("Cookie", buildAnonCookie("", false));
        String form = WeapiCrypto.encrypt(MiniJson.stringify(body));
        byte[] b = form.getBytes(StandardCharsets.UTF_8);
        conn.setFixedLengthStreamingMode(b.length);
        try (OutputStream os = conn.getOutputStream()) { os.write(b); }
        int code = conn.getResponseCode();
        String text = readAll(code >= 400 ? conn.getErrorStream() : conn.getInputStream());
        List<String> setCookies = conn.getHeaderFields().get("Set-Cookie");
        String musicA = "";
        if (setCookies != null) {
            for (String sc : setCookies) {
                if (sc.startsWith("MUSIC_A=")) {
                    int end = sc.indexOf(';');
                    musicA = end > 0 ? sc.substring(8, end) : sc.substring(8);
                    break;
                }
            }
        }
        conn.disconnect();
        if (musicA.isEmpty() && code == 200) {
            try {
                Map<String, Object> j = MiniJson.obj(MiniJson.parse(text));
                if (j.containsKey("cookie")) {
                    String c = String.valueOf(j.get("cookie"));
                    int s = c.indexOf("MUSIC_A=");
                    if (s >= 0) {
                        int e = c.indexOf(';', s);
                        musicA = c.substring(s + 8, e > 0 ? e : c.length());
                    }
                }
            } catch (Exception ignored) {}
        }
        if (!musicA.isEmpty()) {
            anonToken = musicA;
            try (FileOutputStream fos = new FileOutputStream(new File(dataDir, "anon_token"))) {
                fos.write(musicA.getBytes(StandardCharsets.UTF_8));
            }
            try (FileOutputStream fos = new FileOutputStream(new File(dataDir, "device_id"))) {
                fos.write(deviceId.getBytes(StandardCharsets.UTF_8));
            }
            System.out.println("[MJMJ] 匿名 token 获取成功");
        } else {
            System.out.println("[MJMJ] 匿名注册未返回 MUSIC_A, code=" + code + ", body=" + truncate(text, 120));
        }
    }

    // ============ 设备身份（对齐 Folia：nuid / wnmcid 持久化，避免每次请求换指纹） ============
    private static synchronized String getOrNewNuid() {
        if (!nuid.isEmpty()) return nuid;
        nuid = readIdentity("ntes_nuid");
        if (nuid.isEmpty()) {
            nuid = randomHex(32).toLowerCase();
            writeIdentity("ntes_nuid", nuid);
        }
        return nuid;
    }

    private static synchronized String getOrNewWnmcid() {
        if (!wnmcid.isEmpty()) return wnmcid;
        wnmcid = readIdentity("wnmcid");
        if (wnmcid.isEmpty()) {
            wnmcid = randomStr(6).toLowerCase() + "." + System.currentTimeMillis() + ".01.0";
            writeIdentity("wnmcid", wnmcid);
        }
        return wnmcid;
    }

    private static String readIdentity(String name) {
        if (dataDirRef == null) return "";
        try {
            File f = new File(dataDirRef, name);
            if (!f.exists()) return "";
            return new String(readAllBytes(new FileInputStream(f)), StandardCharsets.UTF_8).trim();
        } catch (Exception ignored) { return ""; }
    }

    private static void writeIdentity(String name, String v) {
        if (dataDirRef == null) return;
        try (FileOutputStream fos = new FileOutputStream(new File(dataDirRef, name))) {
            fos.write(v.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {}
    }

    // ============ 合成 Cookie ============
    /** weapi 请求 Cookie（匿名 + 登录态合并，iPhone 客户端标识） */
    private static String buildAnonCookie(String userCookie, boolean isLogin) {
        StringBuilder sb = new StringBuilder();
        sb.append("__remember_me=true; ntes_kaola_ad=1; ");
        String nid = getOrNewNuid();
        sb.append("_ntes_nuid=").append(nid).append("; ");
        sb.append("_ntes_nnid=").append(nid).append(",").append(System.currentTimeMillis()).append("; ");
        sb.append("WNMCID=").append(getOrNewWnmcid()).append("; WEVNSM=1.0.0; ");
        sb.append("osver=16.2; deviceId=").append(getOrNewDeviceId()).append("; ");
        sb.append("os=iPhone OS; channel=distribution; appver=9.0.90; ");
        if (!isLogin) sb.append("NMTID=").append(randomHex(16)).append("; ");
        if (anonToken != null && !anonToken.isEmpty()) sb.append("MUSIC_A=").append(anonToken).append("; ");
        if (userCookie != null && !userCookie.isEmpty()) {
            if (!userCookie.endsWith(";")) sb.append(userCookie).append(";");
            else sb.append(userCookie);
        }
        String s = sb.toString();
        return s.endsWith("; ") ? s.substring(0, s.length() - 2) : s;
    }

    /** eapi 请求头 Cookie：把 header 对象按白名单拼成 k=v; k=v（对齐 Folia Be(header)） */
    private static String buildApiHeaderCookie(Map<String, Object> header) {
        StringBuilder sb = new StringBuilder();
        for (String k : COOKIE_FIELDS) {
            Object v = header.get(k);
            if (v == null) continue;
            String s = String.valueOf(v);
            if (s.isEmpty()) continue;
            if (sb.length() > 0) sb.append("; ");
            sb.append(k).append('=').append(s);
        }
        return sb.toString();
    }

    /** eapi data 里的 header 对象（完全对齐 Folia Re()，deviceId 在 header 内） */
    private static Map<String, Object> buildApiHeaderObj(String userCookie, String csrf) {
        Map<String, Object> h = new LinkedHashMap<>();
        h.put("osver", "16.2");
        h.put("deviceId", getOrNewDeviceId());
        h.put("appver", "9.0.90");
        h.put("versioncode", "140");
        h.put("mobilename", "");
        h.put("buildver", String.valueOf(System.currentTimeMillis()).substring(0, 10));
        h.put("resolution", "1920x1080");
        h.put("__csrf", csrf == null ? "" : csrf);
        h.put("os", "iPhone OS");
        h.put("channel", "distribution");
        h.put("requestId", System.currentTimeMillis() + "_" + String.format("%04d", RAND.nextInt(1000)));
        String nid = getOrNewNuid();
        h.put("_ntes_nuid", nid);
        h.put("_ntes_nnid", nid + "," + System.currentTimeMillis());
        h.put("WNMCID", getOrNewWnmcid());
        h.put("WEVNSM", "1.0.0");
        h.put("__remember_me", "true");
        h.put("ntes_kaola_ad", "1");
        String mu = cookieValue(userCookie, "MUSIC_U");
        if (!mu.isEmpty()) h.put("MUSIC_U", mu);
        String cs = cookieValue(userCookie, "__csrf");
        if (!cs.isEmpty()) h.put("__csrf", cs);
        if (anonToken != null && !anonToken.isEmpty()) h.put("MUSIC_A", anonToken);
        return h;
    }

    private static String cookieValue(String cookie, String key) {
        if (cookie == null || cookie.isEmpty()) return "";
        int s = cookie.indexOf(key + "=");
        if (s < 0) return "";
        int e = cookie.indexOf(';', s);
        return cookie.substring(s + key.length() + 1, e > 0 ? e : cookie.length()).trim();
    }

    // ============ 基础请求 ============
    private static HttpURLConnection openConn(String urlStr, String ua) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setRequestProperty("User-Agent", ua);
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        conn.setRequestProperty("Referer", "https://music.163.com");
        conn.setRequestProperty("Origin", "https://music.163.com");
        conn.setRequestProperty("Accept", "*/*");
        conn.setDoOutput(true);
        return conn;
    }

    private static Map<String, Object> postForm(String urlStr, String formBody, String cookieHeader, String ua) throws Exception {
        HttpURLConnection conn = openConn(urlStr, ua);
        if (cookieHeader != null && !cookieHeader.isEmpty()) conn.setRequestProperty("Cookie", cookieHeader);
        byte[] bodyBytes = formBody.getBytes(StandardCharsets.UTF_8);
        conn.setFixedLengthStreamingMode(bodyBytes.length);
        try (OutputStream os = conn.getOutputStream()) { os.write(bodyBytes); }
        int code = conn.getResponseCode();
        InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String text = readAll(is);
        conn.disconnect();
        if (text == null || text.isEmpty()) throw new RuntimeException("API 空响应, code=" + code + ", path=" + urlStr);
        Map<String, Object> parsed;
        try { parsed = MiniJson.obj(MiniJson.parse(text)); } catch (Exception e) {
            throw new RuntimeException("API 响应非 JSON, code=" + code + ", body=" + truncate(text, 200));
        }
        if (parsed == null) throw new RuntimeException("API 响应为空, code=" + code);
        return parsed;
    }

    /** weapi POST（music.163.com/weapi/...） */
    public static Map<String, Object> weapiPost(String path, Map<String, Object> body, String cookie) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        if (body != null) b.putAll(body);
        boolean isLogin = path.contains("login");
        String merged = buildAnonCookie(cookie, isLogin);
        String csrf = extractCsrf(merged);
        if (csrf != null && !csrf.isEmpty() && !b.containsKey("csrf_token")) b.put("csrf_token", csrf);
        String form = WeapiCrypto.encrypt(MiniJson.stringify(b));
        Map<String, Object> r = null;
        Exception last = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                r = postForm(API_HOST + path, form, merged, UA_WEAPI);
                break;
            } catch (Exception e) {
                last = e;
                Thread.sleep(400);
            }
        }
        if (r == null) throw last != null ? last : new RuntimeException("weapi 请求失败: " + path);
        return r;
    }

    /** eapi POST（interface.music.163.com/eapi/...，完全对齐 Folia：header 对象不限 deviceId、不带 e_r） */
    public static Map<String, Object> eapiPost(String path, Map<String, Object> body, String cookie) throws Exception {
        Map<String, Object> data = new LinkedHashMap<>();
        if (body != null) data.putAll(body);
        String csrf = extractCsrf(cookie);
        Map<String, Object> header = buildApiHeaderObj(cookie, csrf);
        data.put("header", header);
        String params = WeapiCrypto.eapi(path, MiniJson.stringify(data));
        String form = "params=" + params;
        String hc = buildApiHeaderCookie(header);
        System.out.println("[EAPI] " + path + " paramsHead=" + params.substring(0, Math.min(48, params.length())) + " cookieHead=" + hc.substring(0, Math.min(80, hc.length())));
        Map<String, Object> r = null;
        Exception last = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                r = postForm(API_DOMAIN + "/eapi/" + path.substring(5), form, hc, UA_API);
                break;
            } catch (Exception e) {
                last = e;
                Thread.sleep(400);
            }
        }
        if (r == null) throw last != null ? last : new RuntimeException("eapi 请求失败: " + path);
        return r;
    }

    private static String extractCsrf(String cookie) {
        if (cookie == null) return null;
        for (String part : cookie.split(";")) {
            String p = part.trim();
            if (p.startsWith("__csrf=")) return p.substring(7);
        }
        return null;
    }

    private static byte[] readAllBytes(InputStream is) throws Exception {
        if (is == null) return new byte[0];
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static String readAll(InputStream is) throws Exception {
        if (is == null) return "";
        return new String(readAllBytes(is), StandardCharsets.UTF_8);
    }

    private static String truncate(String s, int n) {
        return s == null ? "" : (s.length() > n ? s.substring(0, n) : s);
    }

    private static String randomHex(int len) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < len; i++) sb.append(HEX_CHARS.charAt(RAND.nextInt(16)));
        return sb.toString();
    }

    private static String randomStr(int len) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < len; i++) sb.append(BASE62.charAt(RAND.nextInt(BASE62.length())));
        return sb.toString();
    }

    private static String generateDeviceId() {
        return randomHex(52);
    }

    /** 固定 deviceId：与匿名注册绑定（无则先建），保证 eapi 请求的 deviceId 与 MUSIC_A 同源 */
    private static synchronized String getOrNewDeviceId() {
        if (deviceId.isEmpty()) deviceId = generateDeviceId();
        return deviceId;
    }

    private static String cloudmusicDllEncodeId(String id) {
        StringBuilder xor = new StringBuilder();
        for (int i = 0; i < id.length(); i++) {
            xor.append((char) (id.charAt(i) ^ ID_XOR_KEY.charAt(i % ID_XOR_KEY.length())));
        }
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(xor.toString().getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(digest);
        } catch (Exception e) {
            return "";
        }
    }

    // ============ 接口实现（crypto 分流与 Node 版 module/*.js 一致） ============

    /** weapi /api/login/qrcode/unikey → {code, data:{unikey}}（与电脑端 login_qr_key 同源，不用 eapi） */
    public static Map<String, Object> loginQrKey() {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("type", 3L);
            return weapiPost("/weapi/login/qrcode/unikey", body, null);
        } catch (Exception e) { return err(e); }
    }

    /** 本地生成二维码登录 URL（Node login_qr_create 不发请求） */
    public static Map<String, Object> loginQrCreate(String key) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("qrurl", "https://music.163.com/login?codekey=" + key);
        data.put("qrimg", null);
        Map<String, Object> ok = new LinkedHashMap<>();
        ok.put("code", 200L);
        ok.put("data", data);
        return ok;
    }

    /**
     * 扫码轮询：与电脑端 NeteaseCloudMusicApi 的 login_qr_check 同源 ——
     * weapi POST /api/login/qrcode/client/login，data {key, type:3}，UA 用 weapi 那套。
     * 之前走 eapi（interface.music.163.com）返回「登录状态无效」，就是这里与电脑端不一致。
     */
    public static Map<String, Object> loginQrCheck(String key, String cookie) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("key", key);
            body.put("type", 3L);
            Map<String, Object> r = weapiPost("/weapi/login/qrcode/client/login", body, cookie);
            Object ck = r.get("cookie");
            if (ck == null) ck = r.get("cookies");
            if (ck instanceof List) {
                List<?> list = (List<?>) ck;
                StringBuilder joined = new StringBuilder();
                for (Object c : list) { if (joined.length() > 0) joined.append(";"); joined.append(c); }
                r.put("cookie", joined.toString());
            }
            return r;
        } catch (Exception e) { return err(e); }
    }

    /** weapi /api/w/nuser/account/get → {code:200, data:{profile}}（兼容 profile/account 两种结构） */
    public static Map<String, Object> loginStatus(String cookie) {
        String[] paths = {"/weapi/w/nuser/account/get", "/weapi/nuser/account/get"};
        for (String path : paths) {
            try {
                Map<String, Object> j = weapiPost(path, new LinkedHashMap<>(), cookie);
                Map<String, Object> ok = shapeLogin(j);
                if (ok != null) return ok;
            } catch (Exception ignored) {}
        }
        // eapi 兜底（不吃 csrf，部分账号 cookie 无 __csrf 时 weapi 会判匿名）
        try {
            Map<String, Object> j = eapiPost("/api/w/nuser/account/get", new LinkedHashMap<>(), cookie);
            Map<String, Object> ok = shapeLogin(j);
            if (ok != null) return ok;
        } catch (Exception ignored) {}
        Map<String, Object> no = new LinkedHashMap<>();
        no.put("code", 200L);
        no.put("data", null);
        return no;
    }

    /** 把 account/get 的原始响应规整成 {code:200,data:{profile,account}}；无用户 id 时返回 null */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> shapeLogin(Map<String, Object> j) {
        if (j == null) return null;
        Object prof = j.get("profile");
        Object acc = j.get("account");
        Object root = j.get("root");
        long id = pickId(prof);
        if (id == 0) id = pickId(acc);
        if (id == 0) id = pickId(root);
        if (id == 0) return null;
        Map<String, Object> profile;
        if (prof instanceof Map) {
            profile = new LinkedHashMap<>((Map<String, Object>) prof);
        } else {
            profile = new LinkedHashMap<>();
            if (acc instanceof Map) {
                Map<String, Object> am = (Map<String, Object>) acc;
                profile.put("userId", am.containsKey("id") ? am.get("id") : am.get("userId"));
                if (am.containsKey("userName")) profile.put("nickname", am.get("userName"));
            }
        }
        if (!profile.containsKey("userId")) profile.put("userId", id);
        if (!profile.containsKey("nickname")) profile.put("nickname", "网易云用户");
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("profile", profile);
        if (acc != null) data.put("account", acc);
        Map<String, Object> ok = new LinkedHashMap<>();
        ok.put("code", 200L);
        ok.put("data", data);
        return ok;
    }

    /** 从 profile/account/root 里挑出用户 id */
    private static long pickId(Object o) {
        if (!(o instanceof Map)) return 0;
        Map<String, Object> m = (Map<String, Object>) o;
        for (String k : new String[]{"userId", "user_id", "id", "accountId"}) {
            Object v = m.get(k);
            if (v != null && !String.valueOf(v).isEmpty()) {
                try { return Long.parseLong(String.valueOf(v).replaceAll("[^0-9]", "")); } catch (Exception ignored) {}
            }
        }
        if (m.get("account") instanceof Map) return pickId(m.get("account"));
        return 0;
    }

    /** eapi /api/v1/artist/songs → 歌手全部歌曲（Folia gl()） */
    public static Map<String, Object> artistSongs(String artistId, int limit, int offset, String cookie) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("id", artistId);
            body.put("order", "hot");
            body.put("limit", (long) limit);
            body.put("offset", (long) offset);
            Map<String, Object> r = eapiPost("/api/v1/artist/songs", body, cookie);
            if (!"200".equals(String.valueOf(r.get("code")))) {
                // 兜底：热门 50 首
                Map<String, Object> b2 = new LinkedHashMap<>();
                b2.put("id", artistId);
                r = eapiPost("/api/artist/top/song", b2, cookie);
            }
            return r;
        } catch (Exception e) { return err(e); }
    }

    /** eapi /api/logout → {code:200} */
    public static Map<String, Object> logout(String cookie) {
        try {
            return eapiPost("/api/logout", new LinkedHashMap<>(), cookie);
        } catch (Exception e) { return err(e); }
    }

    /** weapi /api/user/playlist → {code:200, playlist:[...]} */
    public static Map<String, Object> userPlaylist(String uid, long limit, String cookie) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            if (uid != null) body.put("uid", Long.parseLong(uid));
            body.put("limit", limit);
            body.put("offset", 0L);
            body.put("includeVideo", Boolean.TRUE);
            Map<String, Object> j = weapiPost("/weapi/user/playlist", body, cookie);
            if (j.containsKey("playlist")) {
                Map<String, Object> ok = new LinkedHashMap<>();
                ok.put("code", 200L);
                ok.put("playlist", j.get("playlist"));
                return ok;
            }
            return j;
        } catch (Exception e) { return err(e); }
    }

    /** eapi 两步：/api/v6/playlist/detail → trackIds → /api/v3/song/detail → {code:200, songs} */
    public static Map<String, Object> playlistTrackAll(String id, long limit, String cookie) {
        try {
            Map<String, Object> d1 = new LinkedHashMap<>();
            d1.put("id", Long.parseLong(id));
            d1.put("n", 100000L);
            d1.put("s", 8L);
            Map<String, Object> j1 = eapiPost("/api/v6/playlist/detail", d1, cookie);
            List<?> trackIds = null;
            if (j1.containsKey("playlist") && j1.get("playlist") instanceof Map) {
                Object t = MiniJson.obj(j1.get("playlist")).get("trackIds");
                if (t instanceof List) trackIds = (List<?>) t;
            }
            if (trackIds == null) throw new RuntimeException("歌单 trackIds 为空");
            StringBuilder c = new StringBuilder("[");
            int total = 0;
            for (Object o : trackIds) {
                if (total >= limit) break;
                if (total > 0) c.append(",");
                long tid = Long.parseLong(String.valueOf(MiniJson.obj(o).get("id")));
                c.append("{\"id\":").append(tid).append("}");
                total++;
            }
            c.append("]");
            Map<String, Object> d2 = new LinkedHashMap<>();
            d2.put("c", c.toString());
            Map<String, Object> j2 = eapiPost("/api/v3/song/detail", d2, cookie);
            if (j2.containsKey("songs") && j2.get("songs") instanceof List) {
                Map<String, Object> ok = new LinkedHashMap<>();
                ok.put("code", 200L);
                ok.put("songs", j2.get("songs"));
                return ok;
            }
            return j2;
        } catch (Exception e) { return err(e); }
    }

    /** eapi /api/cloudsearch/pc → {code, result:{songs}} */
    public static Map<String, Object> cloudsearch(String keywords, long limit) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("s", keywords);
            body.put("type", 1L);
            body.put("limit", limit);
            body.put("offset", 0L);
            body.put("total", Boolean.TRUE);
            return eapiPost("/api/cloudsearch/pc", body, null);
        } catch (Exception e) { return err(e); }
    }

    /** eapi /api/song/enhance/player/url/v1 → {code:200, data:[{url}]} */
    public static Map<String, Object> songUrlV1(String id, String level, String cookie) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("ids", "[" + id + "]");
            body.put("level", level);
            body.put("encodeType", "flac");
            if ("sky".equals(level)) body.put("immerseType", "c51");
            Map<String, Object> j = eapiPost("/api/song/enhance/player/url/v1", body, cookie);
            if (j.containsKey("data") && j.get("data") instanceof List) {
                Map<String, Object> ok = new LinkedHashMap<>();
                ok.put("code", 200L);
                ok.put("data", j.get("data"));
                return ok;
            }
            return j;
        } catch (Exception e) { return err(e); }
    }

    /** eapi /api/song/enhance/player/url → {code:200, data:[{url}]} */
    public static Map<String, Object> songUrl(String id, long br, String cookie) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("ids", "[\"" + id + "\"]");
            body.put("br", br);
            Map<String, Object> j = eapiPost("/api/song/enhance/player/url", body, cookie);
            if (j.containsKey("data") && j.get("data") instanceof List) {
                Map<String, Object> ok = new LinkedHashMap<>();
                ok.put("code", 200L);
                ok.put("data", j.get("data"));
                return ok;
            }
            return j;
        } catch (Exception e) { return err(e); }
    }

    /** eapi /api/song/lyric → {code:200, lrc:{lyric}} */
    public static Map<String, Object> lyric(String id) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("id", Long.parseLong(id));
            body.put("tv", -1L);
            body.put("lv", -1L);
            body.put("rv", -1L);
            body.put("kv", -1L);
            body.put("_nmclfl", 1L);
            Map<String, Object> j = eapiPost("/api/song/lyric", body, null);
            if (j.containsKey("lrc")) {
                Map<String, Object> ok = new LinkedHashMap<>();
                ok.put("code", 200L);
                ok.put("lrc", j.get("lrc"));
                return ok;
            }
            return j;
        } catch (Exception e) { return err(e); }
    }

    /** 是否已登录：只有 cookie 里带 MUSIC_U 才算登录，匿名 MUSIC_A 不算（匿名身份调写接口会被网易云风控） */
    public static boolean isLoggedIn(String cookie) {
        if (cookie == null || cookie.isEmpty()) return false;
        for (String part : cookie.split(";")) {
            String p = part.trim();
            if (p.startsWith("MUSIC_U=") && p.length() > "MUSIC_U=".length()) return true;
        }
        return false;
    }

    /** eapi /api/song/like/get → {code:200, ids:[...]} */
    public static Map<String, Object> likelist(String uid, String cookie) {
        try {
            if (!isLoggedIn(cookie)) return notLoggedIn();
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("uid", Long.parseLong(uid));
            Map<String, Object> j = eapiPost("/api/song/like/get", body, cookie);
            if (j.containsKey("ids") && j.get("ids") instanceof List) {
                Map<String, Object> ok = new LinkedHashMap<>();
                ok.put("code", 200L);
                ok.put("ids", j.get("ids"));
                return ok;
            }
            return j;
        } catch (Exception e) { return err(e); }
    }

    /** eapi /api/song/like → {code:200}（收藏 / 取消收藏，与 likelist 同一族接口） */
    public static Map<String, Object> like(String id, boolean like, String cookie) {
        try {
            /* 必须带登录态（MUSIC_U）才能写：拿匿名 MUSIC_A 去打 like，网易云会当成异常客户端直接风控，
               这一步与电脑端一致——电脑端也只有登录后才发得出去 */
            if (!isLoggedIn(cookie)) return notLoggedIn();
            if (id == null || id.isEmpty()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("code", 400L);
                m.put("msg", "缺少歌曲 id");
                return m;
            }
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("trackId", Long.parseLong(id));
            body.put("like", like);
            return eapiPost("/api/song/like", body, cookie);
        } catch (Exception e) { return err(e); }
    }

    /** 未登录统一回包（301：前端据此提示登录，且不发网络请求） */
    private static Map<String, Object> notLoggedIn() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", 301L);
        m.put("msg", "未登录");
        return m;
    }

    /** weapi /api/v3/song/detail → {code:200, songs:[...]} */
    public static Map<String, Object> songDetail(String ids, String cookie) {
        try {
            StringBuilder c = new StringBuilder("[");
            String[] parts = ids.split(",");
            for (int i = 0; i < parts.length; i++) {
                if (i > 0) c.append(",");
                c.append("{\"id\":").append(parts[i].trim()).append("}");
            }
            c.append("]");
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("c", c.toString());
            Map<String, Object> j = weapiPost("/weapi/v3/song/detail", body, cookie);
            if (j.containsKey("songs") && j.get("songs") instanceof List) {
                Map<String, Object> ok = new LinkedHashMap<>();
                ok.put("code", 200L);
                ok.put("songs", j.get("songs"));
                return ok;
            }
            return j;
        } catch (Exception e) { return err(e); }
    }

    /** GET /api/qr-image?url= → {ok:true, data:"data:image/png;base64,..."} */
    public static Map<String, Object> qrImage(String url) {
        Map<String, Object> ok = new LinkedHashMap<>();
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("User-Agent", UA_WEAPI);
            conn.setRequestProperty("Referer", API_HOST);
            int code = conn.getResponseCode();
            if (code >= 400) throw new RuntimeException("qr 图片下载失败 HTTP " + code);
            InputStream is = conn.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            is.close();
            String ctype = conn.getContentType();
            conn.disconnect();
            String b64 = Base64.getEncoder().encodeToString(bos.toByteArray());
            String mime = ctype != null && ctype.contains("jpeg") ? "image/jpeg" : "image/png";
            ok.put("ok", Boolean.TRUE);
            ok.put("data", "data:" + mime + ";base64," + b64);
            return ok;
        } catch (Exception e) {
            ok.put("ok", Boolean.FALSE);
            ok.put("error", String.valueOf(e.getMessage()));
            return ok;
        }
    }

    private static Map<String, Object> err(Exception e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", 500L);
        m.put("error", String.valueOf(e.getMessage()));
        return m;
    }

    /** 打开音频流（/proxy 用）：携带防盗链头 + Range */
    public static HttpURLConnection openProxy(String urlStr, String range) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        conn.setRequestProperty("User-Agent", UA_WEAPI);
        conn.setRequestProperty("Referer", "https://music.163.com");
        conn.setRequestProperty("Origin", "https://music.163.com");
        if (range != null) conn.setRequestProperty("Range", range);
        conn.setInstanceFollowRedirects(true);
        return conn;
    }
}
