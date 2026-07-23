const closeBtn = document.getElementById("closeBtn");
const browseLogBtn = document.getElementById("browseLogBtn");
const loadLogBtn = document.getElementById("loadLogBtn");
const resetZoomBtn = document.getElementById("resetZoomBtn");
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
let currentDataset = null;
let zoomState = { start: 0, end: 1, max: 1 };
let activePan = null;

const PLOT_GROUPS = [
  {
    title: "Drone Orientation",
    yLabel: "deg",
    series: [
      { key: "pitch", label: "Pitch", color: "#6ed9ff" },
      { key: "roll", label: "Roll", color: "#f06d6d" },
      { key: "yaw", label: "Yaw", color: "#4dd6a3" },
    ],
  },
  {
    title: "Heading",
    yLabel: "deg",
    series: [{ key: "heading_deg", label: "Heading", color: "#f3d36b" }],
  },
  {
    title: "TVC Servo Angles",
    yLabel: "deg",
    series: [
      { key: "servo_xp", label: "X+", color: "#f06d6d" },
      { key: "servo_xn", label: "X-", color: "#f2b96d" },
      { key: "servo_yp", label: "Y+", color: "#4dd6a3" },
      { key: "servo_yn", label: "Y-", color: "#6ed9ff" },
    ],
  },
  {
    title: "EDF Throttle",
    yLabel: "%",
    series: [{ key: "edf_percent", label: "EDF", color: "#f06d6d" }],
  },
  {
    title: "NMPC Solve Time",
    yLabel: "us",
    series: [{ key: "nmpc_solver_time", label: "Solve", color: "#caa7ff" }],
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
    yLabel: "cm",
    series: [
      { key: "height_tof_filtered_cm", label: "Filtered", color: "#3fd2b6" },
      { key: "height_tof_cm", label: "Raw", color: "#8a96a8" },
    ],
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

function decodeBatteryVoltage(raw) {
  if (!Number.isFinite(raw)) return null;
  if (raw <= 0) return 0;
  if (raw < 100) return raw;
  return raw < 10000 ? raw / 100 : raw / 1000;
}

function isInRange(value, min, max) {
  return !Number.isFinite(value) || (value >= min && value <= max);
}

function isValidLogRow(row) {
  if (!Number.isFinite(row.timestamp)) return false;
  if (!isInRange(row.servo_xp, -180, 180)) return false;
  if (!isInRange(row.servo_xn, -180, 180)) return false;
  if (!isInRange(row.servo_yp, -180, 180)) return false;
  if (!isInRange(row.servo_yn, -180, 180)) return false;
  if (!isInRange(row.nmpc_solver_time, 0, 1000000)) return false;
  if (!isInRange(row.nmpc_solve_status, -10000, 10000)) return false;
  if (!isInRange(row.nmpc_last_qp_iter, -10000, 10000)) return false;
  if (!isInRange(row.nmpc_last_qp_status, -10000, 10000)) return false;
  if (!isInRange(row.heading_deg, -360, 360)) return false;
  if (!isInRange(row.pitch, -360, 360)) return false;
  if (!isInRange(row.roll, -360, 360)) return false;
  if (!isInRange(row.yaw, -360, 360)) return false;
  if (!isInRange(row.accel_x, -50, 50)) return false;
  if (!isInRange(row.accel_y, -50, 50)) return false;
  if (!isInRange(row.accel_z, -50, 50)) return false;
  if (!isInRange(row.gyro_x, -5000, 5000)) return false;
  if (!isInRange(row.gyro_y, -5000, 5000)) return false;
  if (!isInRange(row.gyro_z, -5000, 5000)) return false;
  if (!isInRange(row.quaternion_w, -1.1, 1.1)) return false;
  if (!isInRange(row.quaternion_x, -1.1, 1.1)) return false;
  if (!isInRange(row.quaternion_y, -1.1, 1.1)) return false;
  if (!isInRange(row.quaternion_z, -1.1, 1.1)) return false;
  if (!isInRange(row.height_tof_m_filtered, 0, 1000)) return false;
  if (!isInRange(row.height_tof_mm, 0, 100000)) return false;
  if (!isInRange(row.height_baro_m, 0, 10000)) return false;
  if (!isInRange(row.battery_main_voltage, 0, 100000)) return false;
  if (!isInRange(row.battery_edf_voltage, 0, 100000)) return false;
  if (!isInRange(row.temperature, 0, 10000)) return false;
  if (!isInRange(row.pressure, 30000, 120000)) return false;
  if (!isInRange(row.humidity, 0, 100)) return false;
  if (!isInRange(row.edf_percent, 0, 100)) return false;
  return true;
}

function hasContinuousTimestamp(row, previousRow) {
  if (!previousRow) return true;
  const delta = row.timestamp - previousRow.timestamp;
  return Number.isFinite(delta) && delta > 0 && delta <= 1000;
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

  const validRows = [];
  for (const row of dataRows) {
    const previousRow = validRows[validRows.length - 1];
    if (!isValidLogRow(row) || !hasContinuousTimestamp(row, previousRow)) {
      if (validRows.length) break;
      continue;
    }
    validRows.push(row);
  }

  if (!validRows.length) {
    throw new Error("Selected file has no valid log rows.");
  }

  const firstTimestamp = validRows.find((row) => Number.isFinite(row.timestamp))?.timestamp || 0;
  validRows.forEach((row) => {
    row.time_sec = Number.isFinite(row.timestamp) ? (row.timestamp - firstTimestamp) / 1000 : 0;
    row.pressure_hpa = Number.isFinite(row.pressure) ? row.pressure / 100 : null;
    row.height_tof_cm = Number.isFinite(row.height_tof_mm) ? row.height_tof_mm / 10 : null;
    row.height_tof_filtered_cm = Number.isFinite(row.height_tof_m_filtered)
      ? row.height_tof_m_filtered * 100
      : null;
    row.height_baro_m = Number.isFinite(row.height_baro_m) ? row.height_baro_m : null;
    row.nmpc_solver_time = Number.isFinite(row.nmpc_solver_time) ? row.nmpc_solver_time : null;
    row.edf_percent = Number.isFinite(row.edf_percent) ? row.edf_percent : null;
    row.temperature_c = Number.isFinite(row.temperature) ? row.temperature / 100 : null;
    row.battery_main_voltage_v = decodeBatteryVoltage(row.battery_main_voltage);
    row.battery_edf_voltage_v = decodeBatteryVoltage(row.battery_edf_voltage);
    row.gyro_temp_c = Number.isFinite(row.gyro_temp) ? row.gyro_temp / 100 : null;
  });

  return { headers, rows: validRows, droppedRows: dataRows.length - validRows.length };
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

function resetZoom(redraw = true) {
  const max = currentDataset && currentDataset.rows.length
    ? Math.max(...currentDataset.rows.map((row) => row.time_sec || 0), 1)
    : 1;
  zoomState = { start: 0, end: max, max };
  if (redraw) redrawPlots();
}

function clampZoom(start, end) {
  const max = zoomState.max || 1;
  const minSpan = Math.min(max, Math.max(0.05, max / 500));
  let nextStart = Number.isFinite(start) ? start : 0;
  let nextEnd = Number.isFinite(end) ? end : max;
  if (nextEnd - nextStart < minSpan) {
    const center = (nextStart + nextEnd) / 2;
    nextStart = center - minSpan / 2;
    nextEnd = center + minSpan / 2;
  }
  const span = nextEnd - nextStart;
  if (nextStart < 0) {
    nextStart = 0;
    nextEnd = span;
  }
  if (nextEnd > max) {
    nextEnd = max;
    nextStart = max - span;
  }
  zoomState.start = Math.max(0, nextStart);
  zoomState.end = Math.min(max, nextEnd);
}

function getPlotMetrics(canvas) {
  const width = Math.max(320, canvas.clientWidth);
  const height = Math.max(220, canvas.clientHeight);
  const padLeft = 54;
  const padRight = 18;
  const padTop = 20;
  const padBottom = 34;
  return {
    width,
    height,
    padLeft,
    padRight,
    padTop,
    padBottom,
    plotW: width - padLeft - padRight,
    plotH: height - padTop - padBottom,
  };
}

function timeAtCanvasX(canvas, clientX) {
  const rect = canvas.getBoundingClientRect();
  const metrics = getPlotMetrics(canvas);
  const x = Math.min(
    metrics.padLeft + metrics.plotW,
    Math.max(metrics.padLeft, clientX - rect.left)
  );
  const ratio = (x - metrics.padLeft) / metrics.plotW;
  return zoomState.start + ratio * (zoomState.end - zoomState.start);
}

function visibleRows(rows) {
  return rows.filter((row) => {
    const time = row.time_sec || 0;
    return time >= zoomState.start && time <= zoomState.end;
  });
}

function drawPlot(canvas, rows, group) {
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const { width, height, padLeft, padTop, plotW, plotH } = getPlotMetrics(canvas);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const maxTime = zoomState.max || Math.max(...rows.map((row) => row.time_sec || 0), 1);
  const startTime = Math.max(0, zoomState.start);
  const endTime = Math.min(maxTime, zoomState.end);
  const timeSpan = Math.max(0.001, endTime - startTime);
  const rowsInView = visibleRows(rows);
  const range = valueRange(rowsInView.length ? rowsInView : rows, group.series);
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
  const xLabel =
    startTime <= 0 && endTime >= maxTime
      ? `time (s), max ${maxTime.toFixed(2)}`
      : `time (s), ${startTime.toFixed(2)}-${endTime.toFixed(2)}`;
  ctx.fillText(xLabel, padLeft + plotW / 2 - ctx.measureText(xLabel).width / 2, height - 8);

  const drawableRows = rowsInView.length ? rowsInView : rows;
  const step = Math.max(1, Math.ceil(drawableRows.length / 1800));
  group.series.forEach((line) => {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < drawableRows.length; i += step) {
      const row = drawableRows[i];
      const value = row[line.key];
      if (!Number.isFinite(value)) continue;
      const x = padLeft + (((row.time_sec || 0) - startTime) / timeSpan) * plotW;
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

function redrawPlots() {
  if (!currentDataset || !plotGrid) return;
  const canvases = plotGrid.querySelectorAll("canvas.log-chart");
  canvases.forEach((canvas) => {
    const group = canvas._logGroup;
    if (group) {
      drawPlot(canvas, currentDataset.rows, group);
    }
  });
}

function handlePlotWheel(event) {
  if (!currentDataset) return;
  event.preventDefault();
  const focusTime = timeAtCanvasX(event.currentTarget, event.clientX);
  const span = zoomState.end - zoomState.start;
  const zoomFactor = event.deltaY < 0 ? 0.82 : 1.22;
  const nextSpan = span * zoomFactor;
  const focusRatio = (focusTime - zoomState.start) / span;
  const nextStart = focusTime - nextSpan * focusRatio;
  const nextEnd = nextStart + nextSpan;
  clampZoom(nextStart, nextEnd);
  redrawPlots();
}

function handlePlotPointerDown(event) {
  if (!currentDataset || event.button !== 0) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  activePan = {
    pointerId: event.pointerId,
    startX: event.clientX,
    zoomStart: zoomState.start,
    zoomEnd: zoomState.end,
    canvas: event.currentTarget,
  };
}

function handlePlotPointerMove(event) {
  if (!activePan || activePan.pointerId !== event.pointerId) return;
  const metrics = getPlotMetrics(activePan.canvas);
  const span = activePan.zoomEnd - activePan.zoomStart;
  const deltaTime = -((event.clientX - activePan.startX) / metrics.plotW) * span;
  clampZoom(activePan.zoomStart + deltaTime, activePan.zoomEnd + deltaTime);
  redrawPlots();
}

function handlePlotPointerUp(event) {
  if (!activePan || activePan.pointerId !== event.pointerId) return;
  activePan = null;
}

function handlePlotDoubleClick() {
  resetZoom(true);
}

function bindPlotInteractions(canvas) {
  canvas.addEventListener("wheel", handlePlotWheel, { passive: false });
  canvas.addEventListener("pointerdown", handlePlotPointerDown);
  canvas.addEventListener("pointermove", handlePlotPointerMove);
  canvas.addEventListener("pointerup", handlePlotPointerUp);
  canvas.addEventListener("pointercancel", handlePlotPointerUp);
  canvas.addEventListener("dblclick", handlePlotDoubleClick);
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
    canvas._logGroup = { ...group, series: availableSeries };
    bindPlotInteractions(canvas);
    card.appendChild(head);
    card.appendChild(canvas);
    plotGrid.appendChild(card);
    drawPlot(canvas, dataset.rows, canvas._logGroup);
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
  currentDataset = null;
  zoomState = { start: 0, end: 1, max: 1 };
  activePan = null;
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
    currentDataset = dataset;
    resetZoom(false);
    renderSummary(dataset);
    renderPlots(dataset);
    const dropped =
      dataset.droppedRows > 0 ? ` Dropped ${dataset.droppedRows} invalid rows.` : "";
    setStatus(`Loaded ${pendingPath || "log file"}.${dropped}`);
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
if (resetZoomBtn) {
  resetZoomBtn.addEventListener("click", () => resetZoom(true));
}
if (clearLogBtn) {
  clearLogBtn.addEventListener("click", clearViewer);
}

window.addEventListener("resize", () => {
  redrawPlots();
});
