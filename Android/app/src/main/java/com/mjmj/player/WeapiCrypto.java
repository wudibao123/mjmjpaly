package com.mjmj.player;

import java.math.BigInteger;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.spec.RSAPublicKeySpec;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 网易云音乐 weapi 加密（对齐 NeteaseCloudMusicApi/util/crypto.js 逐字节）：
 * 1. secretKey = 16 个 base62 可打印字符（非随机二进制）
 * 2. params = AES-CBC(presetKey) → AES-CBC(secretKey)，标准 base64
 * 3. encSecKey = 裸 RSA 模幂（forge 'NONE' 填充）加密「反转后的 secretKey」
 */
public class WeapiCrypto {

    private static final String SECRET_KEY = "0CoJUm6Qyw8W8jud";
    private static final String IV = "0102030405060708";
    private static final String EAPI_KEY = "e82ckenh8dichen8";
    private static final String BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    // 网易云 web 端 RSA 公钥（对应 crypto.js 中的 PEM）
    private static final String RSA_MODULUS =
            "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b72515" +
            "2b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecb" +
            "da92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d81" +
            "3cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
    private static final BigInteger RSA_N = new BigInteger(RSA_MODULUS, 16);
    private static final BigInteger RSA_E = new BigInteger("010001", 16);

    private static final SecureRandom RANDOM = new SecureRandom();

    private static byte[] aesEncrypt(byte[] data, byte[] key) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"),
                new IvParameterSpec(IV.getBytes(StandardCharsets.UTF_8)));
        return cipher.doFinal(data);
    }

    private static byte[] aesEcbEncrypt(byte[] data, byte[] key) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"));
        return cipher.doFinal(data);
    }

    /** eapi 加密（对齐 crypto.js eapi()）：返回 hex 大写 params */
    public static String eapi(String url, String text) throws Exception {
        String message = "nobody" + url + "use" + text + "md5forencrypt";
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] digest = md.digest(message.getBytes(StandardCharsets.UTF_8));
        StringBuilder hexDigest = new StringBuilder();
        for (byte b : digest) hexDigest.append(String.format("%02x", b & 0xff));
        String data = url + "-36cd479b6b5-" + text + "-36cd479b6b5-" + hexDigest;
        byte[] enc = aesEcbEncrypt(data.getBytes(StandardCharsets.UTF_8),
                EAPI_KEY.getBytes(StandardCharsets.UTF_8));
        return toHex(enc).toUpperCase();
    }

    /** forge publicKey.encrypt(data, 'NONE') 等价：裸 RSA 模幂，输出 128 字节 hex */
    private static String rsaNoneEncrypt(byte[] data) {
        BigInteger m = new BigInteger(1, data);
        BigInteger c = m.modPow(RSA_E, RSA_N);
        byte[] out = c.toByteArray();
        if (out.length > 128) {
            if (out.length == 129 && out[0] == 0) out = Arrays.copyOfRange(out, 1, 129);
            else throw new IllegalStateException("RSA 输出异常: " + out.length);
        }
        byte[] padded = new byte[128];
        System.arraycopy(out, 0, padded, 128 - out.length, out.length);
        StringBuilder hex = new StringBuilder();
        for (byte b : padded) hex.append(String.format("%02x", b & 0xff));
        return hex.toString();
    }

    private static String toHex(byte[] data) {
        StringBuilder hex = new StringBuilder();
        for (byte b : data) hex.append(String.format("%02x", b & 0xff));
        return hex.toString();
    }

    /** 生成 weapi POST 表单体：params & encSecKey（与 crypto.js 的 weapi() 一致） */
    public static String encrypt(String jsonBody) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 16; i++) sb.append(BASE62.charAt(RANDOM.nextInt(BASE62.length())));
        String secretKey = sb.toString();

        byte[] once = aesEncrypt(jsonBody.getBytes(StandardCharsets.UTF_8),
                SECRET_KEY.getBytes(StandardCharsets.UTF_8));
        // 关键：外层 AES 的输入是内层 base64 字符串的 UTF-8 字节（与 CryptoJS 一致）
        String onceB64 = Base64.getEncoder().encodeToString(once);
        byte[] params = aesEncrypt(onceB64.getBytes(StandardCharsets.UTF_8),
                secretKey.getBytes(StandardCharsets.UTF_8));

        String reversed = new StringBuilder(secretKey).reverse().toString();
        String encSecKey = rsaNoneEncrypt(reversed.getBytes(StandardCharsets.UTF_8));

        return "params=" + URLEncoder.encode(Base64.getEncoder().encodeToString(params), "UTF-8")
                + "&encSecKey=" + URLEncoder.encode(encSecKey, "UTF-8");
    }

    /** 调试：固定 secretKey 加密（用于与 Node 逐字节对照），不 URL 编码 */
    public static String encryptWithKey(String jsonBody, String secretKey) throws Exception {
        byte[] once = aesEncrypt(jsonBody.getBytes(StandardCharsets.UTF_8),
                SECRET_KEY.getBytes(StandardCharsets.UTF_8));
        String onceB64 = Base64.getEncoder().encodeToString(once);
        byte[] params = aesEncrypt(onceB64.getBytes(StandardCharsets.UTF_8),
                secretKey.getBytes(StandardCharsets.UTF_8));
        String reversed = new StringBuilder(secretKey).reverse().toString();
        String encSecKey = rsaNoneEncrypt(reversed.getBytes(StandardCharsets.UTF_8));
        return "params=" + Base64.getEncoder().encodeToString(params)
                + "&encSecKey=" + encSecKey;
    }

    /** 旧版备用（encSecKey 为 hex 随机 key 的 PKCS1 加密）——不再用于 weapi，保留调试 */
    public static String encryptHex(String jsonBody) throws Exception {
        byte[] randomKey = new byte[16];
        RANDOM.nextBytes(randomKey);
        byte[] once = aesEncrypt(jsonBody.getBytes(StandardCharsets.UTF_8),
                SECRET_KEY.getBytes(StandardCharsets.UTF_8));
        byte[] params = aesEncrypt(once, randomKey);
        KeyFactory kf = KeyFactory.getInstance("RSA");
        RSAPublicKeySpec spec = new RSAPublicKeySpec(RSA_N, RSA_E);
        Cipher cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        cipher.init(Cipher.ENCRYPT_MODE, kf.generatePublic(spec));
        byte[] enc = cipher.doFinal(randomKey);
        return "params=" + URLEncoder.encode(Base64.getEncoder().encodeToString(params), "UTF-8")
                + "&encSecKey=" + URLEncoder.encode(toHex(enc), "UTF-8");
    }
}
