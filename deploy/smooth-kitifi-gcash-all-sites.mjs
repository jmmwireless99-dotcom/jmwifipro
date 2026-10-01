/**
 * Smooth ALL KiTifi hotspot sites to match Candelaria GCash buy + MikroTik time + auto-connect.
 *
 * - kitifi_gcash_buy_enabled=1, kitifi_gcash_generate=mikrotik
 * - Remap deleted 36→57, 46→56, 42→52
 * - Resolve KITIFI vs KiTiFi profile casing
 * - Allow Cawayan MikroTik auto-connect (was excluded)
 * - Ensure PayMongo/GCash/jmwifi.pro walled-garden hosts
 * - Push BUY VOUCHER portal HTML (MikroTik login autoconnect)
 * - Copy KiTifi admin pass leftovers onto live 2nd/3rd rows when missing
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/smooth-kitifi-gcash-all-sites.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { GCASH_BUY_ENABLED_KEY } from "../lib/kitifi-gcash-buy-pause.mjs";
import {
  GCASH_GENERATE_KEY,
  DEFAULT_GCASH_GENERATE,
  KITIFI_DELETED_ROUTER_ALIAS,
  remapPortalSitesJson,
  patchServerBuyRouterAlias,
  patchKitifiApiFulfillAlias,
  patchMikrotikGenerateProfile,
  patchMikrotikGenerateResolveProfile,
  resolveHotspotUserProfile,
} from "../lib/kitifi-mikrotik-direct-voucher.mjs";
import { patchKitifiServerSource } from "./enable-mikrotik-direct-gcash-voucher.mjs";
import { assertResumePortalHtml } from "./resume-kitifi-gcash-mikrotik.mjs";
import {
  PANISIJAN_ROUTER_ID,
  isPanisijanRouter,
  collectKitifiIds,
} from "./disable-5th-register-claim-free.mjs";
import { pushHotspotPortalRedirect } from "../lib/kitifi-hotspot-portal-redirect.mjs";
import { patchServerStatusPortalRoute } from "../lib/kitifi-status-portal-route.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || process.env.DB_FILE || path.join(ROOT, "billing.db");
const HTML_REL = "public/kitifi/status-portal-5th.html";
const SKIP_PORTAL = process.env.SKIP_PORTAL_PUSH === "1";
const SKIP_RESTART = process.env.SKIP_RESTART === "1";
const SKIP_GARDEN = process.env.SKIP_GARDEN === "1";
const DRY = process.argv.includes("--dry-run");

export const GARDEN_HOSTS = [
  "jmwifi.pro",
  "www.jmwifi.pro",
  "paymongo.com",
  "www.paymongo.com",
  "api.paymongo.com",
  "checkout.paymongo.com",
  "link.paymongo.com",
  "gcash.com",
  "www.gcash.com",
  "m.gcash.com",
  "api.gcash.com",
];

/** Remove hard Cawayan skip so MikroTik-direct GCash can auto-connect there too. */
export const CAWAYAN_SKIP_LINE =
  '  if (Number(routerId) === KITIFI_CAWAYAN_ROUTER_ID) return { ok: false, skipped: true, reason: "cawayan excluded" };\n';

export function stripCawayanAutoconnectSkip(src) {
  const out = String(src || "");
  if (!out.includes(CAWAYAN_SKIP_LINE)) return { src: out, changed: false };
  // Keep portal-host special-case (11.x); only remove connect/redeem/mac-login skips.
  return { src: out.split(CAWAYAN_SKIP_LINE).join(""), changed: true };
}

export function patchKitifiServerAll(src) {
  let out = String(src || "");
  let changed = false;
  const steps = [
    patchKitifiServerSource,
    patchMikrotikGenerateProfile,
    patchMikrotikGenerateResolveProfile,
    stripCawayanAutoconnectSkip,
  ];
  const missing = [];
  for (const step of steps) {
    const r = step(out);
    out = r.src;
    if (r.changed) changed = true;
    if (r.missing) missing.push(step.name || "step");
  }
  return { src: out, changed, missing: missing.length ? missing : undefined };
}

function setSetting(db, k, v) {
  db.prepare(
    "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
  ).run(k, v);
}

