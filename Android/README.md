# MJMJ · Android 端

原生 Android 外壳 + 本地 HTTP 服务 + 同一套 Web 渲染层，不依赖 WebView 直接访问外网：所有网易云请求由 Java 端签名后经本地服务转发，避免 WebView 侧的跨域与风控问题。

## 组成

| 类 | 职责 |
|---|---|
| `MainActivity` | WebView 宿主、错误重试、全屏与安全区处理 |
| `LocalServer` | 本地 `ServerSocket` 服务：静态资源、`/api/*` 转发、音频代理 |
| `NcmApi` | 网易云接口封装（weapi 加密、扫码登录、歌单、搜索、歌词） |
| `WeapiCrypto` | weapi 参数加密（AES-CBC + RSA） |
| `AssetCopy` | 首次启动把 `assets/renderer` 解压到私有目录 |
| `MiniJson` | 轻量 JSON 解析，避免引入额外依赖 |

## 构建

前置：JDK 17+、Android SDK（compileSdk 34）、Gradle 8.x。

```bash
# 1. 同步渲染层（renderer 是 Windows/Android 共用的，不重复入库）
powershell -File sync-renderer.ps1

# 2. 构建
gradle -p . assembleRelease
```

产物：`app/build/outputs/apk/release/app-release.apk`

`gradle.properties` 里的 SDK 路径按本机环境修改；也可用 `local.properties`（不进版本库）指定 `sdk.dir`。

## 签名

仓库不含 keystore。要发布请自己生成并写入 `local.properties`（参考 `local.properties.example`）：

```bash
keytool -genkeypair -v -keystore mjmj-release.jks -alias mjmj \
  -keyalg RSA -keysize 2048 -validity 10000
```

未配置签名时 `assembleRelease` 输出的是未签名 APK。

## 已知限制

- 扫码登录在部分设备会触发网易云风控；桌面端扫码更稳定，必要时可在桌面端登录后在手机端复用登录态
- 音频走本地代理，首次播放有约 100ms 的转发延迟

## 免责声明

仅供个人学习与技术交流，音乐内容版权归网易云音乐及相应权利人所有。
