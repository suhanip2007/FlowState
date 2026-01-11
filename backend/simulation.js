// backend/simulation.js
// Simple “physics-based” model: airflow vectors + advection + diffusion + sources + ventilation
// Grid stores: co2 (ppm), virus (arb units), temp (°C), and velocity field vx/vy (px/step).

const { CO2_LIMITS } = require("./standards");

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Bilinear sample from scalar field
function sampleScalar(field, x, y) {
  const rows = field.length;
  const cols = field[0].length;

  x = clamp(x, 0, cols - 1);
  y = clamp(y, 0, rows - 1);

  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = clamp(x0 + 1, 0, cols - 1);
  const y1 = clamp(y0 + 1, 0, rows - 1);

  const tx = x - x0;
  const ty = y - y0;

  const v00 = field[y0][x0];
  const v10 = field[y0][x1];
  const v01 = field[y1][x0];
  const v11 = field[y1][x1];

  const a = lerp(v00, v10, tx);
  const b = lerp(v01, v11, tx);
  return lerp(a, b, ty);
}

// Bilinear sample from vector field
function sampleVec(vx, vy, x, y) {
  return {
    x: sampleScalar(vx, x, y),
    y: sampleScalar(vy, x, y),
  };
}

function make2D(rows, cols, fill) {
  const a = new Array(rows);
  for (let y = 0; y < rows; y++) {
    a[y] = new Array(cols);
    for (let x = 0; x < cols; x++) a[y][x] = fill;
  }
  return a;
}

