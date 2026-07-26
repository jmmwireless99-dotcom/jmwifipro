/**
 * Bidirectional PPPoE sync for one MikroTik site.
 * 1) Pull /ppp/secret from router → match/create billing customers (router_id set)
 * 2) Push billing customers on this site → create missing PPPoE on router
 *
 * Usage (on VPS where billing.db is live):
 *   node deploy/sync-site-clients.mjs CANDELARIA-PPPOE
 *   node deploy/sync-site-clients.mjs 49
 *   node deploy/sync-site-clients.mjs CANDELARIA-PPPOE --pull-only
 *   node deploy/sync-site-clients.mjs CANDELARIA-PPPOE --push-only
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Customers, Plans, Routers, Settings, Audit } from "../lib/db.js";
import { RouterOSAPI } from "../lib/routeros-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const arg = process.argv[2] || "CANDELARIA-PPPOE";
const PULL_ONLY = process.argv.includes("--pull-only");
const PUSH_ONLY = process.argv.includes("--push-only");

function connFor(r) {
  return new RouterOSAPI({
    host: (r.host || "").split(":")[0],
    user: r.username,
    password: r.password,
    port: Number(r.port) || (r.ssl ? 8729 : 8728),
    ssl: !!r.ssl,
    timeout: 25000,
  });
}

function findRouter(q) {
  const routers = Routers.list();
  if (/^\d+$/.test(q)) {
    const r = routers.find((x) => Number(x.id) === Number(q));
    if (r) return r;
  }
  const u = q.toUpperCase();
  return routers.find((x) => (x.name || "").toUpperCase() === u)
    || routers.find((x) => (x.name || "").toUpperCase().includes(u))
    || routers.find((x) => u.includes((x.name || "").toUpperCase()));
}

function suspendedProfile() {
  return (Settings.get("suspended_profile") || "SUSPENDED").trim() || "SUSPENDED";
}

function isPppoeCustomer(c) {
  if ((c.conn_type || "pppoe") === "ipoe") return false;
  if ((c.plan_type || "pppoe") === "hotspot") return false;
  return !!String(c.username || "").trim();
}

async function pullFromRouter(r, conn) {
  const planByProfile = {};
  for (const p of Plans.list()) {
    if (p.router_profile) planByProfile[String(p.router_profile).toLowerCase()] = p.id;
  }
  const suspProf = suspendedProfile().toLowerCase();
  const existingByUser = {};
  for (const c of Customers.list()) {
    const u = (c.username || "").toLowerCase();
    if (u) existingByUser[u] = c;
  }

  const rows = (await conn.listPppoe()) || [];
  let created = 0, matched = 0, assigned = 0, skipped = 0;

  for (const row of rows) {
    const name = (row.name || "").trim();
    if (!name) { skipped++; continue; }
    const profile = (row.profile || "").toLowerCase();
    const plan_id = planByProfile[profile] || null;
    const disabled = String(row.disabled) === "true" || String(row.disabled) === "yes";
    const status = (disabled || (profile && profile === suspProf)) ? "suspended" : "active";
    const comment = (row.comment || "").trim();
    const existing = existingByUser[name.toLowerCase()];

    if (existing) {
      const patch = { username: name };
      if (plan_id) patch.plan_id = plan_id;
      if (row.password && !existing.password) patch.password = row.password;
      if (comment && (existing.name === existing.username || existing.name === name)) patch.name = comment;
      if (Number(existing.router_id) !== Number(r.id)) { patch.router_id = r.id; assigned++; }
      if (status === "suspended") patch.status = "suspended";
      else if (existing.status !== "suspended") patch.status = "active";
      Customers.update(existing.id, patch);
      matched++;
      continue;
    }

    Customers.create({
      name: comment || name,
      username: name,
      password: row.password || "",
      plan_id,
      status,
      router_id: r.id,
      area: r.area || "",
      notes: `synced from ${r.name}${row.profile ? " · profile " + row.profile : ""}`,
    });
    existingByUser[name.toLowerCase()] = { username: name };
    created++;
  }

  return { pulled: rows.length, created, matched, assigned, skipped };
}

async function pushToRouter(r, conn) {
  const profiles = (await conn.pppProfiles().catch(() => [])) || [];
  const profileNames = new Set(profiles.map((p) => String(p.name || "").toLowerCase()));
  const onRouter = new Set(((await conn.listPppoe().catch(() => [])) || []).map((x) => String(x.name || "").toLowerCase()));
  const susp = suspendedProfile();
  const targets = Customers.list().filter(isPppoeCustomer).filter((c) => Number(c.router_id) === Number(r.id));

  const ok = [], failed = [], skipped = [];

  for (const c of targets) {
    const user = String(c.username).trim();
    const pass = String(c.password || "").trim();
    if (!user) { skipped.push({ name: c.name, reason: "no username" }); continue; }
    if (!pass) { skipped.push({ name: c.name, user, reason: "no password in billing" }); continue; }
    if (onRouter.has(user.toLowerCase()) && c.status !== "suspended") { skipped.push({ user, reason: "already on router" }); continue; }

    let profile = c.status === "suspended" ? susp : (c.plan_profile || "default");
    if (!profileNames.has(profile.toLowerCase())) {
      if (profileNames.has("default")) profile = "default";
      else if (profileNames.has("testing")) profile = "TESTING";
      else {
        failed.push({ user, name: c.name, error: `profile "${profile}" missing on router` });
        continue;
      }
    }

    try {
      await conn.createPppoe({ name: user, password: pass, profile, comment: c.name || user, service: "pppoe" });
      ok.push({ user, profile });
    } catch (e) {
      failed.push({ user, name: c.name, error: e.message || String(e) });
    }
  }

  return { targets: targets.length, ok: ok.length, failed, skipped };
}

async function main() {
  const r = findRouter(arg);
  if (!r) throw new Error(`Router not found for: ${arg}`);

  console.log("Site:", r.name, `(id=${r.id})`);
  console.log("Host:", r.host + ":" + (r.port || 8728), "| user:", r.username);
  console.log("Billing customers on this site:", Customers.list().filter((c) => Number(c.router_id) === Number(r.id)).length);

  const conn = connFor(r);
  let ident;
  try {
    ident = await conn.identity();
    console.log("Router API: OK —", ident?.name || "connected");
    Routers.setStatus(r.id, "ok");
  } catch (e) {
    Routers.setStatus(r.id, "fail: " + e.message);
    throw new Error(`Cannot connect to ${r.name}: ${e.message}\nFix VPN/API on the router first, then re-run this script.`);
  }

  const out = { router: { id: r.id, name: r.name, identity: ident?.name || "" } };

  if (!PUSH_ONLY) {
    console.log("\n--- Pull: MikroTik → billing ---");
    out.pull = await pullFromRouter(r, conn);
    console.log(out.pull);
  }

  if (!PULL_ONLY) {
    console.log("\n--- Push: billing → MikroTik ---");
    out.push = await pushToRouter(r, conn);
    console.log("targets:", out.push.targets, "| created on router:", out.push.ok, "| failed:", out.push.failed.length, "| skipped:", out.push.skipped.length);
    if (out.push.failed.length) {
      console.log("Failed (first 15):");
      for (const f of out.push.failed.slice(0, 15)) console.log(" ", f.user, "—", f.error);
    }
  }

  Audit.add({
    type: "manual",
    action: "sync-site-clients",
    detail: `${r.name}: pull=${JSON.stringify(out.pull || {})} push_ok=${out.push?.ok ?? "n/a"}`,
    ok: !(out.push?.failed?.length),
  });

  console.log("\nSync finished for", r.name);
}

main().catch((e) => {
  console.error("\nSYNC FAILED:", e.message || e);
  process.exit(1);
});
