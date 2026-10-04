/**
 * Probe MikroTik sites on jmwifi.pro, bounce reachable SSTP peers via MAGSAY2X,
 * update routers.last_status / vpn_notes, set kitifi_site_online_<id>, and gate
 * GCash buy / free claim for offline KiTifi sites.
 *
 *   cd /opt/jm-billing && node deploy/fix-offline-mikrotik-sites.mjs
 */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";
import {
  SSTP_TUNNEL_MAP,
  MAGSAY2X_OSPF_PEERS,
  siteOnlineKey,
  offlineStatusMessage,
  kitifiSiteOfflinePage,
  patchServerJs,
} from "../lib/mikrotik-site-offline.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || process.env.DB_FILE || path.join(ROOT, "billing.db");
const SKIP_RESTART = process.env.SKIP_RESTART === "1";
const DRY = process.argv.includes("--dry-run");
const MAGSAY2X_ID = 53;

function tcpOpen(host, port, ms = 2000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    s.setTimeout(ms, () => {
      s.destroy();
      resolve(false);
    });
  });
}

function upsertSetting(db, k, v) {
  db.prepare(
    "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
  ).run(k, String(v));
}

async function probeRouter(row) {
  const host = String(row.host || "").split(":")[0];
  const port = Number(row.port) || 8728;
  const open = await tcpOpen(host, port);
  if (!open) {
    return {
      id: row.id,
      name: row.name,
      host,
      port,
      online: false,
      tcp: "CLOSED",
      identity: null,
      cause: offlineStatusMessage(row.id, { tcpOpen: false }),
    };
  }
  const conn = new RouterOSAPI({
    host,
    user: row.username,
    password: row.password,
    port,
    timeout: 12000,
  });
  try {
    const idn = await conn.identity();
    let sstpRun = null;
    try {
      const clients = (await conn.print("/interface/sstp-client")) || [];
      const t = clients.find((x) => /jmtechsolution|sstp-cctv/i.test(JSON.stringify(x)));
      if (t) sstpRun = t.running === true || t.running === "true";
    } catch {}
    return {
      id: row.id,
      name: row.name,
      host,
      port,
      online: true,
      tcp: "OPEN",
      identity: idn?.name || null,
      sstpRun,
      cause: "ok",
    };
  } catch (e) {
    return {
      id: row.id,
      name: row.name,
      host,
      port,
      online: false,
      tcp: "OPEN",
      identity: null,
      cause: "fail: " + String(e.message || e).slice(0, 160),
    };
  } finally {
    try {
      conn.close?.();
    } catch {}
  }
}

async function restViaMagsay2x(m2xConn, peerIp, user, pass, restPath, { method = "get", data = null } = {}) {
  const url =
    "http://" +
    encodeURIComponent(user) +
    ":" +
    encodeURIComponent(pass) +
    "@" +
    peerIp +
    "/rest" +
    restPath;
  const fname = "r" + Date.now() + ".txt";
  const words = [
    "/tool/fetch",
    "=url=" + url,
    "=mode=http",
    "=http-method=" + method,
    "=dst-path=" + fname,
  ];
  if (data != null) {
    words.push("=http-data=" + (typeof data === "string" ? data : JSON.stringify(data)));
    words.push("=http-header-field=content-type: application/json");
  }
  await m2xConn.talk(words);
  const files = await m2xConn.talk(["/file/print", "?name=" + fname]);
  let content = "";
  if (files?.[0]) {
    const got = await m2xConn.talk([
      "/file/get",
      "=.id=" + files[0][".id"],
      "=value-name=contents",
    ]);
    content = got?.[0]?.ret ?? "";
    await m2xConn.talk(["/file/remove", "=.id=" + files[0][".id"]]);
  }
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

async function bounceSstpViaMagsay2x(db, routerId) {
  const peer = MAGSAY2X_OSPF_PEERS[routerId];
  const row = db.prepare("SELECT * FROM routers WHERE id=?").get(routerId);
  const m2x = db.prepare("SELECT * FROM routers WHERE id=?").get(MAGSAY2X_ID);
  if (!peer || !row || !m2x) return { ok: false, reason: "no peer map" };
  const conn = new RouterOSAPI({
    host: String(m2x.host).split(":")[0],
    user: m2x.username,
    password: m2x.password,
    port: Number(m2x.port),
    timeout: 60000,
  });
  try {
    await conn.identity();
    const clients = await restViaMagsay2x(
      conn,
      peer.ip,
      row.username,
      row.password,
      "/interface/sstp-client",
    );
    const list = Array.isArray(clients) ? clients : [];
    const target =
      list.find((c) => c.name === "sstp-cctv") ||
      list.find((c) => /jmtechsolution/i.test(JSON.stringify(c)));
    if (!target?.[".id"]) return { ok: false, reason: "no sstp-cctv on peer" };
    if (String(target.running) === "true") {
      return { ok: true, already: true, identity: null };
    }
    await restViaMagsay2x(conn, peer.ip, row.username, row.password, "/interface/sstp-client/disable", {
      method: "post",
      data: { ".id": target[".id"] },
    });
    await new Promise((r) => setTimeout(r, 2000));
    await restViaMagsay2x(conn, peer.ip, row.username, row.password, "/interface/sstp-client/enable", {
      method: "post",
      data: { ".id": target[".id"] },
    });
    await new Promise((r) => setTimeout(r, 8000));
    return { ok: true, bounced: true };
  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 160) };
  } finally {
    try {
      conn.close?.();
    } catch {}
  }
}

