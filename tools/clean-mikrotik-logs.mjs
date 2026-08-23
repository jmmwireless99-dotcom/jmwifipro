#!/usr/bin/env node
/**
 * Clear MikroTik system logs on every router in billing.db (or MIKROTIK_* env).
 * Uses memory-lines=1 + logging action reset (RouterOS v7 compatible).
 *
 * Usage (on VPS or anywhere with router API reachability):
 *   BILLING_DB=/opt/jm-billing/billing.db node tools/clean-mikrotik-logs.mjs
 *
 * Dry-run (no writes):
 *   DRY_RUN=1 node tools/clean-mikrotik-logs.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = process.env.JM_BILLING_DIR || "/home/ubuntu/jm-billing";
const { RouterOSAPI } = await import(path.join(APP, "lib/routeros-api.js"));

const DB = process.env.BILLING_DB || "/opt/jm-billing/billing.db";
const DRY = process.env.DRY_RUN === "1";

function routersFromDb() {
  const db = new DatabaseSync(DB);
  const rows = db.prepare("SELECT id,name,host,port,username,password,ssl,enabled FROM routers WHERE enabled=1 AND host<>'' ORDER BY id").all();
  if (rows.length) return rows;
  const s = Object.fromEntries(db.prepare("SELECT k,v FROM settings WHERE k LIKE 'mikrotik_%'").all().map((r) => [r.k, r.v]));
  if (s.mikrotik_host && s.mikrotik_user && s.mikrotik_password && s.mikrotik_password !== "***") {
    return [{ id: 0, name: "legacy", host: s.mikrotik_host.split(":")[0], port: Number(s.mikrotik_port) || 8728, username: s.mikrotik_user, password: s.mikrotik_password, ssl: s.mikrotik_ssl === "1" ? 1 : 0 }];
  }
  return [];
}

async function clearRouterLogs(r) {
  const conn = new RouterOSAPI({
    host: (r.host || "").split(":")[0],
    user: r.username,
    password: r.password,
    port: Number(r.port) || (r.ssl ? 8729 : 8728),
    ssl: !!r.ssl,
    timeout: 25000,
  });
  if (DRY) RouterOSAPI.dryRun = true;
  try {
    const id = await conn.identity();
    const before = (await conn.systemLogs()) || [];
    const actions = (await conn.print("/system/logging/action")) || [];
    if (!DRY) {
      for (const a of actions) {
        try { await conn.talk(["/system/logging/action/set", "=.id=" + a[".id"], "=memory-lines=1"]); } catch {}
        try { await conn.talk(["/system/logging/action/reset", "=.id=" + a[".id"]]); } catch {}
      }
    }
    const after = DRY ? before : (await conn.systemLogs()) || [];
    return { ok: true, name: r.name, identity: id?.name || id, before: before.length, after: after.length };
  } catch (e) {
    return { ok: false, name: r.name, host: r.host, port: r.port, error: e.message };
  } finally {
    try { conn.close && conn.close(); } catch {}
  }
}

const list = routersFromDb();
if (!list.length) {
  console.error("No routers in", DB, "— add routers in the panel or set mikrotik_* in settings.");
  process.exit(1);
}
console.log(DRY ? "[DRY RUN] " : "", "Clearing logs on", list.length, "router(s)…");
const results = [];
for (const r of list) results.push(await clearRouterLogs(r));
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((x) => !x.ok);
process.exit(failed.length ? 1 : 0);
