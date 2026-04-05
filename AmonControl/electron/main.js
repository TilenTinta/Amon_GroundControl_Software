const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

let backendProcess = null;
let fwBackendProcess = null;
let fwWindow = null;
let flightPlanningWindow = null;
let mainWindow = null;
let splashWindow = null;
let flightPlanningProfileCache = null;

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
  mainWindow = win;

  win.webContents.on("console-message", (_event, _level, message) => {
    console.log(`[renderer] ${message}`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("about:blank")) {
      if (url.includes("fw-updater")) {
        openFirmwareUpdater();
      }
      if (url.includes("flight-planning")) {
        openFlightPlanning();
      }
      return { action: "deny" };
    }
    return { action: "deny" };
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

function createSplashWindow() {
  const logoPath = path.join(__dirname, "..", "..", "Images", "AMON_logo.png");
  let logoSrc = "";
  try {
    const logoBytes = fs.readFileSync(logoPath);
    logoSrc = `data:image/png;base64,${logoBytes.toString("base64")}`;
  } catch (error) {
    console.error(`Splash logo not found: ${logoPath}`, error);
  }
  splashWindow = new BrowserWindow({
    width: 520,
    height: 320,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    show: false,
  });
  splashWindow.once("ready-to-show", () => {
    splashWindow.show();
  });
  const splashHtml = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body {
            margin: 0;
            background: transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
          }
          img {
            width: 220px;
            height: 220px;
            object-fit: contain;
            filter: drop-shadow(0 0 24px rgba(255,255,255,0.12));
          }
        </style>
      </head>
      <body>
        ${
          logoSrc
            ? `<img src="${logoSrc}" alt="AMON logo" />`
            : `<div style="color:#c8d4e8;font-family:Segoe UI,sans-serif;letter-spacing:0.08em;">AMON</div>`
        }
      </body>
    </html>`;
  splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`
  );
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

function openFlightPlanning() {
  if (flightPlanningWindow && !flightPlanningWindow.isDestroyed()) {
    flightPlanningWindow.focus();
    return;
  }

  flightPlanningWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0a0f16",
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  flightPlanningWindow.on("closed", () => {
    flightPlanningWindow = null;
  });

  flightPlanningWindow.loadFile(path.join(__dirname, "flight_planning.html"));
}

app.whenReady().then(() => {
  if (process.env.START_BACKEND !== "0") {
    startBackend();
  }
  createSplashWindow();
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    createWindow();
  }, 5000);

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
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

ipcMain.handle("open-flight-planning", () => {
  openFlightPlanning();
});

ipcMain.handle("select-log-save-path", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win || undefined, {
    title: "Save Flash Log CSV",
    defaultPath: "drone_log.csv",
    filters: [
      { name: "CSV Files", extensions: ["csv"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePath) {
    return "";
  }
  return result.filePath;
});

ipcMain.handle("select-flight-profile", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const profilesDir = path.join(__dirname, "..", "flight_profiles");
  const result = await dialog.showOpenDialog(win || undefined, {
    title: "Import Flight Profile (JSON)",
    defaultPath: profilesDir,
    properties: ["openFile"],
    filters: [{ name: "JSON Files", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  const filePath = result.filePaths[0];
  try {
    const jsonText = await fs.promises.readFile(filePath, "utf8");
    return { ok: true, filePath, jsonText };
  } catch (error) {
    return { ok: false, error: "Failed to read profile file." };
  }
});

ipcMain.handle("save-flight-profile", async (_event, suggestedName, jsonText) => {
  const win = BrowserWindow.getFocusedWindow();
  const profilesDir = path.join(__dirname, "..", "flight_profiles");
  const defaultPath = path.join(
    profilesDir,
    typeof suggestedName === "string" && suggestedName.trim() ? suggestedName.trim() : "flight_profile.json"
  );

  const result = await dialog.showSaveDialog(win || undefined, {
    title: "Save Flight Profile (JSON)",
    defaultPath,
    filters: [{ name: "JSON Files", extensions: ["json"] }],
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  try {
    await fs.promises.writeFile(result.filePath, String(jsonText || ""), "utf8");
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    return { ok: false, error: "Failed to save profile file." };
  }
});

ipcMain.handle("flight-planning-get-profile", () => {
  return { ok: true, profile: flightPlanningProfileCache };
});

ipcMain.handle("flight-planning-set-profile", (_event, profile) => {
  flightPlanningProfileCache = profile || null;
  return { ok: true };
});

ipcMain.handle("flight-planning-clear-profile", () => {
  flightPlanningProfileCache = null;
  return { ok: true };
});
