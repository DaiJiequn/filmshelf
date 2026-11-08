const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 420, minHeight: 600,
    backgroundColor: '#14110f',
    title: '胶卷柜',
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.loadFile(path.join(__dirname, '..', 'dist-app', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

const RELEASES = 'https://github.com/DaiJiequn/filmshelf/releases/latest';
let updState = { status: 'idle' };
let updater = null;

function pushState(next) {
  updState = { ...updState, ...next };
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', updState);
}

/** 更新流程：启动时只检查并提示；用户点「更新」才下载；下载完用户点「重启」才安装。 */
function setupUpdater() {
  ipcMain.handle('update:version', () => app.getVersion());
  ipcMain.handle('update:releases', () => shell.openExternal(RELEASES));
  ipcMain.on('update:ready', (e) => e.sender.send('update:state', updState));
  if (!app.isPackaged) {
    ipcMain.handle('update:check', () => pushState({ status: 'error', message: '开发模式下不检查更新' }));
    ipcMain.handle('update:download', () => {});
    ipcMain.handle('update:install', () => {});
    return;
  }
  try { updater = require('electron-updater').autoUpdater; } catch { updater = null; }
  if (!updater) return;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.on('checking-for-update', () => pushState({ status: 'checking', message: '' }));
  updater.on('update-available', (i) => pushState({ status: 'available', version: i.version, percent: 0, message: '' }));
  updater.on('update-not-available', () => pushState({ status: 'none' }));
  updater.on('download-progress', (p) => pushState({ status: 'downloading', percent: Math.round(p.percent), speed: p.bytesPerSecond }));
  updater.on('update-downloaded', (i) => pushState({ status: 'ready', version: i.version, percent: 100 }));
  updater.on('error', (err) => pushState({ status: 'error', message: String((err && err.message) || err).slice(0, 200) }));
  const check = () => updater.checkForUpdates().catch(() => {});
  ipcMain.handle('update:check', check);
  ipcMain.handle('update:download', () => { pushState({ status: 'downloading', percent: 0 }); return updater.downloadUpdate().catch(() => {}); });
  ipcMain.handle('update:install', () => updater.quitAndInstall(false, true));
  setTimeout(check, 3000);
}

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  setupUpdater();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
