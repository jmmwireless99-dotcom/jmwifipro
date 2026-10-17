import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBilling } from "./lib/load-billing.js";
import { buildLibreQos, DEFAULT_SETTINGS } from "./lib/build.js";
import { parseSessions } from "./lib/sessions.js";
import { pushToLibreQos } from "./lib/push.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const settingsPath = path.join(dataDir, "settings.json");
const sessionsPath = path.join(dataDir, "sessions.json");
const dbPath = process.env.BILLING_DB || path.resolve(root, "../backup/20260703T234918Z/databases/jm-billing-billing.db");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 9130);

let sessions = [];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(settingsPath, {}) };
}

function publicSettings(settings) {
  const copy = { ...settings };
  copy.apiKeySet = Boolean(settings.apiKey);
  copy.apiKey = settings.apiKey ? `••••${String(settings.apiKey).slice(-4)}` : "";
  return copy;
}

function compile() {
  const billing = loadBilling(dbPath);
  return buildLibreQos(billing, { settings: loadSettings(), sessions });
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (chunks.reduce((n, c) => n + c.length, 0) > 2_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return send(res, 200, fs.readFileSync(path.join(root, "public", "index.html"), "utf8"), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, { ok: true, target: "LibreQoS 2.2", db: dbPath });
    }
    if (req.method === "GET" && url.pathname === "/api/settings") {
      return send(res, 200, publicSettings(loadSettings()));
    }
    if (req.method === "POST" && url.pathname === "/api/settings") {
      const incoming = JSON.parse(await readBody(req) || "{}");
      const current = loadSettings();
      const next = { ...current, ...incoming, nodes: incoming.nodes || current.nodes || {} };
      if (!incoming.apiKey || String(incoming.apiKey).startsWith("••••")) next.apiKey = current.apiKey;
      writeJson(settingsPath, next);
      return send(res, 200, publicSettings(next));
    }
    if (req.method === "POST" && url.pathname === "/api/sessions") {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      sessions = parsed.replace ? parseSessions(parsed.sessions ?? parsed.text ?? parsed) : sessions.concat(parseSessions(parsed.sessions ?? parsed.text ?? parsed));
      writeJson(sessionsPath, sessions);
      return send(res, 200, { count: sessions.length });
    }
    if (req.method === "DELETE" && url.pathname === "/api/sessions") {
      sessions = [];
      writeJson(sessionsPath, sessions);
      return send(res, 200, { count: 0 });
    }
    if (req.method === "GET" && url.pathname === "/api/preview") {
      const built = compile();
      return send(res, 200, {
        target: built.target,
        summary: built.summary,
        warnings: built.warnings,
        errors: built.errors,
        network: built.network,
        pending: built.pending,
        rows: built.rows.map((row) => ({
          circuitId: row["Circuit ID"],
          name: row["Circuit Name"],
          device: row["Device Name"],
          parent: row["Parent Node"],
          ipv4: row.IPv4,
          down: row["Download Max Mbps"],
          up: row["Upload Max Mbps"],
        })),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/network.json") {
      const built = compile();
      return send(res, 200, JSON.stringify(built.network, null, 2) + "\n");
    }
    if (req.method === "GET" && url.pathname === "/api/ShapedDevices.csv") {
      const built = compile();
      return send(res, 200, built.csv, "text/csv; charset=utf-8");
    }
    if (req.method === "POST" && url.pathname === "/api/push") {
      const built = compile();
      if (built.errors.length) return send(res, 400, { ok: false, errors: built.errors, warnings: built.warnings });
      const settings = loadSettings();
      const result = await pushToLibreQos({
        apiBase: settings.apiBase,
        apiKey: settings.apiKey,
        network: built.network,
        csv: built.csv,
        reload: settings.reloadAfterPush !== false,
      });
      return send(res, result.ok ? 200 : 502, { ...result, summary: built.summary, warnings: built.warnings });
    }
    send(res, 404, { error: "Not found" });
  } catch (error) {
    send(res, 500, { error: error.message || "Server error" });
  }
});

sessions = readJson(sessionsPath, []);
if (!Array.isArray(sessions)) sessions = [];

server.listen(port, host, () => {
  const actual = server.address().port;
  console.log(`JM LibreQoS 2.2 bridge on http://${host}:${actual}`);
  console.log(`Billing database: ${dbPath}`);
});
