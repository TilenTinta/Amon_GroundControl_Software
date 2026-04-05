const closeBtn = document.getElementById("closeBtn");
const importPlanBtn = document.getElementById("importPlanBtn");
const clearPlanBtn = document.getElementById("clearPlanBtn");
const exportPlanBtn = document.getElementById("exportPlanBtn");
const sendPlanBtn = document.getElementById("sendPlanBtn");
const profileStatus = document.getElementById("profileStatus");
const profileName = document.getElementById("profileName");
const profileVehicle = document.getElementById("profileVehicle");
const profileNotes = document.getElementById("profileNotes");
const waypointCount = document.getElementById("waypointCount");
const maxAlt = document.getElementById("maxAlt");
const profileList = document.getElementById("profileList");
const editProfileName = document.getElementById("editProfileName");
const editProfileVehicle = document.getElementById("editProfileVehicle");
const editProfileNotes = document.getElementById("editProfileNotes");
const commandSelect = document.getElementById("commandSelect");
const commandParams = document.getElementById("commandParams");
const addCommandBtn = document.getElementById("addCommandBtn");

let currentProfile = null;

const COMMAND_DEFS = [
  { id: "COMM_TAKE_OFF", label: "Take off", params: [{ key: "height_cm", label: "Height (cm)" }] },
  { id: "COMM_LAND", label: "Land", params: [{ key: "delay_s", label: "Delay (s)" }] },
  {
    id: "COMM_HEIGHT",
    label: "Height",
    params: [
      { key: "height_cm", label: "Height (cm)" },
      { key: "speed_cm_s", label: "Speed (cm/s)" },
    ],
  },
  {
    id: "COMM_FORWARD",
    label: "Forward",
    params: [
      { key: "distance_cm", label: "Distance (cm)" },
      { key: "speed_cm_s", label: "Speed (cm/s)" },
    ],
  },
  {
    id: "COMM_BACKWARD",
    label: "Backward",
    params: [
      { key: "distance_cm", label: "Distance (cm)" },
      { key: "speed_cm_s", label: "Speed (cm/s)" },
    ],
  },
  {
    id: "COMM_LEFT",
    label: "Left",
    params: [
      { key: "distance_cm", label: "Distance (cm)" },
      { key: "speed_cm_s", label: "Speed (cm/s)" },
    ],
  },
  {
    id: "COMM_RIGHT",
    label: "Right",
    params: [
      { key: "distance_cm", label: "Distance (cm)" },
      { key: "speed_cm_s", label: "Speed (cm/s)" },
    ],
  },
  {
    id: "COMM_ROTATE_CW",
    label: "Rotate CW",
    params: [
      { key: "angle_deg", label: "Angle (deg)" },
      { key: "speed_deg_s", label: "Speed (deg/s)" },
    ],
  },
  {
    id: "COMM_ROTATE_CCW",
    label: "Rotate CCW",
    params: [
      { key: "angle_deg", label: "Angle (deg)" },
      { key: "speed_deg_s", label: "Speed (deg/s)" },
    ],
  },
  { id: "COMM_WAIT", label: "Wait", params: [{ key: "time_s", label: "Time (s)" }] },
  {
    id: "COMM_HOVER",
    label: "Hover",
    params: [
      { key: "time_s", label: "Time (s)" },
      { key: "height_cm", label: "Height (cm)" },
    ],
  },
  {
    id: "COMM_FOLLOW",
    label: "Follow",
    params: [
      { key: "follow_mode", label: "Mode (0/1/2)" },
      { key: "distance_cm", label: "Distance (cm)" },
      { key: "timeout_s", label: "Timeout (s)" },
    ],
  },
  {
    id: "COMM_ACTION",
    label: "Action",
    params: [
      { key: "action_id", label: "Action ID" },
      { key: "parameter1", label: "Param 1" },
      { key: "parameter2", label: "Param 2" },
    ],
  },
  {
    id: "COMM_RETURN_HOME",
    label: "Return home",
    params: [
      { key: "height_cm", label: "Height (cm)" },
      { key: "speed_cm_s", label: "Speed (cm/s)" },
    ],
  },
];

function setText(node, value) {
  if (!node) return;
  node.textContent = value;
}

function setStatus(message) {
  if (!profileStatus) return;
  const text = message || "";
  profileStatus.textContent = text;
  profileStatus.classList.toggle("hidden", !text);
}

