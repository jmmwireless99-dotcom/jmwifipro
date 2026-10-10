/**
 * Push all billing PPPoE accounts to MikroTik router PPPOE-JMPRO (/ppp/secret).
 *
 * Usage (on VPS):
 *   node deploy/provision-all-pppoe-jmpro.mjs [router-name] [--assign]
 *
 * --assign  also set router_id on customers missing/wrong router (default: only customers on this router)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Customers, Routers, Settings } from "../lib/db.js";
import { RouterOSAPI } from "../lib/routeros-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const ROUTER_NAME = process.argv.find((a) => !a.startsWith("-")) || "PPPOE-JMPRO";
const ASSIGN_ALL = process.argv.includes("--assign");

function connFor(r) {
  return new RouterOSAPI({
    host: (r.host || "").split(":")[0],
    user: r.username,
    password: r.password,
    port: Number(r.port) || (r.ssl ? 8729 : 8728),
    ssl: !!r.ssl,
    timeout: 20000,
  });
}

function suspendedProfile() {
  return (Settings.get("suspended_profile") || "suspended-pool").trim() || "suspended-pool";
}

function isPppoeCustomer(c) {
  if ((c.conn_type || "pppoe") === "ipoe") return false;
  if ((c.plan_type || "pppoe") === "hotspot") return false;
  return !!String(c.username || "").trim();
}

async function profileExists(conn, name) {
  const profiles = (await conn.pppProfiles().catch(() => [])) || [];
  return profiles.some((p) => String(p.name || "").toLowerCase() === String(name || "").toLowerCase());
}

async function main() {
  const routers = Routers.list();
  const r = routers.find((x) => x.name === ROUTER_NAME) || routers.find((x) => x.is_default);
  if (!r) throw new Error("Router not found: " + ROUTER_NAME);

  const conn = connFor(r);
  const ident = await conn.identity();
  console.log("Router:", r.name, "id=" + r.id, "→", r.host + ":" + (r.port || 8728));
  console.log("Connected:", ident?.name || "ok");
  console.log("Assign all customers to this router:", ASSIGN_ALL ? "yes" : "no (use --assign to move)");

  const profiles = (await conn.pppProfiles().catch(() => [])) || [];
  const profileNames = new Set(profiles.map((p) => String(p.name || "").toLowerCase()));
  console.log("Router profiles:", profiles.map((p) => p.name).join(", ") || "(none)");

  const all = Customers.list().filter(isPppoeCustomer);
  let targets = ASSIGN_ALL ? all : all.filter((c) => Number(c.router_id) === Number(r.id) || !c.router_id);

  if (ASSIGN_ALL) {
    for (const c of targets) {
      if (Number(c.router_id) !== Number(r.id)) {
        Customers.setRouter(c.id, r.id);
      }
    }
    targets = all;
  }

  console.log("\nPPPoE customers to provision:", targets.length, "of", all.length, "total\n");

  const ok = [];
  const failed = [];
  const skipped = [];

  for (const c of targets) {
    const user = String(c.username).trim();
    if (!user) {
      skipped.push({ name: c.name, reason: "no username" });
      continue;
    }
    const pass = String(c.password || "").trim();
    if (!pass) {
      skipped.push({ name: c.name, user, reason: "no password in billing" });
      continue;
    }

    let profile = c.status === "suspended" ? suspendedProfile() : (c.plan_profile || "default");
    if (!profileNames.has(profile.toLowerCase())) {
      if (profileNames.has("testing")) profile = "TESTING";
      else if (profileNames.has("default")) profile = "default";
      else {
        failed.push({ name: c.name, user, error: `profile "${c.plan_profile || profile}" not on router` });
        continue;
      }
    }

    try {
      await conn.createPppoe({
        name: user,
        password: pass,
        profile,
        comment: c.name || user,
        service: "pppoe",
      });
      if (c.status === "suspended") {
        await conn.setPppoeDisabled(user, false);
      }
      ok.push({ user, profile, name: c.name });
      process.stdout.write(".");
    } catch (e) {
      failed.push({ name: c.name, user, error: e.message || String(e) });
      process.stdout.write("x");
    }
  }

  console.log("\n\nDone.");
  console.log("  OK:", ok.length);
  console.log("  Failed:", failed.length);
  console.log("  Skipped:", skipped.length);

  if (failed.length) {
    console.log("\nFailed (first 20):");
    for (const f of failed.slice(0, 20)) console.log(" ", f.user || f.name, "—", f.error);
  }
  if (skipped.length) {
    console.log("\nSkipped (first 10):");
    for (const s of skipped.slice(0, 10)) console.log(" ", s.user || s.name, "—", s.reason);
  }

  Routers.setStatus(r.id, failed.length ? "warn" : "ok");
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
