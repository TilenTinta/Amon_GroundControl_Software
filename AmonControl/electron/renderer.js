import * as THREE from "./three/three.module.js";
import { STLLoader } from "./three/STLLoader.js";

const backendUrl = window.electronAPI
  ? window.electronAPI.backendUrl
  : "http://127.0.0.1:8002";

const appRoot = document.querySelector(".app");
const linkStatus = document.getElementById("linkStatus");
const statusDot = document.querySelector(".status-dot");
const droneStatus = document.getElementById("droneStatus");
const droneDot = document.querySelector(".drone-dot");
const settingsBtn = document.getElementById("settingsBtn");
const linkBtn = document.getElementById("linkBtn");
const pairDroneBtn = document.getElementById("pairDroneBtn");
const linkModal = document.getElementById("linkModal");
const linkCloseBtn = document.getElementById("linkCloseBtn");
const droneCards = document.querySelectorAll(".drone-card");
const backBtn = document.getElementById("backBtn");
const startFlightBtn = document.getElementById("startFlightBtn");
const droneLogo = document.getElementById("droneLogo");
const droneName = document.getElementById("droneName");
const modelViewport = document.getElementById("modelViewport");

const portSelect = document.getElementById("portSelect");
const baudSelect = document.getElementById("baudSelect");
const refreshPortsBtn = document.getElementById("refreshPorts");
const connectBtn = document.getElementById("connectBtn");

const fields = {
  flightState: document.getElementById("flightState"),
  battVoltage: document.getElementById("battVoltage"),
  signalDbm: document.getElementById("signalDbm"),
  tlmRate: document.getElementById("tlmRate"),
  gpsSat: document.getElementById("gpsSat"),
  imuTemp: document.getElementById("imuTemp"),
  baroAlt: document.getElementById("baroAlt"),
  rollVal: document.getElementById("rollVal"),
  pitchVal: document.getElementById("pitchVal"),
  yawVal: document.getElementById("yawVal"),
  groundSpeed: document.getElementById("groundSpeed"),
  climbRate: document.getElementById("climbRate"),
  heading: document.getElementById("heading"),
  mode: document.getElementById("mode"),
  tvcXp: document.getElementById("tvcXp"),
  tvcXn: document.getElementById("tvcXn"),
  tvcYp: document.getElementById("tvcYp"),
  tvcYn: document.getElementById("tvcYn"),
  tvcZp: document.getElementById("tvcZp"),
  tvcZn: document.getElementById("tvcZn"),
  throttleValue: document.getElementById("throttleValue"),
  posX: document.getElementById("posX"),
  posY: document.getElementById("posY"),
  posZ: document.getElementById("posZ"),
  velX: document.getElementById("velX"),
  velY: document.getElementById("velY"),
  velZ: document.getElementById("velZ"),
  velXs: document.getElementById("velXs"),
  velYs: document.getElementById("velYs"),
  velZs: document.getElementById("velZs"),
  velX2: document.getElementById("velX2"),
  velY2: document.getElementById("velY2"),
  velZ2: document.getElementById("velZ2"),
  accX: document.getElementById("accX"),
  accY: document.getElementById("accY"),
  accZ: document.getElementById("accZ"),
  gyroX: document.getElementById("gyroX"),
  gyroY: document.getElementById("gyroY"),
  gyroZ: document.getElementById("gyroZ"),
  tN: document.getElementById("tN"),
  tM: document.getElementById("tM"),
  posXs: document.getElementById("posXs"),
  posYs: document.getElementById("posYs"),
  posZs: document.getElementById("posZs"),
  gFx: document.getElementById("gFx"),
  gSt: document.getElementById("gSt"),
  fP: document.getElementById("fP"),
  bPs: document.getElementById("bPs"),
  tP: document.getElementById("tP"),
  bAt: document.getElementById("bAt"),
  uD: document.getElementById("uD"),
  mS: document.getElementById("mS"),
  ign: document.getElementById("ign"),
  state: document.getElementById("state"),
  clockLocal: document.getElementById("clockLocal"),
  clockMission: document.getElementById("clockMission"),
};

