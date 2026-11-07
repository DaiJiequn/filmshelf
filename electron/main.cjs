const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 420, minHeight: 600,
    backgroundColor: '#14110f',
    title: '胶卷柜',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'dist-app', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  // 自动更新：仅安装版（NSIS / dmg）且配置了发布源时生效；失败不影响使用
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    } catch (e) { /* ignore */ }
  }
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
