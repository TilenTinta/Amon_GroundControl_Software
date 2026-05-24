const closeBtn = document.getElementById("closeBtn");
const browseLogBtn = document.getElementById("browseLogBtn");
const loadLogBtn = document.getElementById("loadLogBtn");
const clearLogBtn = document.getElementById("clearLogBtn");
const logPathInput = document.getElementById("logPathInput");
const logStatus = document.getElementById("logStatus");
const plotGrid = document.getElementById("plotGrid");
const sampleCount = document.getElementById("sampleCount");
const durationValue = document.getElementById("durationValue");
const rateValue = document.getElementById("rateValue");
const columnCount = document.getElementById("columnCount");

let pendingCsvText = "";
let pendingPath = "";

const PLOT_GROUPS = [
  {
    title: "Drone Attitude",
    yLabel: "deg",
    series: [
      { key: "pitch", label: "Pitch", color: "#6ed9ff" },
      { key: "roll", label: "Roll", color: "#f06d6d" },
      { key: "yaw", label: "Yaw", color: "#4dd6a3" },
    ],
  },
  {
    title: "Accelerometer",
    yLabel: "g",
    series: [
      { key: "accel_x", label: "Accel X", color: "#caa7ff" },
      { key: "accel_y", label: "Accel Y", color: "#f2b96d" },
      { key: "accel_z", label: "Accel Z", color: "#3fd2b6" },
    ],
  },
  {
    title: "Gyroscope",
    yLabel: "deg/s",
    series: [
      { key: "gyro_x", label: "Gyro X", color: "#63e0ff" },
      { key: "gyro_y", label: "Gyro Y", color: "#f06dcb" },
      { key: "gyro_z", label: "Gyro Z", color: "#f3d36b" },
    ],
  },
  {
    title: "TOF Height",
    yLabel: "m",
    series: [{ key: "height_tof_m", label: "TOF", color: "#3fd2b6" }],
  },
  {
    title: "Barometer Height",
    yLabel: "m",
    series: [{ key: "height_baro_m", label: "Baro", color: "#6ed9ff" }],
  },
  {
    title: "Battery Voltages",
    yLabel: "V",
    series: [
      { key: "battery_main_voltage_v", label: "Main", color: "#4dd6a3" },
      { key: "battery_edf_voltage_v", label: "EDF", color: "#f06d6d" },
    ],
  },
  {
    title: "Temperature",
    yLabel: "C",
    series: [{ key: "temperature_c", label: "Ambient", color: "#f2b96d" }],
  },
  {
    title: "Humidity",
    yLabel: "%",
    series: [{ key: "humidity", label: "Humidity", color: "#6ed9ff" }],
  },
  {
    title: "Pressure",
    yLabel: "hPa",
    series: [{ key: "pressure_hpa", label: "Pressure", color: "#4dd6a3" }],
  },
  {
    title: "IMU Temperature",
    yLabel: "C",
    series: [{ key: "gyro_temp_c", label: "Gyro Temp", color: "#caa7ff" }],
  },
];

function setStatus(message) {
  if (!logStatus) return;
  logStatus.textContent = message || "";
  logStatus.classList.toggle("hidden", !message);
}

function setText(node, value) {
  if (node) node.textContent = value;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

function toNumber(value) {
  const num = Number(String(value ?? "").trim());
  return Number.isFinite(num) ? num : null;
}

function buildDataset(csvText) {
  const rows = parseCsv(String(csvText || "").replace(/^\uFEFF/, ""));
  if (rows.length < 2) {
    throw new Error("Selected file has no data rows.");
  }

  const headers = rows[0].map((header) => header.trim());
  const dataRows = rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = toNumber(row[index]);
    });
    return item;
  });

  if (!headers.includes("timestamp")) {
    throw new Error("Selected file is missing the timestamp column.");
  }

  const firstTimestamp = dataRows.find((row) => Number.isFinite(row.timestamp))?.timestamp || 0;
  dataRows.forEach((row) => {
    row.time_sec = Number.isFinite(row.timestamp) ? (row.timestamp - firstTimestamp) / 1000 : 0;
    row.pressure_hpa = Number.isFinite(row.pressure) ? row.pressure / 100 : null;
    row.height_tof_m = Number.isFinite(row.height_tof_mm) ? row.height_tof_mm / 1000 : null;
    row.temperature_c = Number.isFinite(row.temperature) ? row.temperature / 100 : null;
    row.battery_main_voltage_v = Number.isFinite(row.battery_main_voltage)
      ? row.battery_main_voltage / 100
      : null;
    row.battery_edf_voltage_v = Number.isFinite(row.battery_edf_voltage)
      ? row.battery_edf_voltage / 100
      : null;
    row.gyro_temp_c = Number.isFinite(row.gyro_temp) ? row.gyro_temp / 100 : null;
  });

  return { headers, rows: dataRows };
}

