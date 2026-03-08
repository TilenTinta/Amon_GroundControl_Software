const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  backendUrl: "http://127.0.0.1:8001",
  selectLogSavePath: () => ipcRenderer.invoke("select-log-save-path"),
});
