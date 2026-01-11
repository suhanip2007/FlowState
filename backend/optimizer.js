// backend/optimizer.js
const { simulate } = require("./simulation");

function optimizeFan(input = {}) {
  const width = Number.isFinite(input.width) ? input.width : 800;
  const height = Number.isFinite(input.height) ? input.height : 500;

  const windows = Array.isArray(input.windows) ? input.windows : [];
  const occupants = Array.isArray(input.occupants) ? input.occupants : [];
  const outdoor = input.outdoor || {};

  let best = { x: width / 2, y: height / 2, strength: 1.0 };
  let bestScore = Infinity;
  let bestStats = null;

  const TRIES = 80;

  for (let i = 0; i < TRIES; i++) {
    const fan = { x: Math.random() * width, y: Math.random() * height, strength: 1.0 };
    const result = simulate({ width, height, fans: [fan], windows, occupants, outdoor });
    const s = result.stats;

    const heatPenalty = Math.abs((s.avgTemp ?? 21) - 21);

    const score =
      (s.avgCO2 / 1200) * 1.0 +
      (s.maxCO2 / 2500) * 0.6 +
      (s.avgVirus / 8) * 1.2 +
      (s.maxVirus / 25) * 0.9 +
      heatPenalty * 0.15;

    if (score < bestScore) {
      bestScore = score;
      best = fan;
      bestStats = s;
    }
  }

  return {
    bestFan: best,
    score: Number(bestScore.toFixed(3)),
    stats: bestStats
  };
}

module.exports = { optimizeFan };