export function smoothSettings(dbPath) {
  const db = new DatabaseSync(dbPath);
  const copied = [];
  try {
    setSetting(db, GCASH_BUY_ENABLED_KEY, "1");
    setSetting(db, GCASH_GENERATE_KEY, DEFAULT_GCASH_GENERATE);
    for (const [from, to] of Object.entries(KITIFI_DELETED_ROUTER_ALIAS)) {
      for (const prefix of [
        "kitifi_plans_",
        "kitifi_hotspot_login_",
        "kitifi_seller_id_",
        "kitifi_admin_pass_",
        "kitifi_default_profile_",
        "kitifi_gen_profile_",
      ]) {
        const src = db.prepare("SELECT v FROM settings WHERE k=?").get(prefix + from);
        if (!src?.v) continue;
        const dstKey = prefix + to;
        const dst = db.prepare("SELECT v FROM settings WHERE k=?").get(dstKey);
        if (dst?.v && prefix !== "kitifi_admin_pass_") continue;
        // Refresh admin pass onto live id when missing OR still equal to deleted-router leftover.
        if (prefix === "kitifi_admin_pass_" && dst?.v && dst.v !== src.v) {
          // Prefer pass from a known-good live peer (Candelaria) over stale deleted-id copy.
          const good = db.prepare("SELECT v FROM settings WHERE k=?").get("kitifi_admin_pass_34");
          if (good?.v && dst.v !== good.v && src.v === good.v) {
            if (!DRY) setSetting(db, dstKey, good.v);
            copied.push(dstKey + "(from34)");
          }
          continue;
        }
        if (prefix === "kitifi_admin_pass_" && dst?.v) continue;
        if (!DRY) setSetting(db, dstKey, src.v);
        copied.push(dstKey);
      }
    }
    const sites = db.prepare("SELECT v FROM settings WHERE k=?").get("kitifi_portal_sites");
    if (sites?.v) {
      const next = remapPortalSitesJson(sites.v);
      if (next !== sites.v && !DRY) setSetting(db, "kitifi_portal_sites", next);
    }
    const ids = collectKitifiIds(db);
    console.log(GCASH_BUY_ENABLED_KEY + "=1");
    console.log(GCASH_GENERATE_KEY + "=" + DEFAULT_GCASH_GENERATE);
    console.log("copied", copied.join(",") || "(none)");
    return ids;
  } finally {
    try { db.close(); } catch {}
  }
}

function patchFile(rel, fn) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.log("skip missing", rel);
    return;
  }
  const cur = fs.readFileSync(p, "utf8");
  const next = fn(cur);
  if (next.missing) console.warn("patch incomplete", rel, next.missing);
  if (!next.changed) {
    console.log("already patched", rel);
    return;
  }
  if (!DRY) fs.writeFileSync(p, next.src);
  console.log((DRY ? "would patch " : "patched ") + rel);
}

async function ensureGarden(conn, hosts) {
  const cur = (await conn.print("/ip/hotspot/walled-garden")) || [];
  const have = new Set(
    cur.map((x) => String(x["dst-host"] || "").toLowerCase()).filter(Boolean),
  );
  const added = [];
  for (const host of hosts) {
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
      have.add(key);
      added.push(host);
    } catch (e) {
      // ignore duplicates
      if (!/already|same/i.test(String(e.message || e))) {
        throw e;
      }
    }
  }
  return added;
}

async function syncLiveSite(row) {
  const { RouterOSAPI } = await import("../lib/routeros-api.js");
  const rid = Number(row.id);
  const conn = new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: Number(process.env.KITIFI_TIMEOUT_MS || 45000),
  });
  const out = { id: rid, name: row.name, gardenAdded: [], profile: null };
  try {
    const ident = await conn.identity();
    out.identity = ident?.name || ident;
    const profiles = ((await conn.print("/ip/hotspot/user/profile")) || [])
      .map((p) => p.name)
      .filter(Boolean);
    const prof = resolveHotspotUserProfile("KITIFI", profiles);
    out.profile = prof;
    out.hasKitifi = profiles.some((p) => /kitifi/i.test(String(p)));
    if (!SKIP_GARDEN) out.gardenAdded = await ensureGarden(conn, GARDEN_HOSTS);

    // Persist live profile + login defaults for this router.
    if (!DRY && out.hasKitifi) {
      const db = new DatabaseSync(DB);
      try {
        setSetting(db, "kitifi_default_profile_" + rid, prof);
        setSetting(db, "kitifi_gen_profile_" + rid, prof);
        const loginKey = "kitifi_hotspot_login_" + rid;
        const login = db.prepare("SELECT v FROM settings WHERE k=?").get(loginKey);
        if (!login?.v) {
          const host = rid === 39 ? "http://11.60.60.1/login" : "http://10.0.0.1/login";
          setSetting(db, loginKey, host);
        }
      } finally {
        try { db.close(); } catch {}
      }
    }

    // Prove generate
    const code = "SM" + String(Date.now()).slice(-6);
    await conn.talk([
      "/ip/hotspot/user/add",
      "=name=" + code,
      "=password=" + code,
      "=profile=" + prof,
      "=limit-uptime=00:01:00",
      "=comment=JM SMOOTH CHECK",
    ]);
    const users = (await conn.print("/ip/hotspot/user")) || [];
    const hit = users.find((u) => String(u.name) === code);
    if (hit?.[".id"] && !DRY) {
      await conn.talk(["/ip/hotspot/user/remove", "=.id=" + hit[".id"]]);
    }
    out.generateOk = true;
  } catch (e) {
    out.error = String(e.message || e).slice(0, 160);
    out.generateOk = false;
  } finally {
    try { conn.close?.(); } catch {}
  }
  return out;
}

