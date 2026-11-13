package com.mjmj.player;

import android.content.res.AssetManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** 首次启动把 assets/renderer 解压到 filesDir/web（LocalServer 的静态根） */
public class AssetCopy {
    public static void copy(AssetManager am, String assetPath, File dest) {
        try {
            String[] children = am.list(assetPath);
            if (children == null || children.length == 0) {
                File parent = dest.getParentFile();
                if (parent != null) parent.mkdirs();
                try (InputStream is = am.open(assetPath);
                     OutputStream os = new FileOutputStream(dest)) {
                    byte[] b = new byte[16384];
                    int n;
                    while ((n = is.read(b)) > 0) os.write(b, 0, n);
                }
            } else {
                if (!dest.exists()) dest.mkdirs();
                for (String c : children) {
                    copy(am, assetPath + "/" + c, new File(dest, c));
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
