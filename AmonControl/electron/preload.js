const { contextBridge } = require("electron");
const fs = require("fs");
const path = require("path");

contextBridge.exposeInMainWorld("electronAPI", {
  backendUrl: "http://127.0.0.1:8000",
  readModel: async (fileName) => {
    const modelPath = path.join(__dirname, "..", "..", "Models", fileName);
    const buffer = await fs.promises.readFile(modelPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  },
});
