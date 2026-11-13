package com.mjmj.player;

import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * MJMJ 手机版本地 HTTP 服务器（纯 Java，无任何依赖）。
 * 静态资源 + /api/* 网易云代理 + /proxy 音频代理 + /auth 登录态持久化。
 * 手机 WebView 加载 http://127.0.0.1:31999 同源访问，浏览器 CORS 限制天然被绕过。
 */
public class LocalServer {

    public static final int DEFAULT_PORT = 31999;

    private final String webRoot;
    private final File dataDir;
    private final int port;
    private ExecutorService pool;
    /** 是否允许局域网其他设备访问（默认关；开启后浏览器可打开本播放器） */
    private volatile boolean lanAllowed = false;

    public LocalServer(String webRoot, String dataDir, int port) {
        this.webRoot = webRoot;
        this.dataDir = new File(dataDir);
        this.port = port;
        if (!this.dataDir.exists()) this.dataDir.mkdirs();
        loadLan();
    }

    private void loadLan() {
        try {
            File f = new File(dataDir, "lan.json");
            if (!f.exists()) return;
            byte[] buf = new byte[(int) f.length()];
            try (FileInputStream fis = new FileInputStream(f)) { fis.read(buf); }
            Map<String, Object> m = MiniJson.obj(MiniJson.parse(new String(buf, StandardCharsets.UTF_8)));
            if (m != null) lanAllowed = Boolean.TRUE.equals(m.get("allowed")) || "true".equals(String.valueOf(m.get("allowed")));
        } catch (Exception ignored) {}
    }

