/**
 * Import IPoE plan packages from backup JSON into a billing DB (live or trial).
 * Skips plans that already exist with the same name + price + duration.
 *
 * Usage: node deploy/import-ipoe-plans.mjs [target-db] [backup.json]
 *        node deploy/import-ipoe-plans.mjs --dry-run billing.db data/backup/ipoe-plans.json
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => a !== "--dry-run");
const DRY = process.argv.includes("--dry-run");
const TARGET = args[0] || path.join(ROOT, "billing.db");
const BACKUP = args[1] || path.join(ROOT, "data", "backup", "ipoe-plans.json");

if (!fs.existsSync(BACKUP)) {
  console.error("Backup not found:", BACKUP);
  process.exit(1);
}
if (!fs.existsSync(TARGET)) {
  console.error("Target DB not found:", TARGET);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
const plans = payload.plans || [];
if (!plans.length) {
  console.error("No IPoE plans in backup.");
  process.exit(1);
}

const db = new DatabaseSync(TARGET);

function ensureColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

function migratePlansTable() {
  ensureColumn("plans", "validity_mins", "INTEGER");
  ensureColumn("plans", "duration_value", "INTEGER");
  ensureColumn("plans", "duration_type", "TEXT DEFAULT 'day'");
  ensureColumn("plans", "download_speed", "TEXT DEFAULT ''");
  ensureColumn("plans", "upload_speed", "TEXT DEFAULT ''");
  ensureColumn("plans", "status", "TEXT DEFAULT 'active'");
  ensureColumn("plans", "client_type", "TEXT DEFAULT ''");
  ensureColumn("plans", "data_cap_gb", "INTEGER DEFAULT 0");
  ensureColumn("plans", "features", "TEXT DEFAULT ''");
  ensureColumn("plans", "installation_fee", "REAL DEFAULT 0");
  try {
    db.exec("UPDATE plans SET validity_mins = COALESCE(validity_mins, validity_days*1440) WHERE validity_mins IS NULL");
  } catch {}
}

migratePlansTable();

function existingKey(p) {
  return [
    String(p.name || "").trim().toLowerCase(),
    Number(p.price) || 0,
    Number(p.duration_value) || 0,
    String(p.duration_type || "").toLowerCase(),
  ].join("|");
}

const existing = db.prepare("SELECT * FROM plans WHERE LOWER(COALESCE(type,''))='ipoe' OR LOWER(COALESCE(client_type,''))='ipoe'").all();
const existingKeys = new Set(existing.map(existingKey));

const insert = db.prepare(`
  INSERT INTO plans (
    name, price, speed, validity_days, validity_mins, router_profile, type, data_cap_gb, features, installation_fee,
    duration_value, duration_type, download_speed, upload_speed, status, client_type
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

let added = 0;
let skipped = 0;

console.log(DRY ? "DRY RUN —" : "", "Import to:", TARGET);
console.log("From backup:", BACKUP, "(" + plans.length + " plans, exported", payload.exported_at + ")");

for (const p of plans) {
  const row = {
    name: String(p.name || "").trim(),
    price: Number(p.price) || 0,
    speed: p.speed || "",
    validity_days: Number(p.validity_days) || 0,
    validity_mins: Number(p.validity_mins) || 0,
    router_profile: p.router_profile || "",
    type: "ipoe",
    client_type: "ipoe",
    data_cap_gb: Number(p.data_cap_gb) || 0,
    features: p.features || "",
    installation_fee: Number(p.installation_fee) || 0,
    duration_value: Number(p.duration_value) || 1,
    duration_type: p.duration_type || "day",
    download_speed: p.download_speed || "",
    upload_speed: p.upload_speed || "",
    status: p.status || "active",
  };
  if (!row.name) { skipped++; continue; }
  const key = existingKey(row);
  if (existingKeys.has(key)) {
    console.log("SKIP (exists):", row.name, "₱" + row.price);
    skipped++;
    continue;
  }
  if (!DRY) {
    insert.run(
      row.name, row.price, row.speed, row.validity_days, row.validity_mins, row.router_profile, row.type,
      row.data_cap_gb, row.features, row.installation_fee,
      row.duration_value, row.duration_type, row.download_speed, row.upload_speed, row.status, row.client_type
    );
    existingKeys.add(key);
  }
  console.log((DRY ? "WOULD ADD" : "ADDED") + ":", row.name, "₱" + row.price, row.duration_value, row.duration_type, row.download_speed + "/" + row.upload_speed);
  added++;
}

const after = db.prepare("SELECT id, name, price, duration_value, duration_type, download_speed, upload_speed, status FROM plans WHERE LOWER(COALESCE(type,''))='ipoe' OR LOWER(COALESCE(client_type,''))='ipoe' ORDER BY price").all();
console.log("\nDone.", added, "added,", skipped, "skipped.");
console.log("IPoE plans now on target:", after.length);
for (const p of after) console.log(" ", p.id, p.name, "₱" + p.price, p.duration_value, p.duration_type, p.status);
