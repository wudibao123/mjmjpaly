package com.mjmj.player;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/**
 * MJMJ 手机版主界面：
 * 1. 纯 Java 本地 HTTP 服务器跑在手机本机 127.0.0.1:31999（WebView 同源加载，无 CORS）
 * 2. 沉浸式横屏（隐藏系统栏 + 常亮）
 * 3. 挖孔屏/水滴屏：SHORT_EDGES 扩展到挖孔区，页面用 viewport-fit=cover + env(safe-area-inset-*)
 * 4. "透出桌面"：抽取系统壁纸到 dataDir/wallpaper，前端经 /wallpaper 加载
 * 5. "选择图片作为背景"：实现 onShowFileChooser 打开系统相册
 */
public class MainActivity extends Activity {
    private static final int REQ_FILE_CHOOSER = 0x1001;
    private static final int REQ_MEDIA_PERM = 0x1002;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri pendingCameraUri;
    private int loadRetry = 0;      // 首页加载失败重试次数（服务未就绪时兜底）

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupImmersive();

        // 系统壁纸抽取（"透出桌面"用）
        ensureMediaPermission();
        captureWallpaper();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 去除浏览器痕迹：滚动条、过度滚动光晕、长按选择
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setLongClickable(false);
        webView.setHapticFeedbackEnabled(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        webView.setWebViewClient(new WebViewClient() {
            // API < 23
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.startsWith(homeUrl())) retryHome();
            }

            // API >= 23
            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest req,
                                        android.webkit.WebResourceError err) {
                if (req != null && req.isForMainFrame()) retryHome();
            }
        });
        // 相册选择：WebView 里 <input type="file"> 必须实现 onShowFileChooser 才会弹系统选择器
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*");
                    startActivityForResult(Intent.createChooser(intent, "选择图片"), REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });
        setContentView(webView);

        // 资源解压 + 本地服务启动放到 WebView 建好之后：服务 listen 成功的瞬间才 loadUrl，
        // 避免 WebView 抢在 144 个资源解压完成前请求 → ERR_CONNECTION_REFUSED（且不会自动重试）
        final File filesDir = getFilesDir();
        new Thread(() -> {
            File dataDir = new File(filesDir, "data");
            try {
                AssetCopy.copy(getAssets(), "renderer", new File(filesDir, "web"));
                if (!dataDir.exists()) dataDir.mkdirs();
                // 首次启动种入匿名 token 种子（真实 token 由 Java 自行匿名注册取得并覆盖）
                File tok = new File(dataDir, "anon_token");
                if (!tok.exists()) {
                    try (InputStream is = getAssets().open("anon_token.txt");
                         FileOutputStream fos = new FileOutputStream(tok)) {
                        byte[] b = new byte[4096];
                        int n;
                        while ((n = is.read(b)) > 0) fos.write(b, 0, n);
                    }
                }
                LocalServer srv = new LocalServer(new File(filesDir, "web").getAbsolutePath(),
                        dataDir.getAbsolutePath(), LocalServer.DEFAULT_PORT);
                // onReady 在 ServerSocket listen 成功后触发（start() 本身阻塞在 accept）
                srv.start(() -> runOnUiThread(this::loadHome));
            } catch (Exception e) {
                e.printStackTrace();
                // 端口偶发被占：再给两次机会，仍失败就让页面去连（触发 retryHome 退避）
                for (int i = 2; i <= 3; i++) {
                    try {
                        Thread.sleep(400L * i);
                        new LocalServer(new File(filesDir, "web").getAbsolutePath(),
                                dataDir.getAbsolutePath(), LocalServer.DEFAULT_PORT)
                                .start(() -> runOnUiThread(this::loadHome));
                        return;
                    } catch (Exception ignore) {
                        ignore.printStackTrace();
                    }
                }
                runOnUiThread(this::loadHome);
            }
        }).start();
    }

    private String homeUrl() {
        return "http://127.0.0.1:" + LocalServer.DEFAULT_PORT + "/";
    }

    /** 加载本地首页（服务已 listen 才调用） */
    private void loadHome() {
        if (webView == null) return;
        webView.loadUrl(homeUrl());
    }

    /** 主框架加载失败（连接拒绝 / 服务未就绪）时退避重试，最多 8 次 */
    private void retryHome() {
        if (webView == null || loadRetry >= 8) return;
        loadRetry++;
        webView.postDelayed(this::loadHome, 300L * loadRetry);
    }

    /** 相册返回 */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                } else if (pendingCameraUri != null) {
                    results = new Uri[]{pendingCameraUri};
                }
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            pendingCameraUri = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** 运行时申请媒体读取权限（读系统壁纸用；拒绝也不阻断开相册） */
    private void ensureMediaPermission() {
        if (Build.VERSION.SDK_INT < 23) return;
        String perm = Build.VERSION.SDK_INT >= 33
                ? "android.permission.READ_MEDIA_IMAGES"
                : android.Manifest.permission.READ_EXTERNAL_STORAGE;
        if (checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{perm}, REQ_MEDIA_PERM);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_MEDIA_PERM && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            captureWallpaper();
        }
    }

    /** 把手机系统壁纸抽成 JPEG 落到 dataDir/wallpaper，供前端 /wallpaper 使用 */
    private void captureWallpaper() {
        new Thread(() -> {
            try {
                File out = new File(new File(getFilesDir(), "data"), "wallpaper");
                if (out.exists() && out.length() > 0) return; // 已有则复用
                Bitmap bmp = null;
                android.app.WallpaperManager wm = android.app.WallpaperManager.getInstance(this);
                // 优先直接解码系统壁纸文件（兼容性最好，不依赖 WallpaperManager.getBitmap）
                try {
                    android.os.ParcelFileDescriptor pfd =
                            wm.getWallpaperFile(android.app.WallpaperManager.FLAG_SYSTEM);
                    if (pfd != null) {
                        try {
                            java.io.FileDescriptor fd = pfd.getFileDescriptor();
                            android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
                            o.inJustDecodeBounds = true;
                            android.graphics.BitmapFactory.decodeFileDescriptor(fd, null, o);
                            int scale = 1;
                            while (o.outWidth > 0 && o.outWidth / scale > 2560) scale *= 2;
                            pfd.close();
                            pfd = wm.getWallpaperFile(android.app.WallpaperManager.FLAG_SYSTEM);
                            android.graphics.BitmapFactory.Options o2 = new android.graphics.BitmapFactory.Options();
                            o2.inSampleSize = scale;
                            bmp = android.graphics.BitmapFactory.decodeFileDescriptor(
                                    pfd.getFileDescriptor(), null, o2);
                        } finally {
                            pfd.close();
                        }
                    }
                } catch (Throwable ignored) {}
                if (bmp == null) {
                    try {
                        android.graphics.drawable.Drawable d = wm.getDrawable();
                        if (d instanceof android.graphics.drawable.BitmapDrawable) {
                            bmp = ((android.graphics.drawable.BitmapDrawable) d).getBitmap();
                        }
                    } catch (Throwable ignored) {}
                }
                if (bmp == null) {
                    try {
                        bmp = MediaStore.Images.Media.getBitmap(getContentResolver(),
                                MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
                    } catch (Throwable ignored) {}
                }
                if (bmp == null) return;
                File parent = out.getParentFile();
                if (parent != null && !parent.exists()) parent.mkdirs();
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    bmp.compress(Bitmap.CompressFormat.JPEG, 88, fos);
                }
            } catch (Throwable e) {
                e.printStackTrace();
            }
        }).start();
    }

    private void setupImmersive() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        if (Build.VERSION.SDK_INT >= 30) {
            decor.setOnApplyWindowInsetsListener((v, insets) -> {
                v.getWindowInsetsController().hide(
                        WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                return insets;
            });
        }
        decor.setOnSystemUiVisibilityChangeListener(visibility -> {
            if ((visibility & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) {
                decor.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                                | View.SYSTEM_UI_FLAG_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