const chartConfig = [
  {
    id: "chartGyro",
    yLabel: "deg/s",
    xLabel: "time (s)",
    series: [
      { key: "gx", color: "#f06d6d" },
      { key: "gy", color: "#3fd2b6" },
      { key: "gz", color: "#f2b96d" },
    ],
  },
  {
    id: "chartAccel",
    yLabel: "m/s2",
    xLabel: "time (s)",
    series: [
      { key: "ax", color: "#6ed9ff" },
      { key: "ay", color: "#caa7ff" },
      { key: "az", color: "#3fd2b6" },
    ],
  },
  {
    id: "chartOriX",
    yLabel: "deg",
    xLabel: "time (s)",
    series: [
      { key: "oriX", color: "#f2b96d" },
      { key: "oriXRef", color: "#8a96a8" },
    ],
  },
  {
    id: "chartOriY",
    yLabel: "deg",
    xLabel: "time (s)",
    series: [
      { key: "oriY", color: "#4dd6a3" },
      { key: "oriYRef", color: "#8a96a8" },
    ],
  },
  {
    id: "chartOriZ",
    yLabel: "deg",
    xLabel: "time (s)",
    series: [
      { key: "oriZ", color: "#63e0ff" },
      { key: "oriZRef", color: "#8a96a8" },
    ],
  },
  {
    id: "chartAlt",
    yLabel: "m",
    xLabel: "time (s)",
    series: [
      { key: "alt", color: "#3fd2b6" },
      { key: "altRef", color: "#8a96a8" },
    ],
  },
  {
    id: "chartPos",
    yLabel: "m",
    xLabel: "time (s)",
    series: [
      { key: "posX", color: "#f06d6d" },
      { key: "posY", color: "#6ed9ff" },
      { key: "posRef", color: "#8a96a8" },
    ],
  },
  {
    id: "chartVel",
    yLabel: "m/s",
    xLabel: "time (s)",
    series: [
      { key: "velX", color: "#f2b96d" },
      { key: "velY", color: "#4dd6a3" },
      { key: "velRef", color: "#8a96a8" },
    ],
  },
  {
    id: "chartThrottle",
    yLabel: "%",
    xLabel: "time (s)",
    series: [
      { key: "thr", color: "#3fd2b6" },
      { key: "thrRef", color: "#8a96a8" },
    ],
  },
];

const charts = {};
const CHART_HZ = 50;
const CHART_INTERVAL_MS = Math.round(1000 / CHART_HZ);
const CHART_DT = 1 / CHART_HZ;
let activeDrone = "amon";
let missionStart = 0;
let missionElapsed = 0;
let missionRunning = false;
let connectedPort = "";
let orientation = { roll: 0, pitch: 0, yaw: 0 };
let simTime = 0;

let scene = null;
let camera = null;
let renderer = null;
let modelMesh = null;
let resizeObserver = null;

function pad(value) {
  return value.toString().padStart(2, "0");
}

function setLinkStatus(text) {
  linkStatus.textContent = text;
}

function updateConnectButton() {
  if (connectedPort) {
    connectBtn.textContent = "Disconnect";
    setLinkStatus(`Link online (${connectedPort})`);
    if (statusDot) statusDot.classList.add("online");
    if (pairDroneBtn) {
      pairDroneBtn.disabled = false;
      pairDroneBtn.classList.add("primary");
      pairDroneBtn.classList.remove("ghost");
    }
  } else {
    connectBtn.textContent = "Connect";
    setLinkStatus("Link offline");
    if (statusDot) statusDot.classList.remove("online");
    if (pairDroneBtn) {
      pairDroneBtn.disabled = true;
      pairDroneBtn.classList.remove("primary");
      pairDroneBtn.classList.add("ghost");
    }
  }
}

function resetMission() {
  missionRunning = false;
  missionElapsed = 0;
  missionStart = 0;
  if (startFlightBtn) {
    startFlightBtn.textContent = "Start Flight";
  }
}

