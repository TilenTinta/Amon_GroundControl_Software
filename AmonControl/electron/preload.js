const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

contextBridge.exposeInMainWorld("electronAPI", {
  backendUrl: "http://127.0.0.1:8002",
  openFirmwareUpdater: () => ipcRenderer.invoke("open-fw-updater"),
  openFlightPlanning: () => ipcRenderer.invoke("open-flight-planning"),
  selectFlightProfile: () => ipcRenderer.invoke("select-flight-profile"),
  saveFlightProfile: (suggestedName, jsonText) =>
    ipcRenderer.invoke("save-flight-profile", suggestedName, jsonText),
  flightPlanningGetProfile: () => ipcRenderer.invoke("flight-planning-get-profile"),
  flightPlanningSetProfile: (profile) => ipcRenderer.invoke("flight-planning-set-profile", profile),
  flightPlanningClearProfile: () => ipcRenderer.invoke("flight-planning-clear-profile"),
  readModel: async (fileName) => {
    const modelPath = path.join(__dirname, "..", "..", "Models", fileName);
    const buffer = await fs.promises.readFile(modelPath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  },
});
