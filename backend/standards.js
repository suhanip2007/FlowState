// backend/standards.js
const CO2_LIMITS = {
  outdoor: 420,
  good: 800,
  moderate: 1200,
  poor: 2000,
  dangerous: 5000
};

function interpretCO2(avg) {
  if (avg <= CO2_LIMITS.good) return { level: "Good", color: "green" };
  if (avg <= CO2_LIMITS.moderate) return { level: "Moderate", color: "yellow" };
  if (avg <= CO2_LIMITS.poor) return { level: "Poor", color: "orange" };
  return { level: "Dangerous", color: "red" };
}

module.exports = { CO2_LIMITS, interpretCO2 };