function updateClocks() {
  const now = new Date();
  fields.clockLocal.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const elapsed = missionRunning
    ? missionElapsed + (Date.now() - missionStart)
    : missionElapsed;
  const totalSeconds = Math.floor(elapsed / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  fields.clockMission.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function setDrone(drone) {
  activeDrone = drone;
  appRoot.dataset.drone = drone;
  appRoot.dataset.view = "telemetry";
  resetMission();
  loadModel(drone);
  resizeThree();

  if (drone === "talon") {
    droneLogo.src = "../../Images/FLIGHTORY_logo.png";
    droneLogo.classList.add("inverted");
    droneName.textContent = "Talon 1400";
  } else {
    droneLogo.src = "../../Images/AMON_logo.png";
    droneLogo.classList.add("inverted");
    droneName.textContent = "AMON Lander";
  }
}

function clearTelemetry() {
  appRoot.dataset.view = "select";
}

async function fetchJson(path, options = {}) {
  if (!backendUrl) {
    return null;
  }
  const response = await fetch(`${backendUrl}${path}`, options);
  if (!response.ok) {
    throw new Error("Request failed");
  }
  return response.json();
}

async function refreshPorts() {
  try {
    const state = await fetchJson("/ports");
    const ports = (state && state.ports) || [];
    portSelect.innerHTML = "";
    if (state && state.error) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Install pyserial";
      portSelect.appendChild(option);
      connectedPort = "";
      updateConnectButton();
      return;
    }
    if (!ports.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No ports";
      portSelect.appendChild(option);
    } else {
      ports.forEach((port) => {
        const option = document.createElement("option");
        option.value = port;
        option.textContent = port;
        portSelect.appendChild(option);
      });
      portSelect.value = ports[0];
    }
    connectedPort = state && state.connection_port ? state.connection_port : "";
    updateConnectButton();
  } catch (error) {
    portSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "COM3";
    option.textContent = "COM3";
    portSelect.appendChild(option);
    connectedPort = "";
    updateConnectButton();
  }
}

async function connectLink() {
  if (connectedPort) {
    await disconnectLink();
    return;
  }
  const port = portSelect.value;
  const baud_rate = parseInt(baudSelect.value, 10);
  if (!port) {
    return;
  }
  try {
    const state = await fetchJson("/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port, baud_rate }),
    });
    connectedPort = state && state.connection_port ? state.connection_port : port;
    updateConnectButton();
  } catch (error) {
    connectedPort = port;
    updateConnectButton();
  }
}

async function disconnectLink() {
  try {
    await fetchJson("/disconnect", { method: "POST" });
  } catch (error) {
    // fall through
  }
  connectedPort = "";
  updateConnectButton();
}

async function fetchTelemetry() {
  try {
    const response = await fetchJson(`/telemetry?drone=${activeDrone}`);
    return response || null;
  } catch (error) {
    return null;
  }
}

async function pollLinkStatus() {
  try {
    const state = await fetchJson("/status");
    if (state && state.connection_port) {
      connectedPort = state.connection_port;
    } else {
      connectedPort = "";
    }
    updateConnectButton();
  } catch (error) {
    connectedPort = "";
    updateConnectButton();
  }
}

function zeroTelemetry() {
  return {
    flight_state: "Idle",
    battery_v: 0,
    signal_dbm: 0,
    tlm_rate: 0,
    gps_sat: 0,
    imu_temp: 0,
    baro_alt: 0,
    orientation: { roll: 0, pitch: 0, yaw: 0 },
    velocity: { vx: 0, vy: 0, vz: 0 },
    position: { x: 0, y: 0, z: 0 },
    accel: { ax: 0, ay: 0, az: 0 },
    gyro: { gx: 0, gy: 0, gz: 0 },
    throttle: 0,
    tvc: { x: 0, y: 0, z: 0 },
    link_quality: 0,
    link_latency: 0,
    packet_loss: 0,
    mode: "-",
    raw: {
      tN: 0,
      tM: 0,
      vXs: 0,
      vYs: 0,
      vZs: 0,
      pXs: 0,
      pYs: 0,
      pZs: 0,
      vX2: 0,
      vY2: 0,
      vZ2: 0,
      gFx: 0,
      gSt: 0,
      fP: 0,
      bPs: 0,
      tP: 0,
      bAt: 0,
      uD: 0,
      mS: 0,
      ign: 0,
      state: "--",
    },
  };
}