    private void saveLan() {
        try (FileOutputStream fos = new FileOutputStream(new File(dataDir, "lan.json"))) {
            fos.write(("{\"allowed\":" + (lanAllowed ? "true" : "false") + "}").getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {}
    }

    /** 本机所有网卡的局域网地址（用于设置页展示） */
    private java.util.List<String> lanUrls() {
        java.util.List<String> urls = new java.util.ArrayList<>();
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            for (NetworkInterface ni : Collections.list(nis)) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress ia : Collections.list(ni.getInetAddresses())) {
                    if (!ia.isLoopbackAddress() && ia.getHostAddress() != null
                            && !ia.getHostAddress().startsWith("fe80")) {
                        urls.add("http://" + ia.getHostAddress() + ":" + port);
                    }
                }
            }
        } catch (Exception ignored) {}
        return urls;
    }

    public int getPort() { return port; }

    public void start() throws Exception {
        start(null);
    }

    /** onReady 在 ServerSocket 真正 listen 成功之后回调；start 本身随后阻塞在 accept 循环里 */
    public void start(Runnable onReady) throws Exception {
        NcmApi.ensureAnonToken(dataDir);
        ServerSocket ss = new ServerSocket(port, 64, java.net.InetAddress.getByName("0.0.0.0"));
        pool = Executors.newFixedThreadPool(8);
        System.out.println("[MJMJ] HTTP 服务已启动: http://127.0.0.1:" + port);
        if (onReady != null) {
            try { onReady.run(); } catch (Throwable ignored) {}
        }
        while (true) {
            Socket s = ss.accept();
            pool.submit(() -> handle(s));
        }
    }

    private void handle(Socket s) {
        try (Socket sock = s;
             OutputStream raw = sock.getOutputStream();
             BufferedOutputStream out = new BufferedOutputStream(raw)) {
            sock.setSoTimeout(30000);
            BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.ISO_8859_1));
            String line = in.readLine();
            if (line == null) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String target = parts[1];
            int qIdx = target.indexOf('?');
            String path = qIdx >= 0 ? target.substring(0, qIdx) : target;
            Map<String, String> query = parseQuery(qIdx >= 0 ? target.substring(qIdx + 1) : "");

            Map<String, String> headers = new LinkedHashMap<>();
            String h;
            int bodyLen = 0;
            while ((h = in.readLine()) != null && !h.isEmpty()) {
                int c = h.indexOf(':');
                if (c > 0) {
                    String name = h.substring(0, c).trim().toLowerCase();
                    String value = h.substring(c + 1).trim();
                    headers.put(name, value);
                    if (name.equals("content-length")) bodyLen = Integer.parseInt(value);
                }
            }
            String body = "";
            if (bodyLen > 0) {
                char[] buf = new char[Math.min(bodyLen, 1 << 20)];
                int n = in.read(buf, 0, buf.length);
                if (n > 0) body = new String(buf, 0, n);
            }

            boolean local = sock.getInetAddress() != null && sock.getInetAddress().isLoopbackAddress();
            dispatch(method, path, query, headers, body, out, local);
        } catch (Exception e) {
            // 连接异常静默处理（客户端断开等）
        }
    }

    private void dispatch(String method, String path, Map<String, String> query, Map<String, String> headers,
                          String body, BufferedOutputStream out, boolean local) throws Exception {
        String cookie = query.getOrDefault("cookie", "");

        // ===== 局域网开关 =====
        if (path.equals("/lan")) {
            String allow = query.get("allow");
            if (allow != null) { lanAllowed = "1".equals(allow) || "true".equals(allow); saveLan(); }
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("ok", Boolean.TRUE);
            r.put("allowed", lanAllowed);
            r.put("urls", lanUrls());
            writeJson(out, r);
            return;
        }
        // 门禁：未开启时，非本机来源一律 403（本机 WebView 不受影响）
        if (!lanAllowed && !local) {
            writeStatus(out, "403 Forbidden", "text/plain; charset=utf-8",
                    "本机未允许其他设备访问：请在灵动岛「设置」中打开“允许其他设备访问”".getBytes(StandardCharsets.UTF_8));
            return;
        }

        // ===== 登录态持久化 =====
        if (path.equals("/auth/load") && method.equals("GET")) {
            writeJson(out, loadAuth());
            return;
        }
        if (path.equals("/auth/save") && method.equals("POST")) {
            saveAuth(body);
            writeJson(out, mapOf("ok", Boolean.TRUE));
            return;
        }
        if (path.equals("/auth/clear") && method.equals("POST")) {
            File f = new File(dataDir, "auth.json");
            if (f.exists()) f.delete();
            writeJson(out, mapOf("ok", Boolean.TRUE));
            return;
        }

        // ===== 网易云 API 代理 =====
        if (path.startsWith("/api/")) {
            handleApi(path, query, cookie, out);
            return;
        }

        // ===== 音频代理 =====
        if (path.equals("/proxy")) {
            String url = query.get("url");
            if (url != null) proxyStream(url, headers.getOrDefault("range", null), out);
            else writeJson(out, mapOf("code", 400L, "error", "missing url"));
            return;
        }

        // ===== 自检页：手机浏览器打开 http://127.0.0.1:31999/diag 看二维码/音源/代理真实结果 =====
        if (path.equals("/diag")) {
            writeDiag(cookie, out);
            return;
        }

        // ===== 手机系统壁纸（"透出桌面"模式的数据源，由 MainActivity 抽取到 dataDir/wallpaper） =====
        if (path.equals("/wallpaper")) {
            File wp = new File(dataDir, "wallpaper");
            if (wp.exists() && wp.length() > 0) {
                byte[] b = readFile(wp);
                writeHead(out, 200, "OK", "image/jpeg", b.length, "no-cache");
                out.write(b);
                out.flush();
            } else {
                writeJson(out, mapOf("ok", Boolean.FALSE));
            }
            return;
        }

        // ===== 静态资源 =====
        serveStatic(path, out);
    }

    private void handleApi(String path, Map<String, String> q, String cookie, BufferedOutputStream out) throws Exception {
        Map<String, Object> r;
        switch (path) {
            case "/api/login/qr/key":
                r = NcmApi.loginQrKey();
                break;
            case "/api/login/qr/create":
                r = NcmApi.loginQrCreate(q.get("key"));
                break;
            case "/api/login/qr/check":
                r = NcmApi.loginQrCheck(q.get("key"), cookie);
                break;
            case "/api/login/status":
                r = NcmApi.loginStatus(cookie);
                break;
            case "/api/logout":
                r = NcmApi.logout(cookie);
                break;
            case "/api/user/playlist":
                r = NcmApi.userPlaylist(q.get("uid"), longOf(q.get("limit"), 200L), cookie);
                break;
            case "/api/playlist/track/all":
                r = NcmApi.playlistTrackAll(q.get("id"), longOf(q.get("limit"), 1000L), cookie);
                break;
            case "/api/cloudsearch":
                r = NcmApi.cloudsearch(q.getOrDefault("keywords", ""), longOf(q.get("limit"), 30L));
                break;
            case "/api/song/url/v1":
                r = NcmApi.songUrlV1(q.get("id"), q.getOrDefault("level", "standard"), cookie);
                break;
            case "/api/song/url":
                r = NcmApi.songUrl(q.get("id"), longOf(q.get("br"), 128000L), cookie);
                break;
            case "/api/lyric":
                r = NcmApi.lyric(q.get("id"));
                break;
            case "/api/likelist":
                r = NcmApi.likelist(q.get("uid"), cookie);
                break;
            case "/api/like":
                r = NcmApi.like(q.get("id"), "true".equals(q.get("like")), cookie);
                break;
            case "/api/song/detail":
                r = NcmApi.songDetail(q.get("ids"), cookie);
                break;
            case "/api/qr-image":
                r = NcmApi.qrImage(q.get("url"));
                break;
            case "/api/artist/songs":
                r = NcmApi.artistSongs(q.get("id"), (int) longOf(q.get("limit"), 50L), (int) longOf(q.get("offset"), 0L), cookie);
                break;
            default:
                r = mapOf("code", 404L, "error", "unknown api: " + path);
        }
        writeJson(out, r);
    }

    // ============ 静态资源 ============
    private void serveStatic(String path, BufferedOutputStream out) throws Exception {
        String rel;
        if (path.equals("/")) rel = "index.html";
        else if (path.equals("/favicon.ico")) rel = "assets/icon/mjmj.ico";
        else rel = path.substring(1);
        File f = new File(webRoot, rel);
        if (!f.exists() || !f.isFile()) {
            writeStatus(out, "404 Not Found", "text/plain; charset=utf-8", "not found".getBytes(StandardCharsets.UTF_8));
            return;
        }
        String mime = mimeOf(rel);
        byte[] data = readFile(f);
        String extra = "no-cache";
        writeHead(out, 200, "OK", mime, data.length, extra);
        out.write(data);
        out.flush();
    }

    private String mimeOf(String rel) {
        if (rel.endsWith(".html")) return "text/html; charset=utf-8";
        if (rel.endsWith(".css")) return "text/css; charset=utf-8";
        if (rel.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (rel.endsWith(".json")) return "application/json; charset=utf-8";
        if (rel.endsWith(".png")) return "image/png";
        if (rel.endsWith(".jpg") || rel.endsWith(".jpeg")) return "image/jpeg";
        if (rel.endsWith(".svg")) return "image/svg+xml";
        if (rel.endsWith(".ico")) return "image/x-icon";
        if (rel.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    // ============ 音频代理 ============
    private static String escapeHtml(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /** 自检页：手机浏览器打开 http://127.0.0.1:31999/diag 直接看二维码/音源/直连链路的真实结果 */
    private void writeDiag(String cookie, BufferedOutputStream out) throws Exception {
        StringBuilder sb = new StringBuilder();
        sb.append("登录 cookie: ").append(cookie == null || cookie.isEmpty() ? "无" : "有")
          .append(" / anon_token: ").append(new File(dataDir, "anon_token").exists() ? "有" : "无")
          .append(" / device_id: ").append(new File(dataDir, "device_id").exists() ? "有" : "无")
          .append(" / wallpaper: ").append(new File(dataDir, "wallpaper").exists() ? "有" : "无")
          .append("\n\n[1] QR key\n");
        try {
            sb.append("   ").append(NcmApi.loginQrKey().toString()).append("\n");
        } catch (Throwable t) { sb.append("   异常: ").append(t).append("\n"); }

        sb.append("\n[2] song/url/v1 id=347230 level=standard\n");
        String audioUrl = null;
        try {
            Map<String, Object> r = NcmApi.songUrlV1("347230", "standard", cookie);
            sb.append("   code=").append(r.get("code"));
            Object data = r.get("data");
            if (data instanceof java.util.List && !((java.util.List<?>) data).isEmpty()) {
                Object first = ((java.util.List<?>) data).get(0);
                if (first instanceof Map) {
                    Object u = ((Map<?, ?>) first).get("url");
                    if (u != null) { audioUrl = String.valueOf(u); sb.append("\n   url=").append(audioUrl); }
                    else sb.append("\n   url=null（该曲无版权或需 VIP）");
                }
            }
            sb.append("\n");
        } catch (Throwable t) { sb.append("   异常: ").append(t).append("\n"); }

        sb.append("\n[3] 音源直连探测（前端直连播放用的就是这条 URL）\n");
        if (audioUrl != null) {
            HttpURLConnection c = null;
            try {
                c = NcmApi.openProxy(audioUrl, "bytes=0-1023");
                sb.append("   HTTP ").append(c.getResponseCode())
                  .append(" / type=").append(c.getContentType())
                  .append(" / len=").append(c.getContentLengthLong()).append("\n");
            } catch (Throwable t) { sb.append("   异常: ").append(t).append("\n"); }
            finally { if (c != null) c.disconnect(); }
        } else {
            sb.append("   跳过（没拿到音源 URL）\n");
        }

        String html = "<!doctype html><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>MJMJ 自检</title>"
                + "<style>body{margin:0;padding:16px;background:#0b0f18;color:#eaeef7;"
                + "font:15px/1.75 -apple-system,'PingFang SC',sans-serif}"
                + "h1{font-size:18px;margin:0 0 12px}pre{white-space:pre-wrap;word-break:break-all;"
                + "background:#141a26;padding:14px;border-radius:12px;font-size:13px}</style>"
                + "<h1>MJMJ 自检</h1><pre>" + escapeHtml(sb.toString()) + "</pre>";
        byte[] b = html.getBytes(StandardCharsets.UTF_8);
        writeHead(out, 200, "OK", "text/html; charset=utf-8", b.length, "no-cache");
        out.write(b);
        out.flush();
    }

    private void proxyStream(String url, String range, BufferedOutputStream out) {
        HttpURLConnection conn = null;
        try {
            conn = NcmApi.openProxy(url, range);
            int code = conn.getResponseCode();
            String ctype = conn.getContentType();
            long len = conn.getContentLengthLong();
            String cRange = conn.getHeaderField("Content-Range");
            String aRange = conn.getHeaderField("Accept-Ranges");
            String resp = code == 206 ? "206 Partial Content" : (code >= 400 ? code + " Error" : "200 OK");
            StringBuilder head = new StringBuilder();
            head.append("HTTP/1.1 ").append(resp).append("\r\n")
                    .append("Content-Type: ").append(ctype != null ? ctype : "audio/mpeg").append("\r\n")
                    .append(len > 0 ? "Content-Length: " + len + "\r\n" : "")
                    .append("Accept-Ranges: ").append(aRange != null ? aRange : "bytes").append("\r\n")
                    .append(cRange != null ? "Content-Range: " + cRange + "\r\n" : "")
                    .append("Cache-Control: no-cache\r\n")
                    .append("Connection: close\r\n\r\n");
            out.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (code >= 400) {
                InputStream es = conn.getErrorStream();
                if (es != null) { byte[] b = new byte[1024]; int n; while ((n = es.read(b)) > 0) out.write(b, 0, n); }
                out.flush();
                return;
            }
            InputStream is = conn.getInputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            is.close();
            out.flush();
        } catch (Exception e) {
            try { out.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1)); out.flush(); } catch (Exception ignored) {}
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ============ 工具 ============
    private Map<String, Object> loadAuth() {
        Map<String, Object> ok = new LinkedHashMap<>();
        File f = new File(dataDir, "auth.json");
        if (f.exists()) {
            try {
                Map<String, Object> data = MiniJson.obj(MiniJson.parse(readFileStr(f)));
                ok.put("ok", Boolean.TRUE);
                ok.put("data", data);
                return ok;
            } catch (Exception e) {
                ok.put("ok", Boolean.FALSE);
                ok.put("error", String.valueOf(e.getMessage()));
                return ok;
            }
        }
        ok.put("ok", Boolean.TRUE);
        ok.put("data", null);
        return ok;
    }

    private void saveAuth(String body) {
        try {
            Map<String, Object> j = MiniJson.obj(MiniJson.parse(body));
            String cookie = MiniJson.str(j, "cookie");
            if (cookie == null) return;
            File f = new File(dataDir, "auth.json");
            byte[] data = body.getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream fos = new FileOutputStream(f)) { fos.write(data); }
        } catch (Exception ignored) {}
    }

    private void writeJson(OutputStream out, Map<String, Object> obj) throws Exception {
        byte[] data = MiniJson.stringify(obj).getBytes(StandardCharsets.UTF_8);
        writeStatus(out, "200 OK", "application/json; charset=utf-8", data);
    }

    private void writeStatus(OutputStream out, String status, String ctype, byte[] body) throws Exception {
        String head = "HTTP/1.1 " + status + "\r\n"
                + "Content-Type: " + ctype + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-cache\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.flush();
    }

    private void writeHead(OutputStream out, int code, String reason, String ctype, long len, String extra) throws Exception {
        String head = "HTTP/1.1 " + code + " " + reason + "\r\n"
                + "Content-Type: " + ctype + "\r\n"
                + "Content-Length: " + len + "\r\n"
                + "Cache-Control: " + extra + "\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
    }

    private static Map<String, String> parseQuery(String qs) {
        Map<String, String> m = new LinkedHashMap<>();
        if (qs == null || qs.isEmpty()) return m;
        for (String kv : qs.split("&")) {
            int eq = kv.indexOf('=');
            if (eq > 0) {
                try {
                    m.put(URLDecoder.decode(kv.substring(0, eq), "UTF-8"),
                            URLDecoder.decode(kv.substring(eq + 1), "UTF-8"));
                } catch (Exception ignored) {}
            }
        }
        return m;
    }

    private static Map<String, Object> mapOf(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static long longOf(String s, long def) {
        try { return Long.parseLong(s); } catch (Exception e) { return def; }
    }

    private static byte[] readFile(File f) throws Exception {
        try (InputStream is = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int off = 0;
            while (off < buf.length) {
                int n = is.read(buf, off, buf.length - off);
                if (n < 0) break;
                off += n;
            }
            return buf;
        }
    }

    private static String readFileStr(File f) throws Exception {
        return new String(readFile(f), StandardCharsets.UTF_8);
    }

    // ============ 本机验证入口（Windows 上直接 java -cp 运行） ============
    public static void main(String[] args) throws Exception {
        String webRoot = args.length > 0 ? args[0] : "renderer";
        String dataDir = args.length > 1 ? args[1] : ".mjmj-data";
        new LocalServer(webRoot, dataDir, DEFAULT_PORT).start();
    }
}
