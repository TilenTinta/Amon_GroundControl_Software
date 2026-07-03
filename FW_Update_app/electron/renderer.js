const backendUrl = window.electronAPI.backendUrl;

const portSelect = document.getElementById("portSelect");
const baudSelect = document.getElementById("baudSelect");
const refreshPortsBtn = document.getElementById("refreshPorts");
const connectBtn = document.getElementById("connectBtn");
const statusBadge = document.getElementById("statusBadge");
const lastMessage = document.getElementById("lastMessage");
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const startUploadBtn = document.getElementById("startUploadBtn");
const jumpAppBtn = document.getElementById("jumpAppBtn");
const progressFill = document.getElementById("progressFill");
const fileLabel = document.getElementById("fileLabel");
const logList = document.getElementById("logList");
const clearLogBtn = document.getElementById("clearLog");
const backendStatus = document.getElementById("backendStatus");
const crcValue = document.getElementById("crcValue");
const bootVer = document.getElementById("bootVer");
const deviceCrc32 = document.getElementById("deviceCrc32");
const crcMatch = document.getElementById("crcMatch");
const maxRetransmitsInput = document.getElementById("maxRetransmits");
const saveRetriesBtn = document.getElementById("saveRetries");
const requireStatusAckInput = document.getElementById("requireStatusAck");
const telemetryConfirmsConnectionInput = document.getElementById(
  "telemetryConfirmsConnection"
);
const ftdiPortSelect = document.getElementById("ftdiPortSelect");
const ftdiBaudSelect = document.getElementById("ftdiBaudSelect");
const refreshFtdiPortsBtn = document.getElementById("refreshFtdiPorts");
const connectFtdiBtn = document.getElementById("connectFtdiBtn");
const logDumpPathInput = document.getElementById("logDumpPath");
const browseLogPathBtn = document.getElementById("browseLogPathBtn");
const dumpLogBtn = document.getElementById("dumpLogBtn");
const deleteLogBtn = document.getElementById("deleteLogBtn");
const txErrorCount = document.getElementById("txErrorCount");
const txErrorStreak = document.getElementById("txErrorStreak");
let ftdiConnected = false;

let allowUpload = true;
let uploadWasInProgress = false;
const mainBackendUrl = "http://127.0.0.1:8002";
const FLASH_ERASE_INFO =
  "Raw flash logging is probably enabled, and it might take a second to erase flash.";

const actionButtons = [
  refreshPortsBtn,
  connectBtn,
  uploadBtn,
  startUploadBtn,
  jumpAppBtn,
];

function addLog(message) {
  if (!message) {
    return;
  }
  const item = document.createElement("div");
  item.className = "log-item";
  const timestamp = new Date().toLocaleTimeString();
  item.textContent = `[${timestamp}] ${message}`;
  logList.prepend(item);
  if (logList.children.length > 80) {
    logList.removeChild(logList.lastChild);
  }
}

function showInfoPopup(message) {
  addLog(message);
  window.alert(message);
}

function setStatus(state) {
  statusBadge.textContent = state.connection_status || "Disconnected";
  const connected = state.connection_status?.includes("Connected");
  if (connected) {
    statusBadge.classList.add("connected");
  } else {
    statusBadge.classList.remove("connected");
  }
  lastMessage.textContent = state.last_message || "No messages yet";
  if (state.upload_name) {
    fileLabel.textContent = state.upload_name;
  } else {
    fileLabel.textContent = "No file selected";
  }
  progressFill.style.width = `${state.upload_progress || 0}%`;
  crcValue.textContent = state.upload_crc32 || "-";
  bootVer.textContent = state.device_boot_ver || "-";
  deviceCrc32.textContent = state.device_crc32 || "-";
  if (state.crc_match === "match") {
    crcMatch.textContent = "Match";
  } else if (state.crc_match === "mismatch") {
    crcMatch.textContent = "Mismatch";
  } else {
    crcMatch.textContent = "-";
  }
  connectBtn.textContent = connected ? "Disconnect" : "Connect";
  connectBtn.classList.toggle("danger", connected);
  connectBtn.classList.toggle("primary", !connected);

  if (uploadWasInProgress && !state.is_uploading && state.upload_progress === 100) {
    window.alert("Firmware update finished.");
  }
  uploadWasInProgress = Boolean(state.is_uploading);
}

