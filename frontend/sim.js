// frontend/sim.js  (FEET-BASED, FULL FILE)

const canvas =
  document.getElementById("roomCanvas") || document.getElementById("c");
const ctx = canvas.getContext("2d");

// =====================
// Units: feet -> internal simulation units
// =====================
const FEET_TO_UNITS = 25; // change if you want (higher = larger canvas for same feet)

let room = { width: canvas.width, height: canvas.height };
let fans = [];
let windows = [];
let selectedWindowId = null;

// ---------- helpers ----------
function el(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function feetToUnits(ft) {
  return ft * FEET_TO_UNITS;
}

function unitsToFeet(u) {
  return u / FEET_TO_UNITS;
}

// =====================
// drawing
// =====================

// ✅ True Green / Yellow / Red for CO₂
function colorForCO2(v) {
  if (v < 800) return "rgba(40, 200, 120, 0.92)";      // green
  if (v < 1200) return "rgba(245, 210, 80, 0.92)";    // yellow
  return "rgba(245, 90, 90, 0.92)";                   // red
}

function clear() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawRoomBorder() {
  // nice visible border so corners are obvious
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);

  // inner soft border
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  ctx.restore();
}

function drawGrid(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const w = canvas.width / cols;
  const h = canvas.height / rows;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = grid[y][x].co2;
      ctx.fillStyle = colorForCO2(v);
      ctx.fillRect(x * w, y * h, w, h);
    }
  }
}

