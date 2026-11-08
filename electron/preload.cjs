const { contextBridge, ipcRenderer } = require('electron');

// 暴露给页面的更新接口（页面里没有 Node 权限，只能用这几个方法）
contextBridge.exposeInMainWorld('filmshelfUpdater', {
  version: () => ipcRenderer.invoke('update:version'),
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  install: () => ipcRenderer.invoke('update:install'),
  openReleases: () => ipcRenderer.invoke('update:releases'),
  onState: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('update:state', h);
    ipcRenderer.send('update:ready'); // 页面准备好了，补发当前状态
    return () => ipcRenderer.removeListener('update:state', h);
  },
});
