/**
 * Sync ALL PPPoE secrets from CANDELARIA-PPPOE → PPPOE-PRO (enabled).
 * Does NOT delete/modify secrets on CANDELARIA-PPPOE.
 * Optionally removes /ppp/active sessions only (--kick-active).
 *
 * Usage on VPS:
 *   BILLING_DB=/opt/jm-billing/billing.db node deploy/sync-candelaria-secrets-to-pppoe-pro.mjs
 *   BILLING_DB=/opt/jm-billing/billing.db node deploy/sync-candelaria-secrets-to-pppoe-pro.mjs --kick-active
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const DRY = process.argv.includes("--dry-run");
const KICK = process.argv.includes("--kick-active");
const PRO_NAME = "PPPOE-PRO";
const SRC_NAME = "CANDELARIA-PPPOE";

async function loadApi() {
  const candidates = [
    path.join(ROOT, "lib/routeros-api.js"),
    "/opt/jm-billing/lib/routeros-api.js",
  ];
  for (const p of candidates) {
    try {
      const { RouterOSAPI } = await import(p);
      return RouterOSAPI;
    } catch {
      /* try next */
    }
  }
  throw new Error("routeros-api.js not found");
}

function rowByName(db, name) {
  return (
    db.prepare("SELECT * FROM routers WHERE name=? AND enabled=1 ORDER BY id LIMIT 1").get(name) ||
    db.prepare("SELECT * FROM routers WHERE name LIKE ? ORDER BY id LIMIT 1").get(`%${name}%`)
  );
}

async function conn(name) {
  const API = await loadApi();
  const db = new DatabaseSync(DB);
  const row = rowByName(db, name);
  if (!row) throw new Error(`Router ${name} not found`);
  return new API({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    timeout: 180000,
  });
}

function isPppoeSecret(s) {
  const svc = String(s.service || "any").toLowerCase();
  return svc === "pppoe" || svc === "any" || svc === "";
}

async function ensureSecretEnabled(api, src) {
  if (!src.password) return "skip-no-pass";
  const existing = await api.findId("/ppp/secret", "name", src.name);
  const attrs = {
    name: src.name,
    password: src.password,
    profile: src.profile || "default",
    service: src.service || "pppoe",
    disabled: "false",
  };
  if (src["caller-id"]) attrs["caller-id"] = src["caller-id"];
  if (src.comment) attrs.comment = String(src.comment).slice(0, 120);
  if (existing) {
    if (!DRY) await api.setById("/ppp/secret", existing, attrs);
    return "updated";
  }
  if (!DRY) await api.add("/ppp/secret", attrs);
  return "created";
}

async function kickAllActive(api, label) {
  const active = await api.print("/ppp/active");
  let removed = 0;
  for (const a of active) {
    if (!a[".id"]) continue;
    if (!DRY) {
      try {
        await api.removeById("/ppp/active", a[".id"]);
        removed++;
      } catch (e) {
        console.warn(`kick fail ${label} ${a.name}:`, e.message || e);
      }
    } else {
      removed++;
    }
  }
  return { total: active.length, removed };
}

async function main() {
  const src = await conn(SRC_NAME);
  const pro = await conn(PRO_NAME);
  const report = {
    dry: DRY,
    kick: KICK,
    source: SRC_NAME,
    target: PRO_NAME,
    secrets: { created: 0, updated: 0, skipped: 0, totalSrc: 0 },
    srcSecretsUntouched: true,
    kickActive: {},
    verify: {},
    errors: [],
  };

  console.log("Source:", (await src.identity()).name);
  console.log("Target:", (await pro.identity()).name, DRY ? "(dry-run)" : "");

  const srcSecrets = (await src.print("/ppp/secret")).filter(isPppoeSecret);
  report.secrets.totalSrc = srcSecrets.length;
  console.log(`Candelaria PPPoE secrets: ${srcSecrets.length} (will NOT delete)`);

  for (const s of srcSecrets) {
    try {
      const a = await ensureSecretEnabled(pro, s);
      if (a === "created") report.secrets.created++;
      else if (a === "updated") report.secrets.updated++;
      else report.secrets.skipped++;
    } catch (e) {
      report.errors.push({ secret: s.name, error: String(e.message || e) });
    }
  }

  // Force-enable every secret already on PPPOE-PRO (including Magasay-only ones)
  const proSecrets = await pro.print("/ppp/secret");
  let enabled = 0;
  for (const s of proSecrets.filter(isPppoeSecret)) {
    if (String(s.disabled) === "true") {
      if (!DRY) await pro.setById("/ppp/secret", s[".id"], { disabled: "false" });
      enabled++;
    }
  }
  report.secrets.forceEnabled = enabled;

  if (KICK) {
    // Active sessions only — never touch /ppp/secret on Candelaria
    report.kickActive.candelaria = await kickAllActive(src, SRC_NAME);
    report.kickActive.pppoePro = await kickAllActive(pro, PRO_NAME);
  }

  const after = (await pro.print("/ppp/secret")).filter(isPppoeSecret);
  const disabledLeft = after.filter((s) => String(s.disabled) === "true").length;
  const srcAfter = (await src.print("/ppp/secret")).filter(isPppoeSecret);
  const missing = srcSecrets.map((s) => s.name).filter((n) => !after.some((p) => p.name === n));
  report.verify = {
    candelariaSecrets: srcAfter.length,
    pppoeProSecrets: after.length,
    pppoeProDisabled: disabledLeft,
    missingOnPro: missing,
    proActive: (await pro.print("/ppp/active")).length,
    candelariaActive: (await src.print("/ppp/active")).length,
  };

  // Ensure PPPoE server enabled on PRO
  const servers = await pro.print("/interface/pppoe-server/server");
  if (servers[0] && !DRY) {
    await pro.setById("/interface/pppoe-server/server", servers[0][".id"], { disabled: "false" });
  }
  report.pppoeServer = servers.map((s) => ({
    interface: s.interface,
    disabled: s.disabled,
    invalid: s.invalid,
    service: s["service-name"],
  }));

  await src.close?.();
  await pro.close?.();
  console.log(JSON.stringify(report, null, 2));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