function simulate(input = {}) {
  const width = Number.isFinite(input.width) ? input.width : 800;
  const height = Number.isFinite(input.height) ? input.height : 500;

  const fans = Array.isArray(input.fans) ? input.fans : [];
  const windows = Array.isArray(input.windows) ? input.windows : [];
  const occupants = Array.isArray(input.occupants) ? input.occupants : [];

  // Outdoor / baseline conditions (you can later set these from real APIs)
  const outdoor = input.outdoor || {};
  const outdoorCO2 = Number.isFinite(outdoor.co2) ? outdoor.co2 : CO2_LIMITS.outdoor; // ~420
  const outdoorTemp = Number.isFinite(outdoor.temp) ? outdoor.temp : 10; // °C default
  const outdoorVirus = 0;

  // Grid resolution (enough to look good, fast to compute)
  const rows = 28;
  const cols = 44;

  // Convert pixels to grid coords
  const pxToGX = (px) => (px / width) * (cols - 1);
  const pxToGY = (px) => (px / height) * (rows - 1);

  // Fields
  let co2 = make2D(rows, cols, outdoorCO2 + 600);  // start moderately elevated indoors
  let virus = make2D(rows, cols, 0.0);
  let temp = make2D(rows, cols, 21.0);            // room temp

  // Model parameters (tunable)
  const STEPS = 40;             // timesteps per simulation run
  const DIFF = 0.12;            // diffusion factor (mixing)
  const ADVECT = 0.85;          // advection strength
  const FAN_STRENGTH = 2.8;     // airflow contribution
  const WINDOW_FLOW = 2.2;      // ventilation airflow contribution
  const VENT_PULL = 0.08;       // pulls values toward outdoor near windows each step

  // Emissions per step (very simplified)
  const CO2_EMIT = 18;          // ppm-ish per step (scaled by grid)
  const VIRUS_EMIT = 1.0;       // arbitrary units per step
  const HEAT_EMIT = 0.04;       // °C increase near occupant per step

  // Compute velocity field each step based on fans + windows
  function computeVelocity() {
    const vx = make2D(rows, cols, 0);
    const vy = make2D(rows, cols, 0);

    // Fans: radial swirl-ish push (simple)
    for (const f of fans) {
      const fx = pxToGX(f.x || 0);
      const fy = pxToGY(f.y || 0);
      const strength = Number.isFinite(f.strength) ? f.strength : 1.0;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const dx = x - fx;
          const dy = y - fy;
          const d2 = dx * dx + dy * dy + 6;
          // push away from fan center
          vx[y][x] += (dx / d2) * FAN_STRENGTH * strength;
          vy[y][x] += (dy / d2) * FAN_STRENGTH * strength;
        }
      }
    }

    // Windows: treat as ventilation “in/out” along the closest wall direction.
    // window: {x,y,w,open} horizontal bar. We infer which wall it is closest to.
    for (const win of windows) {
      const wx = win.x || 0;
      const wy = win.y || 0;
      const wOpen = Number.isFinite(win.open) ? clamp(win.open, 0, 1) : 1.0;

      // decide wall based on proximity
      const distLeft = wx;
      const distRight = width - wx;
      const distTop = wy;
      const distBottom = height - wy;

      let dir = { x: 0, y: 0 };
      const m = Math.min(distLeft, distRight, distTop, distBottom);
      if (m === distLeft) dir = { x: 1, y: 0 };
      else if (m === distRight) dir = { x: -1, y: 0 };
      else if (m === distTop) dir = { x: 0, y: 1 };
      else dir = { x: 0, y: -1 };

      const gx = pxToGX(wx);
      const gy = pxToGY(wy);
      const half = (Number.isFinite(win.w) ? win.w : 120) / width * (cols - 1) * 0.5;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          // affect a band around the window center
          const dx = x - gx;
          const dy = y - gy;
          const band = Math.abs(dx) <= half && Math.abs(dy) <= 2.2;
          if (!band) continue;

          vx[y][x] += dir.x * WINDOW_FLOW * wOpen;
          vy[y][x] += dir.y * WINDOW_FLOW * wOpen;
        }
      }
    }

    return { vx, vy };
  }

  function diffuse(field) {
    const out = make2D(rows, cols, 0);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = field[y][x];
        const up = field[clamp(y - 1, 0, rows - 1)][x];
        const dn = field[clamp(y + 1, 0, rows - 1)][x];
        const lf = field[y][clamp(x - 1, 0, cols - 1)];
        const rt = field[y][clamp(x + 1, 0, cols - 1)];
        const avgN = (up + dn + lf + rt) * 0.25;
        out[y][x] = lerp(c, avgN, DIFF);
      }
    }
    return out;
  }

  function advect(field, vx, vy) {
    const out = make2D(rows, cols, 0);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        // trace backwards along velocity to find “where it came from”
        const ux = vx[y][x];
        const uy = vy[y][x];

        const backX = x - ux * ADVECT;
        const backY = y - uy * ADVECT;

        out[y][x] = sampleScalar(field, backX, backY);
      }
    }
    return out;
  }

  function applyOccupants(co2F, virusF, tempF) {
    for (const p of occupants) {
      const px = pxToGX(p.x || 0);
      const py = pxToGY(p.y || 0);

      const intensity = Number.isFinite(p.intensity) ? clamp(p.intensity, 0.2, 3.0) : 1.0;

      // add emissions in a small radius
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const dx = x - px;
          const dy = y - py;
          const d2 = dx * dx + dy * dy;
          const w = Math.exp(-d2 / 10); // gaussian blob

          co2F[y][x] += CO2_EMIT * intensity * w;
          virusF[y][x] += VIRUS_EMIT * intensity * w;
          tempF[y][x] += HEAT_EMIT * intensity * w;
        }
      }
    }
  }

  function applyVentilation(co2F, virusF, tempF) {
    // near windows, pull toward outdoor values (ventilation sink)
    for (const win of windows) {
      const gx = pxToGX(win.x || 0);
      const gy = pxToGY(win.y || 0);
      const wOpen = Number.isFinite(win.open) ? clamp(win.open, 0, 1) : 1.0;
      const half = (Number.isFinite(win.w) ? win.w : 120) / width * (cols - 1) * 0.5;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const dx = x - gx;
          const dy = y - gy;
          const band = Math.abs(dx) <= half && Math.abs(dy) <= 2.8;
          if (!band) continue;

          const k = VENT_PULL * wOpen;
          co2F[y][x] = lerp(co2F[y][x], outdoorCO2, k);
          virusF[y][x] = lerp(virusF[y][x], outdoorVirus, k);
          tempF[y][x] = lerp(tempF[y][x], outdoorTemp, k * 0.8);
        }
      }
    }
  }

  // Run timesteps
  let lastV = computeVelocity();
  for (let t = 0; t < STEPS; t++) {
    // update velocity each step (cheap enough)
    lastV = computeVelocity();

    // transport
    co2 = advect(co2, lastV.vx, lastV.vy);
    virus = advect(virus, lastV.vx, lastV.vy);
    temp = advect(temp, lastV.vx, lastV.vy);

    // mixing
    co2 = diffuse(co2);
    virus = diffuse(virus);
    temp = diffuse(temp);

    // sources
    applyOccupants(co2, virus, temp);

    // sinks (windows)
    applyVentilation(co2, virus, temp);

    // clamp physically-ish
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        co2[y][x] = clamp(co2[y][x], outdoorCO2, 5000);
        virus[y][x] = clamp(virus[y][x], 0, 1000);
        temp[y][x] = clamp(temp[y][x], -10, 40);
      }
    }
  }

  // Pack grid for frontend heatmap: include all 3 metrics
  const grid = [];
  let sumCO2 = 0, maxCO2 = 0;
  let sumV = 0, maxV = 0;
  let sumT = 0;

  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      const c = co2[y][x];
      const v = virus[y][x];
      const tp = temp[y][x];

      sumCO2 += c;
      sumV += v;
      sumT += tp;

      if (c > maxCO2) maxCO2 = c;
      if (v > maxV) maxV = v;

      row.push({ co2: c, virus: v, temp: tp });
    }
    grid.push(row);
  }

  // Provide a downsampled vector field for drawing arrows (optional but helps)
  const vectors = [];
  const step = 4;
  for (let y = 0; y < rows; y += step) {
    for (let x = 0; x < cols; x += step) {
      const ux = lastV.vx[y][x];
      const uy = lastV.vy[y][x];
      vectors.push({ x, y, ux, uy });
    }
  }

  const cells = rows * cols;
  return {
    grid,
    vectors,
    stats: {
      avgCO2: sumCO2 / cells,
      maxCO2,
      avgVirus: sumV / cells,
      maxVirus: maxV,
      avgTemp: sumT / cells
    },
    meta: { rows, cols, outdoor: { co2: outdoorCO2, temp: outdoorTemp } }
  };
}

module.exports = { simulate };
