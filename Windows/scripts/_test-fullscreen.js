// 实测透明窗口全屏切换
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 700, transparent: true, frame: false, show: true });
  await win.loadURL('data:text/html,<body style="background:rgba(0,0,0,0)"><h1>test</h1></body>');
  win.setFullScreen(true);
  await new Promise((r) => setTimeout(r, 1200));
  console.log('AFTER ENTER isFullScreen =', win.isFullScreen());
  win.setFullScreen(false);
  await new Promise((r) => setTimeout(r, 1200));
  console.log('AFTER EXIT isFullScreen =', win.isFullScreen());
  console.log('BOUNDS =', JSON.stringify(win.getBounds()));
  app.quit();
});
