# MJMJ

一个网易云音乐第三方客户端：Windows 桌面端（Electron + WebGL 液态玻璃）与 Android 端（原生外壳 + 本地服务 + 同一套 Web 渲染层），两端共用同一份渲染层源码。

```
.
├── index.html     # 官网（单文件，自包含）
├── Windows/       # 桌面端工程（Electron）
└── Android/       # 安卓端工程（Gradle + Java）
```

## 快速开始

**桌面端**

```bash
cd Windows
npm install
npm start
```

**安卓端**

```bash
cd Android
powershell -File sync-renderer.ps1   # 同步共用渲染层
gradle assembleRelease
```

详细说明见各目录下的 `README.md`。

## 设计要点

- **液态玻璃**：WebGL shader 实现凹陷、模糊、折射、边缘色差，参数面板可调并保存
- **节奏响应**：WebAudio 分析音频频段与能量，驱动背景与画面的推拉、流动、色相偏移
- **歌词**：KTV 胶囊追光、行级漂移与拖拽、点击跳转播放进度
- **两端同源**：渲染层一次编写，桌面端由 Electron 加载，安卓端由 WebView 加载并复用同一套 JS

## 声明

- 本项目与网易云音乐官方无关，仅作个人学习与技术交流
- 音乐内容版权归网易云音乐及相应权利人所有，请勿用于商业用途
- 仓库不包含任何签名证书、keystore 与账号凭据

## License

GPL-3.0
