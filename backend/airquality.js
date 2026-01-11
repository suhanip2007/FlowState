// backend/airquality.js
async function getOutdoorAirQuality(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Invalid lat/lon");
  }

  if (typeof fetch !== "function") {
    throw new Error("fetch not available. Use Node 18+.");
  }

  const endpoint =
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    "&hourly=pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide" +
    "&timezone=auto";

  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`Open-Meteo failed (${res.status})`);

  const data = await res.json();
  const h = data.hourly;

  if (!h || !Array.isArray(h.time) || h.time.length === 0) {
    throw new Error("No air-quality data returned.");
  }

  let i = h.time.length - 1;
  while (
    i > 0 &&
    (h.pm2_5?.[i] == null &&
      h.pm10?.[i] == null &&
      h.nitrogen_dioxide?.[i] == null &&
      h.ozone?.[i] == null &&
      h.carbon_monoxide?.[i] == null)
  ) {
    i--;
  }

  return {
    source: "Open-Meteo",
    time: h.time[i],
    pm25: h.pm2_5?.[i] ?? null,
    pm10: h.pm10?.[i] ?? null,
    no2: h.nitrogen_dioxide?.[i] ?? null,
    o3: h.ozone?.[i] ?? null,
    co: h.carbon_monoxide?.[i] ?? null
  };
}

module.exports = { getOutdoorAirQuality };
