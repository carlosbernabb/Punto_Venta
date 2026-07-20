const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    navigate: (page) => ipcRenderer.invoke('navigate', page),
    refocusWindow: () => ipcRenderer.invoke('refocus-window'),
    listPrinters: () => ipcRenderer.invoke('list-printers'),
    setPrinter: (printerName) => ipcRenderer.invoke('set-printer', printerName),
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    getUserData: () => ipcRenderer.invoke('get-user-data'),
    printHtml: (html) => ipcRenderer.invoke('print-html', html),
    printHtmlWithDialog: (html) => ipcRenderer.invoke('print-html-with-dialog', html),
    saveHtmlAsPdf: (html, suggestedFileName) => ipcRenderer.invoke('save-html-as-pdf', html, suggestedFileName),
    createCustomerPhotoUploadLink: (customer) => ipcRenderer.invoke('create-customer-photo-upload-link', customer),
    createInventoryCountLink: (payload) => ipcRenderer.invoke('create-inventory-count-link', payload),
    revokeInventoryCountLinksForEmployee: (employeeId) => ipcRenderer.invoke('revoke-inventory-count-links-for-employee', employeeId),
    onCustomerPhotoUploaded: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('customer-photo-uploaded', listener);
        return () => ipcRenderer.removeListener('customer-photo-uploaded', listener);
    },
    onInventoryCountUpdated: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('inventory-count-updated', listener);
        return () => ipcRenderer.removeListener('inventory-count-updated', listener);
    },
    onInventoryCountLinkTest: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('inventory-count-link-test', listener);
        return () => ipcRenderer.removeListener('inventory-count-link-test', listener);
    }
});
