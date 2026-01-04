import * as THREE from "./three/three.module.js";
import { STLLoader } from "./three/STLLoader.js";

const backendUrl = window.electronAPI ? window.electronAPI.backendUrl : "";

const appRoot = document.querySelector(".app");
const linkStatus = document.getElementById("linkStatus");
const settingsBtn = document.getElementById("settingsBtn");
const linkBtn = document.getElementById("linkBtn");
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
  linkQuality: document.getElementById("linkQuality"),
  linkLatency: document.getElementById("linkLatency"),
  packetLoss: document.getElementById("packetLoss"),
  tvcX: document.getElementById("tvcX"),
  tvcY: document.getElementById("tvcY"),
  tvcZ: document.getElementById("tvcZ"),
  throttleValue: document.getElementById("throttleValue"),
  posX: document.getElementById("posX"),
  posY: document.getElementById("posY"),
  posZ: document.getElementById("posZ"),
  velX: document.getElementById("velX"),
  velY: document.getElementById("velY"),
  velZ: document.getElementById("velZ"),
  accX: document.getElementById("accX"),
  accY: document.getElementById("accY"),
  accZ: document.getElementById("accZ"),
  clockLocal: document.getElementById("clockLocal"),
  clockMission: document.getElementById("clockMission"),
};

const chartConfig = [
  { id: "chartGyro", color: "#3fd2b6" },
  { id: "chartAccel", color: "#6ed9ff" },
  { id: "chartOriX", color: "#f2b96d" },
  { id: "chartOriY", color: "#f06d6d" },
  { id: "chartOriZ", color: "#caa7ff" },
  { id: "chartAlt", color: "#3fd2b6" },
  { id: "chartPos", color: "#6ed9ff" },
  { id: "chartVel", color: "#f2b96d" },
  { id: "chartThrottle", color: "#3fd2b6" },
];

const charts = {};
let activeDrone = "amon";
let missionStart = 0;
let missionElapsed = 0;
let missionRunning = false;
let connectedPort = "";
let orientation = { roll: 0, pitch: 0, yaw: 0 };

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
  } else {
    connectBtn.textContent = "Connect";
    setLinkStatus("Link offline");
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

  if (drone === "talon") {
    droneLogo.src = "../../Images/FLIGHTORY_logo.png";
    droneLogo.classList.remove("inverted");
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
    throttle: 0,
    tvc: { x: 0, y: 0, z: 0 },
    link_quality: 0,
    link_latency: 0,
    packet_loss: 0,
    mode: "-",
  };
}

function format(value, decimals = 1) {
  return Number(value).toFixed(decimals);
}

function updateTelemetry(data) {
  const t = data || zeroTelemetry();
  orientation = { ...t.orientation };
  fields.flightState.textContent = t.flight_state;
  fields.battVoltage.textContent = `${format(t.battery_v, 2)} V`;
  fields.signalDbm.textContent = `${format(t.signal_dbm, 0)} dBm`;
  fields.tlmRate.textContent = `${format(t.tlm_rate, 2)} Hz`;
  fields.gpsSat.textContent = `${t.gps_sat}`;
  fields.imuTemp.textContent = `${format(t.imu_temp, 1)} C`;
  fields.baroAlt.textContent = `${format(t.baro_alt, 1)} m`;
  fields.rollVal.textContent = `${format(t.orientation.roll, 1)}`;
  fields.pitchVal.textContent = `${format(t.orientation.pitch, 1)}`;
  fields.yawVal.textContent = `${format(t.orientation.yaw, 1)}`;
  const groundSpeed = Math.hypot(t.velocity.vx, t.velocity.vy);
  fields.groundSpeed.textContent = `${format(groundSpeed, 1)} m/s`;
  fields.climbRate.textContent = `${format(t.velocity.vz, 2)} m/s`;
  fields.heading.textContent = `${format(t.orientation.yaw, 1)} deg`;
  fields.mode.textContent = t.mode;
  fields.linkQuality.textContent = `${format(t.link_quality, 0)} %`;
  fields.linkLatency.textContent = `${format(t.link_latency, 0)} ms`;
  fields.packetLoss.textContent = `${format(t.packet_loss, 2)} %`;
  fields.tvcX.textContent = `${format(t.tvc.x, 2)} deg`;
  fields.tvcY.textContent = `${format(t.tvc.y, 2)} deg`;
  fields.tvcZ.textContent = `${format(t.tvc.z, 2)} deg`;
  fields.throttleValue.textContent = `${format(t.throttle, 0)} %`;
  fields.posX.textContent = `${format(t.position.x, 2)} m`;
  fields.posY.textContent = `${format(t.position.y, 2)} m`;
  fields.posZ.textContent = `${format(t.position.z, 2)} m`;
  fields.velX.textContent = `${format(t.velocity.vx, 2)} m/s`;
  fields.velY.textContent = `${format(t.velocity.vy, 2)} m/s`;
  fields.velZ.textContent = `${format(t.velocity.vz, 2)} m/s`;
  fields.accX.textContent = `${format(t.accel.ax, 2)} m/s2`;
  fields.accY.textContent = `${format(t.accel.ay, 2)} m/s2`;
  fields.accZ.textContent = `${format(t.accel.az, 2)} m/s2`;
}

function initThree() {
  if (!modelViewport) {
    return;
  }
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);

  const width = modelViewport.clientWidth;
  const height = modelViewport.clientHeight;
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

function loadModel(drone) {
  if (!scene) {
    return;
  }
  const modelPath = "../../Models/AmonLander_model.stl";
  const loader = new STLLoader();
  loader.load(
    modelPath,
    (geometry) => {
      if (modelMesh) {
        scene.remove(modelMesh);
      }
      geometry.center();
      const material = new THREE.MeshStandardMaterial({
        color: 0x3fd2b6,
        metalness: 0.2,
        roughness: 0.55,
      });
      modelMesh = new THREE.Mesh(geometry, material);
      modelMesh.scale.set(0.4, 0.4, 0.4);
      scene.add(modelMesh);
    },
    undefined,
    () => {
      // Model failed to load.
    }
  );
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
      color: item.color,
      data: Array(40).fill(0),
    };
  });
}

function drawChart(chart) {
  const { ctx, data, color } = chart;
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height / 2 - value * (height / 3);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

function updateCharts() {
  Object.values(charts).forEach((chart) => {
    chart.data.shift();
    chart.data.push(0);
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
    } else {
      missionRunning = false;
      missionElapsed += Date.now() - missionStart;
      startFlightBtn.textContent = "Start Flight";
    }
  });
}

settingsBtn.addEventListener("click", () => {
  window.alert("Settings panel coming soon.");
});

refreshPortsBtn.addEventListener("click", () => {
  refreshPorts().catch(() => {});
});

connectBtn.addEventListener("click", () => {
  connectLink().catch(() => {});
});

if (linkBtn) {
  linkBtn.addEventListener("click", () => {
    if (linkModal) {
      linkModal.classList.remove("hidden");
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
setInterval(updateCharts, 1200);
setInterval(async () => {
  const data = await fetchTelemetry();
  updateTelemetry(data || zeroTelemetry());
}, 1500);