function valueRange(rows, series) {
  let min = Infinity;
  let max = -Infinity;
  rows.forEach((row) => {
    series.forEach((line) => {
      const value = row[line.key];
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    });
  });
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: -1, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

function drawPlot(canvas, rows, group) {
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, canvas.clientWidth);
  const height = Math.max(220, canvas.clientHeight);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const padLeft = 54;
  const padRight = 18;
  const padTop = 20;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const maxTime = Math.max(...rows.map((row) => row.time_sec || 0), 1);
  const range = valueRange(rows, group.series);
  const ySpan = range.max - range.min || 1;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padTop + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i += 1) {
    const x = padLeft + (plotW * i) / 5;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop);
  ctx.lineTo(padLeft, padTop + plotH);
  ctx.lineTo(padLeft + plotW, padTop + plotH);
  ctx.stroke();

  ctx.fillStyle = "rgba(233,238,245,0.78)";
  ctx.font = "11px Bahnschrift, Segoe UI, sans-serif";
  ctx.fillText(group.yLabel, padLeft, 12);
  ctx.fillText(`${range.max.toFixed(1)}`, 8, padTop + 8);
  ctx.fillText(`${range.min.toFixed(1)}`, 8, padTop + plotH);
  const xLabel = `time (s), max ${maxTime.toFixed(2)}`;
  ctx.fillText(xLabel, padLeft + plotW / 2 - ctx.measureText(xLabel).width / 2, height - 8);

  const step = Math.max(1, Math.ceil(rows.length / 1800));
  group.series.forEach((line) => {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < rows.length; i += step) {
      const row = rows[i];
      const value = row[line.key];
      if (!Number.isFinite(value)) continue;
      const x = padLeft + ((row.time_sec || 0) / maxTime) * plotW;
      const y = padTop + (1 - (value - range.min) / ySpan) * plotH;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  });
}

function renderLegend(parent, series) {
  parent.innerHTML = "";
  series.forEach((line) => {
    const item = document.createElement("span");
    item.className = "log-legend-item";
    const swatch = document.createElement("span");
    swatch.className = "log-legend-swatch";
    swatch.style.background = line.color;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(line.label));
    parent.appendChild(item);
  });
}

function renderPlots(dataset) {
  plotGrid.innerHTML = "";
  PLOT_GROUPS.forEach((group) => {
    const availableSeries = group.series.filter((line) =>
      dataset.rows.some((row) => Number.isFinite(row[line.key]))
    );
    if (!availableSeries.length) return;

    const card = document.createElement("section");
    card.className = "chart-card log-chart-card";
    const head = document.createElement("div");
    head.className = "log-chart-head";
    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = group.title;
    const legend = document.createElement("div");
    legend.className = "log-legend";
    renderLegend(legend, availableSeries);
    head.appendChild(title);
    head.appendChild(legend);

    const canvas = document.createElement("canvas");
    canvas.className = "log-chart";
    card.appendChild(head);
    card.appendChild(canvas);
    plotGrid.appendChild(card);
    drawPlot(canvas, dataset.rows, { ...group, series: availableSeries });
  });
}

function renderSummary(dataset) {
  const rows = dataset.rows;
  const duration = rows.length ? Math.max(...rows.map((row) => row.time_sec || 0)) : 0;
  const timestampDiffs = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (Number.isFinite(rows[i].timestamp) && Number.isFinite(rows[i - 1].timestamp)) {
      timestampDiffs.push(rows[i].timestamp - rows[i - 1].timestamp);
    }
  }
  const avgDiff = timestampDiffs.length
    ? timestampDiffs.reduce((sum, value) => sum + value, 0) / timestampDiffs.length
    : 0;
  const rate = avgDiff > 0 ? 1000 / avgDiff : 0;

  setText(sampleCount, String(rows.length));
  setText(durationValue, `${duration.toFixed(3)} s`);
  setText(rateValue, rate > 0 ? `${rate.toFixed(1)} Hz` : "-- Hz");
  setText(columnCount, String(dataset.headers.length));
}

function clearViewer() {
  pendingCsvText = "";
  pendingPath = "";
  if (logPathInput) logPathInput.value = "";
  if (plotGrid) plotGrid.innerHTML = "";
  setText(sampleCount, "--");
  setText(durationValue, "-- s");
  setText(rateValue, "-- Hz");
  setText(columnCount, "--");
  setStatus("");
}

async function browseLogFile() {
  if (!window.electronAPI || !window.electronAPI.selectLogFile) {
    setStatus("File browsing is not available in this build.");
    return;
  }
  const result = await window.electronAPI.selectLogFile();
  if (!result || !result.ok) {
    if (result && result.canceled) return;
    setStatus((result && result.error) || "Failed to open log file.");
    return;
  }
  pendingCsvText = String(result.csvText || "");
  pendingPath = result.filePath || "";
  if (logPathInput) logPathInput.value = pendingPath;
  setStatus("File selected. Press Load to render plots.");
}

function loadSelectedLog() {
  if (!pendingCsvText) {
    setStatus("Select a log file first.");
    return;
  }
  try {
    const dataset = buildDataset(pendingCsvText);
    renderSummary(dataset);
    renderPlots(dataset);
    setStatus(`Loaded ${pendingPath || "log file"}.`);
  } catch (error) {
    setStatus(error.message || "Failed to parse log file.");
  }
}

if (closeBtn) {
  closeBtn.addEventListener("click", () => window.close());
}
if (browseLogBtn) {
  browseLogBtn.addEventListener("click", () => {
    browseLogFile().catch(() => setStatus("Failed to open log file."));
  });
}
if (loadLogBtn) {
  loadLogBtn.addEventListener("click", loadSelectedLog);
}
if (clearLogBtn) {
  clearLogBtn.addEventListener("click", clearViewer);
}

window.addEventListener("resize", () => {
  if (!pendingCsvText || !plotGrid || !plotGrid.children.length) return;
  try {
    renderPlots(buildDataset(pendingCsvText));
  } catch (_error) {}
});
