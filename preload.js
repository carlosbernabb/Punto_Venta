const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    navigate: (page) => ipcRenderer.invoke('navigate', page),
    getUserData: () => ipcRenderer.invoke('get-user-data')
});
