/**
 * Include Panisijan in MikroTik-direct CLAIM + GCash BUY (same as other KiTifi sites).
 *
 * - kitifi_free_mode_51=mikrotik → claimMikrotik (/ip/hotspot/user, profile FREE)
 * - kitifi_gcash_generate=mikrotik → buy via kitifiMikrotikGenerateVoucher (profile default)
 * - Per-router profile in rates/config/buy fallback
 * - Walled-garden PayMongo/GCash hosts when API reachable
 * - Ensure FREE + default hotspot user profiles exist
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/enable-panisijan-mikrotik-claim-buy.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  PANISIJAN_ROUTER_ID,
  PANISIJAN_BUY_PROFILE,
  PANISIJAN_FREE_PROFILE,
  panisijanMikrotikSettings,
  patchKitifiGenProfilePerRouter,
  patchKitifiDefaultProfilePerRouter,
  patchKitifiConfigPerRouterProfiles,
  patchServerGeneratorRatesProfile,
  patchServerBuyOrderProfileFallback,
  ensurePortalSitePanisijan,
} from "../lib/panisijan-mikrotik-claim-buy.mjs";
import { GARDEN_HOSTS } from "./smooth-kitifi-gcash-all-sites.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || process.env.DB_FILE || path.join(ROOT, "billing.db");
const SKIP_RESTART = process.env.SKIP_RESTART === "1";
const SKIP_SYNC = process.env.SKIP_SYNC === "1";
const DRY = process.argv.includes("--dry-run");

function setSetting(db, k, v) {
  db.prepare(
    "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
  ).run(k, v);
}

export function applyPanisijanSettings(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    const applied = [];
    const map = panisijanMikrotikSettings();
    for (const [k, v] of Object.entries(map)) {
      if (!DRY) setSetting(db, k, v);
      applied.push(k + "=" + v);
    }
    // Keep 51 in free mikrotik list (merge if other ids present).
    const cur = db.prepare("SELECT v FROM settings WHERE k=?").get("kitifi_free_mikrotik_routers");
    const ids = new Set(
      String(cur?.v || "")
        .split(",")
        .map((x) => Number(String(x).trim()))
        .filter(Boolean),
    );
    ids.add(PANISIJAN_ROUTER_ID);
    const list = [...ids].sort((a, b) => a - b).join(",");
    if (!DRY) setSetting(db, "kitifi_free_mikrotik_routers", list);
    applied.push("kitifi_free_mikrotik_routers=" + list);

    const sites = db.prepare("SELECT v FROM settings WHERE k=?").get("kitifi_portal_sites");
    const nextSites = ensurePortalSitePanisijan(sites?.v || "{}");
    if (!DRY) setSetting(db, "kitifi_portal_sites", nextSites);
    applied.push("kitifi_portal_sites+=51");

    // Ensure paid plan stays on default profile.
    const plansKey = "kitifi_plans_" + PANISIJAN_ROUTER_ID;
    const plans = db.prepare("SELECT v FROM settings WHERE k=?").get(plansKey);
    if (plans?.v) {
      try {
        const arr = JSON.parse(plans.v);
        let changed = false;
        for (const p of arr || []) {
          if (!p.profile || String(p.profile).toUpperCase() === "KITIFI") {
            p.profile = PANISIJAN_BUY_PROFILE;
            changed = true;
          }
        }
        if (changed && !DRY) setSetting(db, plansKey, JSON.stringify(arr));
        if (changed) applied.push(plansKey + ".profile=" + PANISIJAN_BUY_PROFILE);
      } catch {}
    }
    return applied;
  } finally {
    try {
      db.close();
    } catch {}
  }
}

function patchFile(rel, fn) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.log("skip missing", rel);
    return false;
  }
  const cur = fs.readFileSync(p, "utf8");
  const next = fn(cur);
  if (next.missing) console.warn("patch incomplete", rel, next.missing);
  if (!next.changed) {
    console.log("already patched", rel);
    return false;
  }
  if (!DRY) fs.writeFileSync(p, next.src);
  console.log((DRY ? "would patch " : "patched ") + rel);
  return true;
}

async function ensureProfile(conn, name) {
  const profiles = ((await conn.print("/ip/hotspot/user/profile")) || [])
    .map((p) => p.name)
    .filter(Boolean);
  if (profiles.includes(name)) return { name, created: false };
  if (DRY) return { name, created: true, dry: true };
  await conn.talk(["/ip/hotspot/user/profile/add", "=name=" + name]);
  return { name, created: true };
}

async function ensureGarden(conn) {
  const cur = (await conn.print("/ip/hotspot/walled-garden")) || [];
  const have = new Set(
    cur.map((x) => String(x["dst-host"] || "").toLowerCase()).filter(Boolean),
  );
  const added = [];
  for (const host of GARDEN_HOSTS) {
    const key = host.toLowerCase();
    if ([...have].some((h) => h === key || h.endsWith(key) || key.endsWith(h))) continue;
    if (DRY) {
      added.push(host);
      continue;
    }
    try {
      await conn.talk([
        "/ip/hotspot/walled-garden/add",
        "=dst-host=" + host,
        "=action=allow",
        "=comment=JM GCash buy",
      ]);
      added.push(host);
    } catch (e) {
      if (!/already|same/i.test(String(e.message || e))) throw e;
    }
  }
  return added;
}

async function syncPanisijan() {
  const { RouterOSAPI } = await import("../lib/routeros-api.js");
  const db = new DatabaseSync(DB);
  const row = db.prepare("SELECT * FROM routers WHERE id=?").get(PANISIJAN_ROUTER_ID);
  db.close();
  if (!row?.host) throw new Error("router 51 missing");

  const conn = new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: Number(process.env.KITIFI_TIMEOUT_MS || 90000),
  });
  const out = { identity: null, profiles: [], gardenAdded: [], generateOk: false };
  try {
    const ident = await conn.identity();
    out.identity = ident?.name || ident;
    const free = await ensureProfile(conn, PANISIJAN_FREE_PROFILE);
    const buy = await ensureProfile(conn, PANISIJAN_BUY_PROFILE);
    out.profiles = [
      free.name + (free.created ? "(new)" : ""),
      buy.name + (buy.created ? "(new)" : ""),
    ];
    out.gardenAdded = await ensureGarden(conn);

    // Prove buy generate (add+remove)
    const code = "PN" + String(Date.now()).slice(-6);
    await conn.talk([
      "/ip/hotspot/user/add",
      "=name=" + code,
      "=password=" + code,
      "=profile=" + PANISIJAN_BUY_PROFILE,
      "=limit-uptime=1d",
      "=comment=JM PANISIJAN BUY CHECK",
    ]);
    const users = (await conn.print("/ip/hotspot/user")) || [];
    const hit = users.find((u) => String(u.name) === code);
    if (hit?.[".id"] && !DRY) {
      await conn.talk(["/ip/hotspot/user/remove", "=.id=" + hit[".id"]]);
    }
    out.generateOk = true;

    // Prove free claim-shaped user (add+remove with FREE)
    const fr = "FR" + String(Date.now()).slice(-6);
    await conn.talk([
      "/ip/hotspot/user/add",
      "=name=" + fr,
      "=password=" + fr,
      "=profile=" + PANISIJAN_FREE_PROFILE,
      "=limit-uptime=5:00:00",
      "=comment=JM PANISIJAN CLAIM CHECK",
    ]);
    const users2 = (await conn.print("/ip/hotspot/user")) || [];
    const hit2 = users2.find((u) => String(u.name) === fr);
    if (hit2?.[".id"] && !DRY) {
      await conn.talk(["/ip/hotspot/user/remove", "=.id=" + hit2[".id"]]);
    }
    out.claimOk = true;
  } finally {
    try {
      conn.close?.();
    } catch {}
  }
  return out;
}

function restartBilling() {
  if (SKIP_RESTART || DRY) {
    console.log("SKIP_RESTART");
    return;
  }
  try {
    execSync("systemctl restart jm-billing", { stdio: "inherit" });
    console.log("restarted jm-billing");
  } catch (e) {
    console.warn("restart failed:", e.message);
  }
}

async function main() {
  if (process.cwd() !== ROOT) {
    process.chdir(ROOT);
    console.log("cwd", ROOT);
  }

  const applied = DRY ? Object.keys(panisijanMikrotikSettings()) : applyPanisijanSettings(DB);
  console.log("settings", applied.join(" | "));

  patchFile("lib/kitifi-remote.js", patchKitifiGenProfilePerRouter);
  patchFile("lib/kitifi-server.js", (src) => {
    const a = patchKitifiDefaultProfilePerRouter(src);
    const b = patchKitifiConfigPerRouterProfiles(a.src);
    return {
      src: b.src,
      changed: !!(a.changed || b.changed),
      missing: [...(a.missing || []), ...(b.missing || [])],
    };
  });
  patchFile("server.js", (src) => {
    const a = patchServerGeneratorRatesProfile(src);
    const b = patchServerBuyOrderProfileFallback(a.src);
    return {
      src: b.src,
      changed: !!(a.changed || b.changed),
      missing: [...(a.missing || []), ...(b.missing || [])],
    };
  });

  restartBilling();

  if (SKIP_SYNC) {
    console.log("SKIP_SYNC");
    return;
  }
  try {
    const sync = await syncPanisijan();
    console.log(JSON.stringify({ panisijan: sync }, null, 2));
    if (!sync.generateOk) process.exitCode = 2;
    else console.log("Panisijan CLAIM + BUY voucher are MikroTik-direct.");
  } catch (e) {
    console.warn(
      "Panisijan API unreachable — settings/patches applied; sync when VPN is up:",
      String(e.message || e).slice(0, 160),
    );
    process.exitCode = 2;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
}
