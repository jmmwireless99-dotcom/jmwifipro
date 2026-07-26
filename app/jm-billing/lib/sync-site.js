// lib/sync-site.js — pull/push PPPoE clients for one MikroTik site.
import { Customers, Plans, Routers, Settings, Audit } from "./db.js";

export function suspendedProfileName() {
  const v = (Settings.get("suspended_profile") || "SUSPENDED").trim();
  return v || "SUSPENDED";
}

function isPppoeCustomer(c) {
  if ((c.conn_type || "pppoe") === "ipoe") return false;
  if ((c.plan_type || "pppoe") === "hotspot") return false;
  return !!String(c.username || "").trim();
}

export async function pullSiteFromRouter(r, conn) {
  const planByProfile = {};
  for (const p of Plans.list()) {
    if (p.router_profile) planByProfile[String(p.router_profile).toLowerCase()] = p.id;
  }
  const suspProf = suspendedProfileName().toLowerCase();
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

export async function pushSiteToRouter(r, conn, { reprovisionAll = false } = {}) {
  const profiles = (await conn.pppProfiles().catch(() => [])) || [];
  const profileNames = new Set(profiles.map((p) => String(p.name || "").toLowerCase()));
  const onRouter = new Set(((await conn.listPppoe().catch(() => [])) || []).map((x) => String(x.name || "").toLowerCase()));
  const susp = suspendedProfileName();
  const targets = Customers.list().filter(isPppoeCustomer).filter((c) => Number(c.router_id) === Number(r.id));

  const ok = [], failed = [], skipped = [];

  for (const c of targets) {
    const user = String(c.username).trim();
    const pass = String(c.password || "").trim();
    if (!user) { skipped.push({ name: c.name, reason: "no username" }); continue; }
    if (!pass) { skipped.push({ name: c.name, user, reason: "no password in billing" }); continue; }
    if (!reprovisionAll && onRouter.has(user.toLowerCase()) && c.status !== "suspended") {
      skipped.push({ user, reason: "already on router" });
      continue;
    }

    let profile = c.status === "suspended" ? susp : (c.plan_profile || "default");
    if (!profileNames.has(profile.toLowerCase())) {
      if (profileNames.has("default")) profile = "default";
      else if (profileNames.has("testing")) profile = "TESTING";
      else if (profileNames.has("residential-999")) profile = "Residential-999";
      else {
        failed.push({ user, name: c.name, error: `profile "${c.plan_profile || profile}" missing on router` });
        continue;
      }
    }

    try {
      await conn.createPppoe({ name: user, password: pass, profile, comment: c.name || user, service: "pppoe" });
      ok.push({ user, profile, id: c.id });
    } catch (e) {
      failed.push({ user, name: c.name, id: c.id, error: e.message || String(e) });
    }
  }

  return { targets: targets.length, ok, failed, skipped };
}

export async function syncSiteClients(r, conn, opts = {}) {
  const pull = opts.pull !== false ? await pullSiteFromRouter(r, conn) : null;
  const push = opts.push !== false ? await pushSiteToRouter(r, conn, { reprovisionAll: !!opts.reprovisionAll }) : null;
  Audit.add({
    type: "manual",
    action: "sync-site-clients",
    detail: `${r.name}: pull=${JSON.stringify(pull || {})} push_ok=${push ? push.ok.length : "n/a"}`,
    ok: !(push && push.failed.length),
  });
  return { pull, push };
}
