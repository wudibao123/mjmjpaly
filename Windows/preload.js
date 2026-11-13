// MJMJ preload：安全暴露窗口控制与剪贴板能力
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mjmj', {
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
  toggleFullscreen: () => ipcRenderer.invoke('win:fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),
  onRestored: (cb) => {
    ipcRenderer.on('win:restored', () => cb());
  },
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  captureDesktop: () => ipcRenderer.invoke('desktop:capture'),
  onFullscreenChange: (cb) => {
    ipcRenderer.on('win:fullscreen-changed', (_e, v) => cb(v));
  },
  // 命令行 mjplay 送来的播放请求：桌面 UI 与播放器状态同步
  onCliPlay: (cb) => {
    ipcRenderer.on('cli:play', (_e, track) => cb(track));
  },
});
