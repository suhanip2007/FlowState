// backend/server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { simulate } = require("./simulation");
const { optimizeFan } = require("./optimizer");
const { getOutdoorAirQuality } = require("./airquality");

const FRONTEND = path.join(__dirname, "..", "frontend");

function send(res, code, type, body) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function sendJSON(res, code, obj) {
  send(res, code, "application/json; charset=utf-8", JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    (ext === ".html" && "text/html; charset=utf-8") ||
    (ext === ".css" && "text/css; charset=utf-8") ||
    (ext === ".js" && "text/javascript; charset=utf-8") ||
    (ext === ".json" && "application/json; charset=utf-8") ||
    "text/plain; charset=utf-8"
  );
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  let route = u.pathname;

  if (route === "/health") return sendJSON(res, 200, { ok: true });

  if (route === "/airquality" && req.method === "GET") {
    try {
      const lat = Number(u.searchParams.get("lat"));
      const lon = Number(u.searchParams.get("lon"));
      const result = await getOutdoorAirQuality(lat, lon);
      return sendJSON(res, 200, result);
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  if (route === "/simulate" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || "{}");
      const result = simulate(data);
      return sendJSON(res, 200, result);
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  if (route === "/optimize" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || "{}");
      const result = optimizeFan(data);
      return sendJSON(res, 200, result);
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // ✅ route alias
  if (route === "/sim") route = "/sim.html";

  // static frontend
  const file = route === "/" ? "/index.html" : route;
  const filePath = path.join(FRONTEND, file);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return send(res, 200, contentType(filePath), fs.readFileSync(filePath));
  }

  return send(res, 404, "text/plain; charset=utf-8", "Not found");
});

server.listen(3000, () => {
  console.log("✅ SERVER RUNNING http://localhost:3000");
  console.log("✅ Sim:           http://localhost:3000/sim");
});