async function fetchJson(path, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 8000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${backendUrl}${path}`, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json();
}

function setBackendState(ok, message) {
  backendStatus.textContent = message;
  backendStatus.classList.toggle("ok", ok);
  backendStatus.classList.toggle("error", !ok);
  actionButtons.forEach((button) => {
    button.disabled = !ok;
  });
}

async function waitForBackend() {
  let attempts = 0;
  while (attempts < 20) {
    try {
      await fetchJson("/status");
      setBackendState(true, "Online");
      addLog("Backend online.");
      return true;
    } catch {
      attempts += 1;
      setBackendState(false, "Offline");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  addLog("Backend is offline. Check Python server.");
  return false;
}

async function refreshPorts() {
  try {
    const state = await fetchJson("/ports");
    portSelect.innerHTML = "";
    const ports = state.ports || [];
    if (!ports.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No ports detected";
      portSelect.appendChild(option);
      addLog("No serial ports detected. Check device connection and drivers.");
      connectBtn.disabled = true;
    } else {
      connectBtn.disabled = false;
      ports.forEach((port) => {
        const option = document.createElement("option");
        option.value = port;
        option.textContent = port;
        portSelect.appendChild(option);
      });
      portSelect.value = ports[0];
    }
    setStatus(state);
  } catch (error) {
    addLog(`Port scan failed: ${error.message}`);
  }
}

async function connect() {
  const port = portSelect.value;
  const baud_rate = parseInt(baudSelect.value, 10);
  if (!port) {
    addLog("Select a serial port before connecting.");
    return;
  }
  addLog(`Connecting to ${port} @ ${baud_rate}...`);
  try {
    const state = await fetchJson("/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port, baud_rate }),
      timeoutMs: 8000,
    });
    if (state.error) {
      addLog(`Connect failed: ${state.error}`);
    } else if (state.connection_status) {
      addLog(state.connection_status);
    }
    setStatus(state);
  } catch (error) {
    addLog(`Connect failed: ${error.message}`);
  }
}

async function disconnect() {
  addLog("Disconnecting...");
  try {
    const state = await fetchJson("/disconnect", { method: "POST" });
    addLog(state.connection_status || "Disconnected");
    setStatus(state);
  } catch (error) {
    addLog(`Disconnect failed: ${error.message}`);
  }
}

async function pollResponses() {
  const state = await fetchJson("/responses");
  if (state.messages && state.messages.length) {
    state.messages.forEach(addLog);
  }
  setStatus(state);
}

async function uploadFile() {
  if (!fileInput.files.length) {
    return;
  }
  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  try {
    const state = await fetchJson("/upload", {
      method: "POST",
      body: formData,
    });
    if (state.upload_crc32) {
      addLog(`CRC32 ${state.upload_crc32}`);
    } else {
      addLog("CRC32 not available for this file.");
    }
    if (state.crc_match === "match") {
      const proceed = window.confirm(
        "Device CRC32 matches this file. Upload anyway?"
      );
      allowUpload = proceed;
      if (!proceed) {
        addLog("Upload canceled (CRC32 matches device).");
      }
    } else {
      allowUpload = true;
    }
    setStatus(state);
    startUploadBtn.disabled = !allowUpload;
  } catch (error) {
    addLog(`Upload failed: ${error.message}`);
  }
}

async function startUpload() {
  if (!allowUpload) {
    addLog("Upload blocked: CRC32 matches device.");
    return;
  }
  const state = await fetchJson("/start_upload", { method: "POST" });
  setStatus(state);
}

async function jumpApp() {
  if (jumpAppBtn.disabled) {
    return;
  }
  try {
    const state = await fetchJson("/jump_app", { method: "POST" });
    addLog("Sent JUMP_APP command.");
    setStatus(state);
  } catch (error) {
    addLog(`Jump App failed: ${error.message}`);
  }
}

refreshPortsBtn.addEventListener("click", refreshPorts);
connectBtn.addEventListener("click", () => {
  if (connectBtn.textContent === "Disconnect") {
    disconnect();
  } else {
    connect();
  }
});
uploadBtn.addEventListener("click", uploadFile);
startUploadBtn.addEventListener("click", startUpload);
jumpAppBtn.addEventListener("click", jumpApp);
clearLogBtn.addEventListener("click", () => {
  logList.innerHTML = "";
  addLog("Console cleared.");
});

setInterval(() => {
  pollResponses().catch(() => {});
}, 2000);

waitForBackend().then((ready) => {
  if (ready) {
    refreshPorts().catch(() => {});
  }
});

async function fetchMainJson(path, options = {}) {
  const response = await fetch(`${mainBackendUrl}${path}`, options);
  if (!response.ok) {
    throw new Error("Main backend request failed");
  }
  return response.json();
}

async function refreshRetryConfig() {
  if (!maxRetransmitsInput) {
    return;
  }
  try {
    const state = await fetchMainJson("/pair_config");
    if (typeof state.max_retransmits === "number") {
      maxRetransmitsInput.value = `${state.max_retransmits}`;
    }
    if (requireStatusAckInput && typeof state.require_status_ack === "boolean") {
      requireStatusAckInput.checked = state.require_status_ack;
    }
    if (
      telemetryConfirmsConnectionInput &&
      typeof state.telemetry_confirms_connection === "boolean"
    ) {
      telemetryConfirmsConnectionInput.checked =
        state.telemetry_confirms_connection;
    }
  } catch {
    // ignore if main backend isn't running
  }
}

async function refreshRetryStats() {
  if (!txErrorCount || !txErrorStreak) {
    return;
  }
  try {
    const state = await fetchMainJson("/pair_stats");
    txErrorCount.textContent = `${state.error_tx_count ?? 0}`;
    txErrorStreak.textContent = `${state.error_tx_streak ?? 0}`;
  } catch {
    // ignore if main backend isn't running
  }
}

async function refreshFtdiPorts() {
  if (!ftdiPortSelect) {
    return;
  }
  try {
    const state = await fetchMainJson("/ftdi/ports");
    const ports = (state && state.ports) || [];
    ftdiPortSelect.innerHTML = "";
    if (!ports.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No ports";
      ftdiPortSelect.appendChild(option);
      return;
    }
    ports.forEach((port) => {
      const option = document.createElement("option");
      option.value = port;
      option.textContent = port;
      ftdiPortSelect.appendChild(option);
    });
    ftdiPortSelect.value = ports[0];
  } catch {
    ftdiPortSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No ports";
    ftdiPortSelect.appendChild(option);
  }
}

async function refreshFtdiStatus() {
  if (!connectFtdiBtn) {
    return;
  }
  try {
    const state = await fetchMainJson("/ftdi/status");
    ftdiConnected = Boolean(state && state.connected);
    connectFtdiBtn.textContent = ftdiConnected ? "Disconnect" : "Connect";
    connectFtdiBtn.classList.toggle("danger", ftdiConnected);
    connectFtdiBtn.classList.toggle("primary", !ftdiConnected);
  } catch {
    ftdiConnected = false;
    connectFtdiBtn.textContent = "Connect";
    connectFtdiBtn.classList.remove("danger");
    connectFtdiBtn.classList.add("primary");
  }
}

if (saveRetriesBtn && maxRetransmitsInput) {
  saveRetriesBtn.addEventListener("click", async () => {
    const value = Number.parseInt(maxRetransmitsInput.value, 10);
    if (!Number.isFinite(value)) {
      return;
    }
    try {
      const state = await fetchMainJson("/pair_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_retransmits: value,
          require_status_ack: requireStatusAckInput
            ? requireStatusAckInput.checked
            : undefined,
          telemetry_confirms_connection: telemetryConfirmsConnectionInput
            ? telemetryConfirmsConnectionInput.checked
            : undefined,
        }),
      });
      if (typeof state.max_retransmits === "number") {
        maxRetransmitsInput.value = `${state.max_retransmits}`;
      }
      if (requireStatusAckInput && typeof state.require_status_ack === "boolean") {
        requireStatusAckInput.checked = state.require_status_ack;
      }
      if (
        telemetryConfirmsConnectionInput &&
        typeof state.telemetry_confirms_connection === "boolean"
      ) {
        telemetryConfirmsConnectionInput.checked =
          state.telemetry_confirms_connection;
      }
    } catch {
      // ignore if main backend isn't running
    }
  });
}

if (dumpLogBtn && logDumpPathInput) {
  dumpLogBtn.addEventListener("click", async () => {
    const outputPath = (logDumpPathInput.value || "").trim();
    if (!ftdiConnected) {
      addLog("Connect FTDI first.");
      return;
    }
    if (!outputPath) {
      addLog("Set output CSV path before reading flash log.");
      return;
    }
    dumpLogBtn.disabled = true;
    addLog("Requesting flash log dump...");
    try {
      const result = await fetchMainJson("/log_dump_ftdi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          output_path: outputPath,
        }),
      });
      if (!result || !result.ok) {
        addLog(`Flash log read failed: ${(result && result.error) || "Unknown error"}`);
        return;
      }
      addLog(
        `Flash log saved: ${result.records_saved} records -> ${result.file_path}`
      );
      window.alert(
        `Log dump complete.\nSaved ${result.records_saved} records to:\n${result.file_path}`
      );
    } catch (error) {
      addLog(`Flash log read failed: ${error.message}`);
    } finally {
      dumpLogBtn.disabled = false;
    }
  });
}

if (deleteLogBtn) {
  deleteLogBtn.addEventListener("click", async () => {
    if (!ftdiConnected) {
      addLog("Connect FTDI first.");
      return;
    }
    const confirmed = window.confirm("Delete flight log from device flash?");
    if (!confirmed) {
      return;
    }
    deleteLogBtn.disabled = true;
    addLog("Sending log delete command...");
    const eraseInfoTimer = setTimeout(() => {
      showInfoPopup(FLASH_ERASE_INFO);
    }, 3000);
    try {
      const result = await fetchMainJson("/log_rm_ftdi", { method: "POST" });
      clearTimeout(eraseInfoTimer);
      if (!result || !result.ok) {
        addLog(`Delete log failed: ${(result && result.error) || "Unknown error"}`);
        return;
      }
      addLog(result.ack ? "Log delete acknowledged." : "Log delete command sent.");
      window.alert(
        result.ack
          ? "Flight log delete confirmed by device."
          : "Flight log delete command sent."
      );
    } catch (error) {
      clearTimeout(eraseInfoTimer);
      addLog(`Delete log failed: ${error.message}`);
    } finally {
      clearTimeout(eraseInfoTimer);
      deleteLogBtn.disabled = false;
    }
  });
}

if (refreshFtdiPortsBtn) {
  refreshFtdiPortsBtn.addEventListener("click", () => {
    refreshFtdiPorts().catch(() => {});
  });
}

if (connectFtdiBtn && ftdiPortSelect && ftdiBaudSelect) {
  connectFtdiBtn.addEventListener("click", async () => {
    if (ftdiConnected) {
      try {
        await fetchMainJson("/ftdi/disconnect", { method: "POST" });
        addLog("FTDI disconnected.");
      } catch (error) {
        addLog(`FTDI disconnect failed: ${error.message}`);
      } finally {
        refreshFtdiStatus().catch(() => {});
      }
      return;
    }

    const port = (ftdiPortSelect.value || "").trim();
    const baud_rate = Number.parseInt(ftdiBaudSelect.value || "115200", 10);
    if (!port) {
      addLog("Select FTDI port first.");
      return;
    }
    if (!Number.isFinite(baud_rate) || baud_rate <= 0) {
      addLog("Invalid FTDI baud rate.");
      return;
    }

    try {
      const state = await fetchMainJson("/ftdi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port, baud_rate }),
      });
      if (!state || !state.ok) {
        addLog(`FTDI connect failed: ${(state && state.error) || "Unknown error"}`);
      } else {
        addLog(`FTDI connected: ${state.port} @ ${state.baud_rate}`);
      }
    } catch (error) {
      addLog(`FTDI connect failed: ${error.message}`);
    } finally {
      refreshFtdiStatus().catch(() => {});
    }
  });
}

if (browseLogPathBtn && logDumpPathInput) {
  browseLogPathBtn.addEventListener("click", async () => {
    try {
      if (!window.electronAPI || !window.electronAPI.selectLogSavePath) {
        return;
      }
      const selected = await window.electronAPI.selectLogSavePath();
      if (selected) {
        logDumpPathInput.value = selected;
      }
    } catch {
      // ignore dialog failures
    }
  });
}

refreshRetryConfig().catch(() => {});
refreshRetryStats().catch(() => {});
refreshFtdiPorts().catch(() => {});
refreshFtdiStatus().catch(() => {});
setInterval(() => {
  refreshRetryStats().catch(() => {});
}, 2000);
