const { contextBridge } = require("electron");

const port = process.env.FW_BACKEND_PORT || "8001";

contextBridge.exposeInMainWorld("electronAPI", {
  backendUrl: `http://127.0.0.1:${port}`,
});
