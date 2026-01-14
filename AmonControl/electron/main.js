const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

let backendProcess = null;
let fwBackendProcess = null;
let fwWindow = null;

const FW_APP_PATH =
  process.env.FW_UPDATE_APP_PATH || path.join(__dirname, "..", "..", "FW_Update_app");

function startBackend() {
  const python = process.env.PYTHON || "python";
  backendProcess = spawn(python, ["backend_server.py"], {
    cwd: path.join(__dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
  });

  backendProcess.stdout.on("data", (data) => {
    process.stdout.write(`[backend] ${data}`);
  });
  backendProcess.stderr.on("data", (data) => {
    process.stderr.write(`[backend] ${data}`);
  });
  backendProcess.on("exit", (code) => {
    console.log(`Backend exited with code ${code}`);
  });
}

function startFirmwareBackend() {
  if (fwBackendProcess) {
    return;
  }
  const python = process.env.PYTHON || "python";
  fwBackendProcess = spawn(python, ["backend_server.py"], {
    cwd: FW_APP_PATH,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FW_BACKEND_PORT: "8001" },
  });

  fwBackendProcess.stdout.on("data", (data) => {
    process.stdout.write(`[fw-backend] ${data}`);
  });
  fwBackendProcess.stderr.on("data", (data) => {
    process.stderr.write(`[fw-backend] ${data}`);
  });
  fwBackendProcess.on("exit", (code) => {
    console.log(`FW backend exited with code ${code}`);
    fwBackendProcess = null;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1760,
    height: 980,
    backgroundColor: "#0a0f16",
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.webContents.on("console-message", (_event, _level, message) => {
    console.log(`[renderer] ${message}`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("about:blank")) {
      if (url.includes("fw-updater")) {
        openFirmwareUpdater();
      }
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

function openFirmwareUpdater() {
  if (!fs.existsSync(FW_APP_PATH)) {
    console.error(`Firmware updater path not found: ${FW_APP_PATH}`);
    return;
  }
  if (fwWindow && !fwWindow.isDestroyed()) {
    fwWindow.focus();
    return;
  }
  startFirmwareBackend();
  fwWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    backgroundColor: "#0a0f16",
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "fw_preload.js"),
    },
  });
  fwWindow.on("closed", () => {
    fwWindow = null;
  });
  fwWindow.loadFile(path.join(FW_APP_PATH, "electron", "index.html"));
}

app.whenReady().then(() => {
  if (process.env.START_BACKEND !== "0") {
    startBackend();
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  if (fwBackendProcess) {
    fwBackendProcess.kill();
    fwBackendProcess = null;
  }
});

ipcMain.handle("open-fw-updater", () => {
  openFirmwareUpdater();
});