async function pushOnePortal(row, html) {
  const { RouterOSAPI } = await import("../lib/routeros-api.js");
  const { kitifiLogin, kitifiAdminBase } = await import("../lib/kitifi-remote.js");
  const rid = Number(row.id);
  const site =
    String(row.name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || String(rid);
  const conn = new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: Number(process.env.KITIFI_TIMEOUT_MS || 45000),
  });
  await conn.identity();
  try {
    const cookie = await kitifiLogin(conn, rid);
    async function kitifiPost(body) {
      const r = await conn.talk([
        "/tool/fetch",
        "=url=" + kitifiAdminBase(rid) + "/api/pages/settings",
        "=mode=http",
        "=http-method=post",
        "=http-header-field=Cookie: " + cookie + "\r\nContent-Type: application/json",
        "=http-data=" + JSON.stringify(body),
        "=output=user-with-headers",
        "=check-certificate=no",
      ]);
      return (r || []).map((x) => x.data || "").join("");
    }
    const htmlRes = await kitifiPost({ action: "savehtmlportal", html_portal: html });
    if (!/"status"\s*:\s*true/i.test(htmlRes)) {
      throw new Error("savehtmlportal failed: " + htmlRes.slice(0, 180));
    }
    conn.close?.();
    return { mode: "kitifi", detail: htmlRes.slice(0, 100) };
  } catch (e) {
    // KiTifi admin unknown/changed — still give clients Candelaria-like BUY via hotspot redirect.
    const fb = await pushHotspotPortalRedirect(conn, { rid, site });
    conn.close?.();
    if (!fb.ok.length) throw e;
    return {
      mode: "hotspot-redirect",
      detail: "ok=" + fb.ok.join(",") + (fb.fail.length ? " fail=" + fb.fail.length : ""),
    };
  }
}

async function pushPortals(ids) {
  const html = fs.readFileSync(path.join(ROOT, HTML_REL), "utf8");
  assertResumePortalHtml(html);
  const db = new DatabaseSync(DB);
  const targets = [];
  try {
    for (const id of ids) {
      if (id === PANISIJAN_ROUTER_ID) continue;
      const row = db.prepare("SELECT * FROM routers WHERE id=?").get(id);
      if (!row?.host) continue;
      if (isPanisijanRouter(row.id, row.name) || /pppoe/i.test(String(row.name || ""))) continue;
      targets.push(row);
    }
  } finally {
    try { db.close(); } catch {}
  }
  const ok = [];
  const fail = [];
  for (const row of targets) {
    process.stdout.write("portal " + row.name + " (" + row.id + ") ... ");
    if (DRY) {
      console.log("dry-run");
      continue;
    }
    try {
      const res = await pushOnePortal(row, html);
      console.log("ok", res.mode || "kitifi", res.detail || res);
      ok.push(row.id);
    } catch (e) {
      console.log("FAIL", e.message);
      fail.push({ id: row.id, name: row.name, error: e.message });
    }
  }
  return { ok, fail };
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
  assertResumePortalHtml(fs.readFileSync(path.join(ROOT, HTML_REL), "utf8"));
  console.log("ok", HTML_REL);

  const ids = DRY ? [] : smoothSettings(DB);
  patchFile("lib/kitifi-server.js", patchKitifiServerAll);
  patchFile("server.js", (src) => {
    const a = patchServerBuyRouterAlias(src);
    const b = patchServerStatusPortalRoute(a.src);
    return {
      src: b.src,
      changed: !!(a.changed || b.changed),
      missing: [...(a.missing || []), ...(b.missing || [])],
    };
  });
  patchFile("lib/kitifi-api.js", patchKitifiApiFulfillAlias);
  restartBilling();

  const liveIds = ids.length
    ? ids
    : (() => {
        const db = new DatabaseSync(DB);
        try {
          return collectKitifiIds(db);
        } finally {
          try { db.close(); } catch {}
        }
      })();

  const sync = [];
  const db = new DatabaseSync(DB);
  try {
    for (const id of liveIds) {
      if (id === PANISIJAN_ROUTER_ID) continue;
      const row = db.prepare("SELECT * FROM routers WHERE id=?").get(id);
      if (!row?.host || /pppoe/i.test(String(row.name || ""))) continue;
      process.stdout.write("sync " + row.name + " (" + id + ") ... ");
      const r = await syncLiveSite(row);
      sync.push(r);
      console.log(
        r.generateOk ? "ok" : "FAIL",
        r.profile || "",
        r.gardenAdded?.length ? "+garden:" + r.gardenAdded.length : "",
        r.error || "",
      );
    }
  } finally {
    try { db.close(); } catch {}
  }

  let portals = { ok: [], fail: [] };
  if (!SKIP_PORTAL) portals = await pushPortals(liveIds);
  else console.log("SKIP_PORTAL_PUSH=1");

  console.log(
    JSON.stringify(
      {
        syncGood: sync.filter((s) => s.generateOk).map((s) => s.name),
        syncBad: sync.filter((s) => !s.generateOk).map((s) => s.name + ": " + (s.error || "")),
        portalsOk: portals.ok,
        portalsFail: portals.fail,
      },
      null,
      2,
    ),
  );
  if (sync.some((s) => !s.generateOk) || portals.fail?.length) process.exitCode = 2;
  else console.log("All reachable KiTifi sites smoothed for GCash buy + MikroTik auto-connect.");
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
}