function normalizeCommandName(value) {
  if (!value) return "";
  const name = String(value).trim();
  if (!name) return "";
  return name.startsWith("COMM_") ? name : `COMM_${name}`;
}

function ensureProfileShape(profile) {
  const safe = profile && typeof profile === "object" ? profile : {};
  const commands = Array.isArray(safe.commands) ? safe.commands : [];
  return {
    schema: safe.schema || "amon.flight_profile.v1",
    name: safe.name || "Untitled Profile",
    vehicle: safe.vehicle || "",
    notes: safe.notes || "",
    commands: commands
      .filter((c) => c && typeof c === "object")
      .map((c, index) => ({
        command_id: typeof c.command_id === "number" ? c.command_id : index,
        command: normalizeCommandName(c.command) || "",
        data: c.data && typeof c.data === "object" ? c.data : {},
      })),
  };
}

async function persistProfile(profile) {
  if (!window.electronAPI || !window.electronAPI.flightPlanningSetProfile) {
    return;
  }
  try {
    await window.electronAPI.flightPlanningSetProfile(profile);
  } catch (_error) {}
}

async function clearPersistedProfile() {
  if (!window.electronAPI || !window.electronAPI.flightPlanningClearProfile) {
    return;
  }
  try {
    await window.electronAPI.flightPlanningClearProfile();
  } catch (_error) {}
}

function nextCommandId(commands) {
  let maxId = -1;
  commands.forEach((c) => {
    if (c && typeof c.command_id === "number") {
      maxId = Math.max(maxId, c.command_id);
    }
  });
  return maxId + 1;
}

function clampInt(value, fallback = 0) {
  const num = Number.parseInt(String(value), 10);
  return Number.isFinite(num) ? num : fallback;
}

function getDefForCommand(command) {
  const id = normalizeCommandName(command);
  return COMMAND_DEFS.find((d) => d.id === id) || null;
}

function syncEditorFields(profile) {
  if (!profile) return;
  if (editProfileName) editProfileName.value = profile.name || "";
  if (editProfileVehicle) editProfileVehicle.value = profile.vehicle || "";
  if (editProfileNotes) editProfileNotes.value = profile.notes || "";
}

function populateCommandSelect() {
  if (!commandSelect) return;
  commandSelect.innerHTML = "";
  COMMAND_DEFS.forEach((def) => {
    const opt = document.createElement("option");
    opt.value = def.id;
    opt.textContent = `${def.id} — ${def.label}`;
    commandSelect.appendChild(opt);
  });
}

function renderCommandParams(command) {
  if (!commandParams) return;
  commandParams.innerHTML = "";
  const def = getDefForCommand(command);
  if (!def) return;

  def.params.forEach((p) => {
    const label = document.createElement("label");
    label.className = "builder-field";

    const title = document.createElement("span");
    title.className = "builder-label";
    title.textContent = p.label;

    const input = document.createElement("input");
    input.className = "builder-input";
    input.type = "number";
    input.inputMode = "numeric";
    input.dataset.key = p.key;
    input.value = "0";

    label.appendChild(title);
    label.appendChild(input);
    commandParams.appendChild(label);
  });
}

function readCommandParams() {
  const data = {};
  if (!commandParams) return data;
  const inputs = commandParams.querySelectorAll("input[data-key]");
  inputs.forEach((node) => {
    const key = node.dataset.key;
    if (!key) return;
    data[key] = clampInt(node.value, 0);
  });
  return data;
}

function formatParams(command, data) {
  const cmd = normalizeCommandName(command);
  const d = data && typeof data === "object" ? data : {};

  switch (cmd) {
    case "COMM_TAKE_OFF":
      return `height_cm=${d.height_cm ?? "--"}`;
    case "COMM_LAND":
      return `delay_s=${d.delay_s ?? "--"}`;
    case "COMM_HEIGHT":
      return `height_cm=${d.height_cm ?? "--"}, speed_cm_s=${d.speed_cm_s ?? "--"}`;
    case "COMM_FORWARD":
    case "COMM_BACKWARD":
    case "COMM_LEFT":
    case "COMM_RIGHT":
      return `distance_cm=${d.distance_cm ?? "--"}, speed_cm_s=${d.speed_cm_s ?? "--"}`;
    case "COMM_ROTATE_CW":
    case "COMM_ROTATE_CCW":
      return `angle_deg=${d.angle_deg ?? "--"}, speed_deg_s=${d.speed_deg_s ?? "--"}`;
    case "COMM_WAIT":
      return `time_s=${d.time_s ?? "--"}`;
    case "COMM_HOVER":
      return `time_s=${d.time_s ?? "--"}, height_cm=${d.height_cm ?? "--"}`;
    case "COMM_FOLLOW":
      return `follow_mode=${d.follow_mode ?? "--"}, distance_cm=${d.distance_cm ?? "--"}, timeout_s=${d.timeout_s ?? "--"}`;
    case "COMM_ACTION":
      return `action_id=${d.action_id ?? "--"}, parameter1=${d.parameter1 ?? "--"}, parameter2=${d.parameter2 ?? "--"}`;
    case "COMM_RETURN_HOME":
      return `height_cm=${d.height_cm ?? "--"}, speed_cm_s=${d.speed_cm_s ?? "--"}`;
    default:
      return Object.keys(d).length ? JSON.stringify(d) : "--";
  }
}