function format(value, decimals = 1) {
  return Number(value).toFixed(decimals);
}

function updateTelemetry(data) {
  const t = data || zeroTelemetry();
  if (data && typeof t.tlm_rate === "number" && t.tlm_rate > 0) {
    orientation = { ...t.orientation };
  }
  if (droneStatus && droneDot) {
    const droneOnline = Boolean(data && typeof t.tlm_rate === "number" && t.tlm_rate > 0);
    droneStatus.textContent = droneOnline ? "Drone online" : "Drone offline";
    droneDot.classList.toggle("online", droneOnline);
  }
  if (fields.flightState) fields.flightState.textContent = t.flight_state;
  if (fields.battVoltage) fields.battVoltage.textContent = `${format(t.battery_v, 2)} V`;
  if (fields.signalDbm) fields.signalDbm.textContent = `${format(t.signal_dbm, 0)} dBm`;
  if (fields.tlmRate) fields.tlmRate.textContent = `${format(t.tlm_rate, 2)} Hz`;
  if (fields.gpsSat) fields.gpsSat.textContent = `${t.gps_sat}`;
  if (fields.imuTemp) fields.imuTemp.textContent = `${format(t.imu_temp, 1)} C`;
  if (fields.baroAlt) fields.baroAlt.textContent = `${format(t.baro_alt, 1)} m`;
  if (fields.rollVal) fields.rollVal.textContent = `${format(t.orientation.roll, 1)} deg`;
  if (fields.pitchVal) fields.pitchVal.textContent = `${format(t.orientation.pitch, 1)} deg`;
  if (fields.yawVal) fields.yawVal.textContent = `${format(t.orientation.yaw, 1)} deg`;
  const groundSpeed = Math.hypot(t.velocity.vx, t.velocity.vy);
  if (fields.groundSpeed) fields.groundSpeed.textContent = `${format(groundSpeed, 1)} m/s`;
  if (fields.climbRate) fields.climbRate.textContent = `${format(t.velocity.vz, 2)} m/s`;
  if (fields.heading) fields.heading.textContent = `${format(t.orientation.yaw, 1)} deg`;
  if (fields.mode) fields.mode.textContent = t.mode;
  if (fields.throttleValue) fields.throttleValue.textContent = `${format(t.throttle, 0)} %`;
  if (fields.posX) fields.posX.textContent = `${format(t.position.x, 2)} m`;
  if (fields.posY) fields.posY.textContent = `${format(t.position.y, 2)} m`;
  if (fields.posZ) fields.posZ.textContent = `${format(t.position.z, 2)} m`;
  if (fields.velX) fields.velX.textContent = `${format(t.velocity.vx, 2)} m/s`;
  if (fields.velY) fields.velY.textContent = `${format(t.velocity.vy, 2)} m/s`;
  if (fields.velZ) fields.velZ.textContent = `${format(t.velocity.vz, 2)} m/s`;
  if (fields.accX) fields.accX.textContent = `${format(t.accel.ax, 2)} m/s2`;
  if (fields.accY) fields.accY.textContent = `${format(t.accel.ay, 2)} m/s2`;
  if (fields.accZ) fields.accZ.textContent = `${format(t.accel.az, 2)} m/s2`;
  if (fields.gyroX) fields.gyroX.textContent = `${format(t.gyro.gx, 2)} deg/s`;
  if (fields.gyroY) fields.gyroY.textContent = `${format(t.gyro.gy, 2)} deg/s`;
  if (fields.gyroZ) fields.gyroZ.textContent = `${format(t.gyro.gz, 2)} deg/s`;
  const tvcX = t.tvc.x || 0;
  const tvcY = t.tvc.y || 0;
  const tvcZ = t.tvc.z || 0;
  if (fields.tvcXp) fields.tvcXp.textContent = `${format(Math.max(0, tvcX), 2)} deg`;
  if (fields.tvcXn) fields.tvcXn.textContent = `${format(Math.max(0, -tvcX), 2)} deg`;
  if (fields.tvcYp) fields.tvcYp.textContent = `${format(Math.max(0, tvcY), 2)} deg`;
  if (fields.tvcYn) fields.tvcYn.textContent = `${format(Math.max(0, -tvcY), 2)} deg`;
  if (fields.tvcZp) fields.tvcZp.textContent = `${format(Math.max(0, tvcZ), 2)} deg`;
  if (fields.tvcZn) fields.tvcZn.textContent = `${format(Math.max(0, -tvcZ), 2)} deg`;

  const raw = t.raw || {};
  if (fields.tN) fields.tN.textContent = `${format(raw.tN ?? 0, 2)} s`;
  if (fields.tM) fields.tM.textContent = `${format(raw.tM ?? 0, 2)} s`;
  if (fields.velXs) fields.velXs.textContent = `${format(raw.vXs ?? 0, 2)}`;
  if (fields.velYs) fields.velYs.textContent = `${format(raw.vYs ?? 0, 2)}`;
  if (fields.velZs) fields.velZs.textContent = `${format(raw.vZs ?? 0, 2)}`;
  if (fields.posXs) fields.posXs.textContent = `${format(raw.pXs ?? 0, 2)} m`;
  if (fields.posYs) fields.posYs.textContent = `${format(raw.pYs ?? 0, 2)} m`;
  if (fields.posZs) fields.posZs.textContent = `${format(raw.pZs ?? 0, 2)} m`;
  if (fields.velX2) fields.velX2.textContent = `${format(raw.vX2 ?? 0, 2)} m/s`;
  if (fields.velY2) fields.velY2.textContent = `${format(raw.vY2 ?? 0, 2)} m/s`;
  if (fields.velZ2) fields.velZ2.textContent = `${format(raw.vZ2 ?? 0, 2)} m/s`;
  if (fields.gFx) fields.gFx.textContent = `${format(raw.gFx ?? 0, 2)} g`;
  if (fields.gSt) fields.gSt.textContent = `${raw.gSt ?? 0} sats`;
  if (fields.fP) fields.fP.textContent = `${format(raw.fP ?? 0, 2)} %`;
  if (fields.bPs) fields.bPs.textContent = `${format(raw.bPs ?? 0, 2)} hPa`;
  if (fields.tP) fields.tP.textContent = `${format(raw.tP ?? 0, 2)} C`;
  if (fields.bAt) fields.bAt.textContent = `${format(raw.bAt ?? 0, 2)} V`;
  if (fields.uD) fields.uD.textContent = `${format(raw.uD ?? 0, 2)} cm`;
  if (fields.mS) fields.mS.textContent = `${format(raw.mS ?? 0, 2)} kg`;
  if (fields.ign) fields.ign.textContent = `${raw.ign ?? "--"}`;
  if (fields.state) fields.state.textContent = `${raw.state ?? "--"}`;
}