function drawOverlay() {
  // room border always visible
  drawRoomBorder();

  // fans
  for (const f of fans) {
    ctx.beginPath();
    ctx.arc(f.x, f.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.stroke();

    // little label
    ctx.font = "12px system-ui, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText("Fan", f.x + 12, f.y + 4);
  }

  // windows (draggable bars)
  for (const w of windows) {
    const isSel = w.id === selectedWindowId;
    ctx.fillStyle = isSel ? "rgba(110,231,255,0.95)" : "rgba(255,255,255,0.75)";
    ctx.fillRect(w.x - w.w / 2, w.y - 6, w.w, 12);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeRect(w.x - w.w / 2, w.y - 6, w.w, 12);

    // label
    ctx.font = "12px system-ui, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText("Window", w.x - w.w / 2, w.y - 10);
  }
}

// =====================
// API
// =====================
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

async function runSimulation() {
  // NOTE: if your backend doesn't accept windows yet, it's fine to omit.
  // If it does, you can add: windows
  const data = await postJSON("/simulate", {
    width: room.width,
    height: room.height,
    fans
    // windows
  });

  clear();
  drawGrid(data.grid);
  drawOverlay();

  // recommendation
  const avg = data.avgCO2;
  const avgText = Number.isFinite(avg) ? Math.round(avg) : null;

  const msg =
    avgText == null
      ? `Run completed.`
      : avgText < 800
      ? `✅ Avg CO₂ ~ ${avgText} ppm (Good)`
      : avgText < 1200
      ? `⚠️ Avg CO₂ ~ ${avgText} ppm (Moderate) — consider more ventilation`
      : `🚨 Avg CO₂ ~ ${avgText} ppm (High) — improve ventilation / placement`;

  const rec = el("recommendation");
  if (rec) rec.textContent = msg;
}

async function optimize() {
  const data = await postJSON("/optimize", {
    width: room.width,
    height: room.height
    // windows, occupants, outdoor etc if your backend supports them
  });

  if (data.bestFan) {
    fans = [data.bestFan];
    await runSimulation();
  }

  // Support BOTH response shapes:
  // Old optimizer: { bestFan, avgCO2, status }
  // New optimizer: { bestFan, score, stats: { avgCO2, ... } }
  const avgCO2 =
    (data.stats && Number.isFinite(data.stats.avgCO2) ? data.stats.avgCO2 : null) ??
    (Number.isFinite(data.avgCO2) ? data.avgCO2 : null);

  const statusLevel =
    (data.status && data.status.level) ||
    (data.stats && avgCO2 != null
      ? (avgCO2 <= 800 ? "Good" : avgCO2 <= 1200 ? "Moderate" : avgCO2 <= 2000 ? "Poor" : "Dangerous")
      : "N/A");

  const scoreText = data.score != null ? data.score : "N/A";

  alert(
    `Recommended Fan:\n` +
      `(x=${Math.round(unitsToFeet(data.bestFan.x))} ft, y=${Math.round(
        unitsToFeet(data.bestFan.y)
      )} ft)\n` +
      `Avg CO₂: ${avgCO2 != null ? Math.round(avgCO2) + " ppm" : "N/A"}\n` +
      `Status: ${statusLevel}\n` +
      `Score: ${scoreText}`
  );
}

// =====================
// Outdoor air (API)
// =====================
async function getOutdoor(lat, lon) {
  const res = await fetch(
    `/airquality?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Outdoor check failed");
  return data;
}

async function useMyLocation() {
  if (!navigator.geolocation) throw new Error("Geolocation not available");
  setText("outsideStatus", "Outdoor: checking…");

  const pos = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000
    });
  });

  const { latitude, longitude } = pos.coords;
  const aq = await getOutdoor(latitude, longitude);

  const pieces = [];
  if (aq.pm25 != null) pieces.push(`PM2.5 ${aq.pm25}`);
  if (aq.pm10 != null) pieces.push(`PM10 ${aq.pm10}`);
  if (aq.no2 != null) pieces.push(`NO₂ ${aq.no2}`);
  if (aq.o3 != null) pieces.push(`O₃ ${aq.o3}`);

  setText(
    "outsideStatus",
    `Outdoor (${aq.source}): ${pieces.join(" • ") || "ok"}`
  );
}

// =====================
// Interaction / Room creation (FEET inputs)
// =====================
function createRoomFromInputs() {
  // Your HTML inputs are currently id="width" and id="height".
  // We now interpret them as FEET.
  const wFt = Number(el("width")?.value || 20);
  const hFt = Number(el("height")?.value || 12);

  const wUnits = feetToUnits(wFt);
  const hUnits = feetToUnits(hFt);

  // clamp to keep canvas reasonable
  room.width = clamp(wUnits, 250, 1800);
  room.height = clamp(hUnits, 250, 1100);

  canvas.width = room.width;
  canvas.height = room.height;

  // reset objects
  fans = [];
  windows = [];
  selectedWindowId = null;

  clear();
  drawOverlay();
}

function addFan() {
  fans.push({ x: room.width * 0.5, y: room.height * 0.5 });
  clear();
  drawOverlay();
}

function addWindow() {
  const id = Math.random().toString(16).slice(2);
  windows.push({ id, x: room.width * 0.25, y: room.height * 0.15, w: 160 });
  selectedWindowId = id;
  syncWindowTools();
  clear();
  drawOverlay();
}

function syncWindowTools() {
  const tools = el("windowTools");
  const hint = el("noWindowSelected");
  const slider = el("winWidth");

  const selected = windows.find((w) => w.id === selectedWindowId);

  if (tools && hint) {
    if (selected) {
      tools.classList.remove("hidden");
      hint.classList.add("hidden");
    } else {
      tools.classList.add("hidden");
      hint.classList.remove("hidden");
    }
  }
  if (slider && selected) slider.value = String(selected.w);
}

function deleteSelectedWindow() {
  if (!selectedWindowId) return;
  windows = windows.filter((w) => w.id !== selectedWindowId);
  selectedWindowId = null;
  syncWindowTools();
  clear();
  drawOverlay();
}

// =====================
// Dragging: windows + fans (optional fan drag included)
// =====================
let dragging = null;

// hit tests
function hitWindow(mx, my) {
  for (const w of windows) {
    const left = w.x - w.w / 2;
    const top = w.y - 10;
    const inside =
      mx >= left && mx <= left + w.w && my >= top && my <= top + 20;
    if (inside) return w;
  }
  return null;
}

function hitFan(mx, my) {
  for (const f of fans) {
    if (dist(mx, my, f.x, f.y) <= 14) return f;
  }
  return null;
}

canvas.addEventListener("mousedown", (e) => {
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;

  const w = hitWindow(mx, my);
  if (w) {
    selectedWindowId = w.id;
    dragging = { type: "window", id: w.id, dx: mx - w.x, dy: my - w.y };
    syncWindowTools();
    clear();
    drawOverlay();
    return;
  }

  const f = hitFan(mx, my);
  if (f) {
    dragging = { type: "fan", ref: f, dx: mx - f.x, dy: my - f.y };
    clear();
    drawOverlay();
    return;
  }
});

window.addEventListener("mousemove", (e) => {
  if (!dragging) return;

  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;

  if (dragging.type === "window") {
    const w = windows.find((x) => x.id === dragging.id);
    if (!w) return;

    w.x = clamp(mx - dragging.dx, w.w / 2, room.width - w.w / 2);
    w.y = clamp(my - dragging.dy, 20, room.height - 20);

    clear();
    drawOverlay();
    return;
  }

  if (dragging.type === "fan") {
    const f = dragging.ref;
    f.x = clamp(mx - dragging.dx, 15, room.width - 15);
    f.y = clamp(my - dragging.dy, 15, room.height - 15);

    clear();
    drawOverlay();
    return;
  }
});

window.addEventListener("mouseup", () => (dragging = null));

// slider resize
const winWidth = el("winWidth");
if (winWidth) {
  winWidth.addEventListener("input", () => {
    const selected = windows.find((w) => w.id === selectedWindowId);
    if (!selected) return;
    selected.w = Number(winWidth.value);
    selected.x = clamp(selected.x, selected.w / 2, room.width - selected.w / 2);
    clear();
    drawOverlay();
  });
}

// =====================
// Wire up buttons
// =====================
el("createRoomBtn")?.addEventListener("click", createRoomFromInputs);
el("addFanBtn")?.addEventListener("click", addFan);
el("addWindowBtn")?.addEventListener("click", addWindow);
el("runBtn")?.addEventListener("click", () => runSimulation().catch(err => alert(err.message)));
el("optimizeBtn")?.addEventListener("click", () => optimize().catch(err => alert(err.message)));
el("useLocationBtn")?.addEventListener("click", () =>
  useMyLocation().catch((err) => {
    setText("outsideStatus", `Outdoor: ${err.message}`);
  })
);

el("deleteWindowBtn")?.addEventListener("click", deleteSelectedWindow);

// Back-compat for older page
window.run = () => runSimulation().catch((err) => alert(err.message));
window.opt = () => optimize().catch((err) => alert(err.message));

// init overlay
clear();
drawOverlay();
syncWindowTools();