function renderEmptyList(message) {
  if (!profileList) return;
  profileList.innerHTML = "";
  const row = document.createElement("div");
  row.className = "profile-empty";
  row.textContent = message;
  profileList.appendChild(row);
}

function renderProfile(profile) {
  const name = (profile && profile.name) || "Untitled Profile";
  const vehicle = (profile && profile.vehicle) || "--";
  const notes = (profile && profile.notes) || "--";
  const commands = (profile && Array.isArray(profile.commands) && profile.commands) || [];

  setText(profileName, name);
  setText(profileVehicle, vehicle);
  setText(profileNotes, notes);
  setText(waypointCount, String(commands.length));
  setStatus("");

  let maxHeightCm = null;
  commands.forEach((c) => {
    const cmd = normalizeCommandName(c.command);
    const height = c && c.data && c.data.height_cm;
    if (
      typeof height === "number" &&
      (cmd === "COMM_TAKE_OFF" ||
        cmd === "COMM_HOVER" ||
        cmd === "COMM_HEIGHT" ||
        cmd === "COMM_RETURN_HOME")
    ) {
      maxHeightCm = maxHeightCm === null ? height : Math.max(maxHeightCm, height);
    }
  });
  setText(maxAlt, maxHeightCm === null ? "-- m" : `${(maxHeightCm / 100).toFixed(2)} m`);

  if (!profileList) return;
  profileList.innerHTML = "";

  if (commands.length === 0) {
    renderEmptyList("No commands in this profile.");
    return;
  }

  commands.forEach((cmd, index) => {
    const row = document.createElement("div");
    row.className = "profile-row";
    row.setAttribute("role", "listitem");

    const cellIndex = document.createElement("div");
    cellIndex.className = "profile-cell-muted";
    cellIndex.textContent = String(cmd.command_id ?? index);

    const cellCommand = document.createElement("div");
    cellCommand.textContent = normalizeCommandName(cmd.command) || "--";

    const cellParams = document.createElement("div");
    cellParams.className = "profile-cell-muted";
    cellParams.textContent = formatParams(cmd.command, cmd.data);

    const cellRemove = document.createElement("div");
    const removeBtn = document.createElement("button");
    removeBtn.className = "profile-remove-btn";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove command";
    removeBtn.addEventListener("click", () => {
      if (!currentProfile) return;
      currentProfile.commands.splice(index, 1);
      currentProfile.commands = currentProfile.commands.map((c, i) => ({
        ...c,
        command_id: typeof c.command_id === "number" ? c.command_id : i,
      }));
      persistProfile(currentProfile);
      renderProfile(currentProfile);
      syncEditorFields(currentProfile);
    });
    cellRemove.appendChild(removeBtn);

    row.appendChild(cellIndex);
    row.appendChild(cellCommand);
    row.appendChild(cellParams);
    row.appendChild(cellRemove);
    profileList.appendChild(row);
  });
}

async function importProfile() {
  if (!window.electronAPI || !window.electronAPI.selectFlightProfile) {
    setStatus("Import is not available in this build.");
    return;
  }
  const result = await window.electronAPI.selectFlightProfile();
  if (!result || !result.ok) {
    if (result && result.canceled) {
      return;
    }
    setStatus((result && result.error) || "Failed to import profile.");
    return;
  }
  try {
    const jsonText = String(result.jsonText || "").replace(/^\uFEFF/, "");
    const parsed = ensureProfileShape(JSON.parse(jsonText));
    currentProfile = parsed;
    await persistProfile(currentProfile);
    renderProfile(currentProfile);
    syncEditorFields(currentProfile);
  } catch (error) {
    setStatus("Selected file is not valid JSON.");
  }
}