function initThree() {
  if (!modelViewport) {
    return;
  }
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);

  const width = Math.max(240, modelViewport.clientWidth);
  const height = Math.max(180, modelViewport.clientHeight);
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(0, 0, 120);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(width, height);
  modelViewport.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.6);
  directional.position.set(50, 80, 100);
  scene.add(directional);

  resizeObserver = new ResizeObserver(() => {
    if (!modelViewport || !renderer || !camera) {
      return;
    }
    const w = modelViewport.clientWidth;
    const h = modelViewport.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(modelViewport);
}

function resizeThree() {
  if (!modelViewport || !renderer || !camera) {
    return;
  }
  const width = Math.max(240, modelViewport.clientWidth);
  const height = Math.max(180, modelViewport.clientHeight);
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function loadModel(drone) {
  if (!scene) {
    return;
  }
  const loader = new STLLoader();
  const fileName = "AmonLander_model.stl";
  const modelPath = new URL("../../Models/AmonLander_model.stl", import.meta.url);
  const loadFromUrl = () => {
    loader.load(
      modelPath.href,
      loadFromBuffer,
      undefined,
      (error) => {
        console.error("STL load failed", error);
      }
    );
  };
  const loadFromBuffer = (buffer) => {
    const geometry = loader.parse(buffer);
    if (modelMesh) {
      scene.remove(modelMesh);
    }
    geometry.computeVertexNormals();
    geometry.center();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.05,
      roughness: 0.8,
    });
    modelMesh = new THREE.Mesh(geometry, material);
    const box = new THREE.Box3().setFromObject(modelMesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 60 / maxDim;
    modelMesh.scale.set(scale, scale, scale);
    modelMesh.position.set(0, 0, 0);
    scene.add(modelMesh);
    resizeThree();
  };

  if (window.electronAPI && window.electronAPI.readModel) {
    window.electronAPI
      .readModel(fileName)
      .then(loadFromBuffer)
      .catch((error) => {
        console.error("STL load failed", error);
        loadFromUrl();
      });
    return;
  }
  loadFromUrl();
}

function animate() {
  if (renderer && scene && camera) {
    if (modelMesh) {
      modelMesh.rotation.x = THREE.MathUtils.degToRad(orientation.roll || 0);
      modelMesh.rotation.y = THREE.MathUtils.degToRad(orientation.pitch || 0);
      modelMesh.rotation.z = THREE.MathUtils.degToRad(orientation.yaw || 0);
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
}

function initCharts() {
  chartConfig.forEach((item) => {
    const canvas = document.getElementById(item.id);
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    charts[item.id] = {
      ctx,
      yLabel: item.yLabel,
      xLabel: item.xLabel,
      series: item.series.map((series) => ({
        key: series.key,
        color: series.color,
        data: Array(50).fill(0),
      })),
    };
  });
}

function autoscale(seriesList) {
  let min = Infinity;
  let max = -Infinity;
  seriesList.forEach((series) => {
    series.data.forEach((value) => {
      if (value < min) min = value;
      if (value > max) max = value;
    });
  });
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: -1, max: 1 };
  }
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  const pad = (max - min) * 0.1;
  return { min: min - pad, max: max + pad };
}

function drawChart(chart) {
  const { ctx, series, yLabel, xLabel } = chart;
  if (ctx.canvas.width !== ctx.canvas.clientWidth || ctx.canvas.height !== ctx.canvas.clientHeight) {
    ctx.canvas.width = ctx.canvas.clientWidth;
    ctx.canvas.height = ctx.canvas.clientHeight;
  }
  const { width, height } = ctx.canvas;
  const padLeft = 42;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const { min, max } = autoscale(series);
  const range = max - min || 1;

  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop);
  ctx.lineTo(padLeft, padTop + plotH);
  ctx.lineTo(padLeft + plotW, padTop + plotH);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop + plotH / 2);
  ctx.lineTo(padLeft + plotW, padTop + plotH / 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "11px Bahnschrift, Segoe UI, sans-serif";
  ctx.fillText(yLabel || "", padLeft, padTop - 2);
  const xLabelText = xLabel || "";
  const xLabelWidth = ctx.measureText(xLabelText).width;
  ctx.fillText(xLabelText, padLeft + plotW / 2 - xLabelWidth / 2, height - 6);
  ctx.fillText(max.toFixed(1), 6, padTop + 10);
  ctx.fillText(min.toFixed(1), 6, padTop + plotH);

  series.forEach((line) => {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    line.data.forEach((value, index) => {
      const ratio = (value - min) / range;
      const x = padLeft + (index / (line.data.length - 1)) * plotW;
      const y = padTop + (1 - ratio) * plotH;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  });
}

function updateCharts() {
  simTime += CHART_DT;
  const sample = {
    gx: Math.sin(simTime) * 1.5,
    gy: Math.cos(simTime * 0.8) * 1.2,
    gz: Math.sin(simTime * 0.6) * 1.1,
    ax: Math.sin(simTime * 0.9) * 0.8,
    ay: Math.cos(simTime * 0.7) * 0.7,
    az: 9.81 + Math.sin(simTime * 0.4) * 0.3,
    oriX: Math.sin(simTime * 0.6) * 5,
    oriY: Math.cos(simTime * 0.5) * 4,
    oriZ: Math.sin(simTime * 0.3) * 10,
    oriXRef: 0,
    oriYRef: 0,
    oriZRef: 0,
    alt: 2 + Math.sin(simTime * 0.2) * 0.5,
    altRef: 2.2,
    posX: Math.sin(simTime * 0.4) * 1.2,
    posY: Math.cos(simTime * 0.3) * 1.1,
    posRef: 0,
    velX: Math.cos(simTime * 0.4) * 0.8,
    velY: Math.sin(simTime * 0.3) * 0.7,
    velRef: 0,
    thr: 45 + Math.sin(simTime * 0.6) * 5,
    thrRef: 50,
  };

  orientation = { roll: sample.oriX, pitch: sample.oriY, yaw: sample.oriZ };

  Object.values(charts).forEach((chart) => {
    chart.series.forEach((line) => {
      line.data.shift();
      line.data.push(sample[line.key] ?? 0);
    });
    drawChart(chart);
  });
}

droneCards.forEach((card) => {
  card.addEventListener("click", () => {
    const drone = card.dataset.drone || "amon";
    setDrone(drone);
  });
});

backBtn.addEventListener("click", () => {
  clearTelemetry();
});

  if (startFlightBtn) {
    startFlightBtn.addEventListener("click", () => {
      if (!missionRunning) {
        missionRunning = true;
        missionStart = Date.now();
        startFlightBtn.textContent = "Stop Flight";
        fetchJson("/ping", { method: "POST" }).catch((error) => {
          console.warn("Ping failed", error);
        });
      } else {
        missionRunning = false;
        missionElapsed += Date.now() - missionStart;
        startFlightBtn.textContent = "Start Flight";
      }
    });
  }

settingsBtn.addEventListener("click", () => {
  if (window.electronAPI && window.electronAPI.openFirmwareUpdater) {
    window.electronAPI.openFirmwareUpdater();
    return;
  }
  window.open("about:blank#fw-updater", "_blank", "noopener");
});

if (refreshPortsBtn) {
  refreshPortsBtn.addEventListener("click", () => {
    refreshPorts().catch(() => {});
  });
}

if (connectBtn) {
  connectBtn.addEventListener("click", () => {
    connectLink().catch(() => {});
  });
}

if (linkBtn) {
  linkBtn.addEventListener("click", () => {
    if (linkModal) {
      linkModal.classList.remove("hidden");
    }
  });
}

if (pairDroneBtn) {
  pairDroneBtn.addEventListener("click", async () => {
    if (droneStatus) {
      droneStatus.textContent = "Drone pairing...";
    }
    if (droneDot) {
      droneDot.classList.remove("online");
    }
    try {
      const result = await fetchJson("/pair", { method: "POST" });
      const ok = result && result.ok;
      if (droneStatus) {
        droneStatus.textContent = ok ? "Drone online" : "Drone offline";
      }
      if (droneDot) {
        droneDot.classList.toggle("online", Boolean(ok));
      }
    } catch (error) {
      if (droneStatus) {
        droneStatus.textContent = "Drone offline";
      }
      if (droneDot) {
        droneDot.classList.remove("online");
      }
      console.warn("Pairing failed", error);
    }
  });
}

if (linkCloseBtn) {
  linkCloseBtn.addEventListener("click", () => {
    if (linkModal) {
      linkModal.classList.add("hidden");
    }
  });
}

if (linkModal) {
  linkModal.addEventListener("click", (event) => {
    if (event.target === linkModal) {
      linkModal.classList.add("hidden");
    }
  });
}

initCharts();
updateCharts();
updateClocks();
updateTelemetry(zeroTelemetry());
initThree();
loadModel(activeDrone);
animate();
refreshPorts().catch(() => {});

setInterval(updateClocks, 1000);
setInterval(updateCharts, CHART_INTERVAL_MS);
setInterval(async () => {
  const data = await fetchTelemetry();
  updateTelemetry(data || zeroTelemetry());
}, 1500);
setInterval(() => {
  pollLinkStatus().catch(() => {});
}, 2000);