function patchLiveSources() {
  const p = path.join(ROOT, "server.js");
  if (!fs.existsSync(p)) {
    console.log("skip missing server.js");
    return false;
  }
  const cur = fs.readFileSync(p, "utf8");
  const next = patchServerJs(cur);
  if (next.missing?.length) console.warn("patch missing needles", next.missing.join(","));
  if (!next.changed) {
    console.log("server.js already patched for site-offline gate");
    return false;
  }
  if (!DRY) fs.writeFileSync(p, next.src);
  console.log((DRY ? "would patch " : "patched ") + "server.js");
  return true;
}

function writeOfflinePage() {
  const p = path.join(ROOT, "public/kitifi/site-offline.html");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!DRY) fs.writeFileSync(p, kitifiSiteOfflinePage("WiFi site"));
  console.log("ok public/kitifi/site-offline.html");
}

async function main() {
  if (!fs.existsSync(DB)) throw new Error("billing.db not found: " + DB);
  const db = new DatabaseSync(DB);
  const rows = db
    .prepare("SELECT * FROM routers WHERE enabled=1 AND host IS NOT NULL AND host!='' ORDER BY id")
    .all();

  console.log("==== probe", rows.length, "routers ====");
  const results = [];
  for (const row of rows) {
    const r = await probeRouter(row);
    results.push(r);
    console.log(r.online ? "ONLINE " : "OFFLINE", r.id, r.name, r.host + ":" + r.port, r.identity || r.cause);
  }

  // Bounce known OSPF peers that are offline
  for (const id of Object.keys(MAGSAY2X_OSPF_PEERS).map(Number)) {
    const cur = results.find((r) => r.id === id);
    if (cur?.online) continue;
    console.log("==== bounce SSTP via MAGSAY2X for", id, "====");
    if (DRY) {
      console.log("dry-run skip bounce");
      continue;
    }
    const b = await bounceSstpViaMagsay2x(db, id);
    console.log("bounce", JSON.stringify(b));
    const row = db.prepare("SELECT * FROM routers WHERE id=?").get(id);
    const again = await probeRouter(row);
    const idx = results.findIndex((r) => r.id === id);
    if (idx >= 0) results[idx] = again;
    console.log(again.online ? "ONLINE " : "OFFLINE", again.id, again.name, again.identity || again.cause);
  }

  console.log("==== update DB flags ====");
  for (const r of results) {
    const status = r.online ? "ok" : r.cause;
    const note = SSTP_TUNNEL_MAP[r.id]
      ? "SSTP " +
        SSTP_TUNNEL_MAP[r.id].user +
        " → " +
        SSTP_TUNNEL_MAP[r.id].tip +
        " public :" +
        SSTP_TUNNEL_MAP[r.id].port +
        (r.online ? " (up)" : " (down — reconnect sstp-cctv)")
      : r.online
        ? ""
        : "API unreachable";
    if (!DRY) {
      db.prepare(
        "UPDATE routers SET last_status=?, last_seen=datetime('now'), vpn_notes=? WHERE id=?",
      ).run(status.slice(0, 500), note.slice(0, 500), r.id);
      upsertSetting(db, siteOnlineKey(r.id), r.online ? "1" : "0");
    }
    console.log(
      "set",
      r.id,
      siteOnlineKey(r.id) + "=" + (r.online ? "1" : "0"),
      "status=" + status.slice(0, 80),
    );
  }

  // Panisijan free claim: keep kitifi_free_enabled_51 but buy/claim gated by site_online
  const pan = results.find((r) => r.id === 51);
  if (pan && !pan.online) {
    console.log("NOTE Panisijan offline — free claim/buy gated until SSTP returns");
  }

  db.close();

  writeOfflinePage();
  patchLiveSources();

  if (!DRY && !SKIP_RESTART) {
    try {
      execSync("systemctl restart jm-billing", { stdio: "inherit" });
      console.log("restarted jm-billing");
    } catch (e) {
      console.warn("restart failed", String(e.message || e).slice(0, 120));
    }
  }

  const offline = results.filter((r) => !r.online);
  const online = results.filter((r) => r.online);
  console.log("==== SUMMARY online", online.length, "offline", offline.length, "====");
  for (const r of offline) {
    console.log("-", r.id, r.name, r.host + ":" + r.port, r.cause);
  }
  console.log(
    "JSON:" +
      JSON.stringify({
        online: online.map((r) => ({ id: r.id, name: r.name, identity: r.identity })),
        offline: offline.map((r) => ({
          id: r.id,
          name: r.name,
          endpoint: r.host + ":" + r.port,
          cause: r.cause,
        })),
      }),
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { probeRouter, bounceSstpViaMagsay2x, main };