async function saveProfileAs() {
  if (!currentProfile) {
    setStatus("Nothing to save yet. Import a profile or add commands.");
    return;
  }
  if (!window.electronAPI || !window.electronAPI.saveFlightProfile) {
    setStatus("Save is not available in this build.");
    return;
  }
  const jsonText = JSON.stringify(currentProfile, null, 2);
  const result = await window.electronAPI.saveFlightProfile(
    `${(currentProfile.name || "flight_profile").replace(/[\\\\/:*?\"<>|]/g, "_")}.json`,
    jsonText
  );
  if (!result || !result.ok) {
    if (result && result.canceled) return;
    setStatus((result && result.error) || "Failed to save profile.");
    return;
  }
  setStatus("Saved.");
}

function applyEditorToProfile() {
  if (!currentProfile) return;
  if (editProfileName) currentProfile.name = editProfileName.value.trim();
  if (editProfileVehicle) currentProfile.vehicle = editProfileVehicle.value.trim();
  if (editProfileNotes) currentProfile.notes = editProfileNotes.value;
  persistProfile(currentProfile);
  renderProfile(currentProfile);
}

if (closeBtn) {
  closeBtn.addEventListener("click", () => {
    window.close();
  });
}

if (importPlanBtn) {
  importPlanBtn.addEventListener("click", () => {
    importProfile().catch(() => {
      setStatus("Failed to import profile.");
    });
  });
}

if (exportPlanBtn) {
  exportPlanBtn.addEventListener("click", () => {
    saveProfileAs().catch(() => {
      setStatus("Failed to save profile.");
    });
  });
}

if (sendPlanBtn) {
  sendPlanBtn.addEventListener("click", () => {
    setStatus("Send-to-vehicle is not wired yet.");
  });
}

populateCommandSelect();
if (commandSelect) {
  renderCommandParams(commandSelect.value);
  commandSelect.addEventListener("change", () => {
    renderCommandParams(commandSelect.value);
  });
}

if (addCommandBtn) {
  addCommandBtn.addEventListener("click", () => {
    if (!currentProfile) {
      currentProfile = ensureProfileShape({
        name: editProfileName ? editProfileName.value.trim() : "Untitled Profile",
        vehicle: editProfileVehicle ? editProfileVehicle.value.trim() : "",
        notes: editProfileNotes ? editProfileNotes.value : "",
        commands: [],
      });
    }

    const command = commandSelect ? commandSelect.value : "";
    const def = getDefForCommand(command);
    if (!def) return;

    const data = readCommandParams();
    currentProfile.commands.push({
      command_id: nextCommandId(currentProfile.commands),
      command: def.id,
      data,
    });
    persistProfile(currentProfile);
    renderProfile(currentProfile);
    syncEditorFields(currentProfile);
  });
}

if (editProfileName) editProfileName.addEventListener("input", applyEditorToProfile);
if (editProfileVehicle) editProfileVehicle.addEventListener("input", applyEditorToProfile);
if (editProfileNotes) editProfileNotes.addEventListener("input", applyEditorToProfile);

async function resetUi() {
  currentProfile = null;
  setText(profileName, "--");
  setText(profileVehicle, "--");
  setText(profileNotes, "--");
  setText(waypointCount, "0");
  setText(maxAlt, "-- m");
  if (editProfileName) editProfileName.value = "";
  if (editProfileVehicle) editProfileVehicle.value = "";
  if (editProfileNotes) editProfileNotes.value = "";
  renderEmptyList("Import a profile or build one with the + button.");
  setStatus("");
}

if (clearPlanBtn) {
  clearPlanBtn.addEventListener("click", () => {
    clearPersistedProfile().finally(() => {
      resetUi();
      setStatus("Cleared.");
    });
  });
}

async function restoreFromMainCache() {
  if (!window.electronAPI || !window.electronAPI.flightPlanningGetProfile) {
    await resetUi();
    return;
  }
  try {
    const result = await window.electronAPI.flightPlanningGetProfile();
    const cached = result && result.profile;
    if (cached) {
      currentProfile = ensureProfileShape(cached);
      renderProfile(currentProfile);
      syncEditorFields(currentProfile);
      return;
    }
  } catch (_error) {}
  await resetUi();
}

restoreFromMainCache();
