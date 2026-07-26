// lib/db.js
// Billing database using Node's BUILT-IN SQLite (node:sqlite). Zero external
// dependencies. The data lives in a single file next to the app (billing.db),
// so it's easy to back up — just copy that one file.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { loadEnv } from "./env.js";
import { initHotspotCentral, HotspotCentralApi, hotspotCentralEnabled, uptimeToSecs, mikrotikCentralRadiusScript } from "./hotspot-central.js";

loadEnv(); // ensure .env is applied before we read DB_FILE (imports run early)

const DB_FILE = process.env.DB_FILE || path.resolve(process.cwd(), "billing.db");
const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  speed TEXT DEFAULT '',
  validity_days INTEGER DEFAULT 30,
  router_profile TEXT DEFAULT 'default',
  type TEXT DEFAULT 'pppoe',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  address TEXT DEFAULT '',
  username TEXT DEFAULT '',
  password TEXT DEFAULT '',
  plan_id INTEGER,
  billing_day INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  status TEXT DEFAULT 'unpaid',
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT,
  UNIQUE(customer_id, period)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  invoice_id INTEGER,
  amount REAL NOT NULL DEFAULT 0,
  method TEXT DEFAULT 'cash',
  reference TEXT DEFAULT '',
  note TEXT DEFAULT '',
  paid_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT DEFAULT (datetime('now')),
  type TEXT DEFAULT 'auto',
  customer_id INTEGER,
  customer_name TEXT DEFAULT '',
  action TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  ok INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS hotspot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT DEFAULT (datetime('now')),
  type TEXT DEFAULT '',
  user TEXT DEFAULT '',
  amount REAL DEFAULT 0,
  mac TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  detail TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS vendos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ip TEXT NOT NULL,
  port INTEGER DEFAULT 80,
  username TEXT DEFAULT '',
  password TEXT DEFAULT '',
  apikey TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  last_seen TEXT,
  online INTEGER DEFAULT 0,
  last_data TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coin_log_seen (
  sig TEXT PRIMARY KEY,
  at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  role TEXT DEFAULT 'cashier',
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);
`);

// --- lightweight migration: add columns introduced after Phase 1 ---
function ensureColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
ensureColumn("customers", "auto_suspended", "INTEGER DEFAULT 0");
ensureColumn("hotspot_events", "vendo", "TEXT DEFAULT ''");
ensureColumn("hotspot_events", "device", "TEXT DEFAULT ''");
ensureColumn("invoices", "payment_link_id", "TEXT DEFAULT ''");
ensureColumn("invoices", "payment_url", "TEXT DEFAULT ''");
ensureColumn("invoices", "note", "TEXT DEFAULT ''");
ensureColumn("customers", "expiry", "TEXT DEFAULT ''");
ensureColumn("plans", "validity_mins", "INTEGER");
try { db.exec("UPDATE plans SET validity_mins = COALESCE(validity_mins, validity_days*1440)"); } catch {}
ensureColumn("customers", "last_reminded", "TEXT DEFAULT ''");
ensureColumn("customers", "area", "TEXT DEFAULT ''");
ensureColumn("customers", "lat", "REAL");
ensureColumn("customers", "lng", "REAL");
ensureColumn("plans", "duration_value", "INTEGER");
ensureColumn("plans", "duration_type", "TEXT DEFAULT 'day'");
ensureColumn("plans", "download_speed", "TEXT DEFAULT ''");
ensureColumn("plans", "upload_speed", "TEXT DEFAULT ''");
ensureColumn("plans", "status", "TEXT DEFAULT 'active'");
ensureColumn("plans", "client_type", "TEXT DEFAULT ''");
ensureColumn("customers", "last_paid_plan_id", "INTEGER");
ensureColumn("invoices", "plan_id", "INTEGER");

try {
  db.exec(`
    UPDATE plans SET
      duration_value = COALESCE(duration_value, validity_days, 30),
      duration_type = CASE WHEN duration_type IS NULL OR trim(duration_type) = '' THEN 'day' ELSE duration_type END,
      status = CASE WHEN status IS NULL OR trim(status) = '' THEN 'active' ELSE status END,
      client_type = CASE WHEN client_type IS NULL OR trim(client_type) = '' THEN COALESCE(type, 'pppoe') ELSE client_type END
    WHERE duration_value IS NULL OR duration_type IS NULL OR trim(duration_type) = '' OR status IS NULL OR trim(status) = '' OR client_type IS NULL OR trim(client_type) = '';
    UPDATE plans SET download_speed = CASE
      WHEN (download_speed IS NULL OR trim(download_speed) = '') AND speed LIKE '%/%' THEN trim(substr(speed, 1, instr(speed, '/') - 1))
      WHEN (download_speed IS NULL OR trim(download_speed) = '') THEN trim(COALESCE(speed, ''))
      ELSE download_speed END
    WHERE download_speed IS NULL OR trim(download_speed) = '';
    UPDATE plans SET upload_speed = CASE
      WHEN (upload_speed IS NULL OR trim(upload_speed) = '') AND speed LIKE '%/%' THEN trim(substr(speed, instr(speed, '/') + 1))
      WHEN (upload_speed IS NULL OR trim(upload_speed) = '') THEN trim(COALESCE(speed, ''))
      ELSE upload_speed END
    WHERE upload_speed IS NULL OR trim(upload_speed) = '';
  `);
} catch {}

/** Minutes of service from plan duration fields (falls back to validity_mins / validity_days). */
export function planDurationMins(p) {
  if (!p) return 43200;
  if (p.validity_mins != null && Number(p.validity_mins) > 0) return Number(p.validity_mins);
  const v = Number(p.duration_value) || Number(p.validity_days) || 30;
  const t = String(p.duration_type || "day").toLowerCase();
  if (t === "week") return v * 7 * 1440;
  if (t === "month") return v * 30 * 1440;
  if (t === "hour") return v * 60;
  if (t === "min" || t === "minute") return v;
  return v * 1440;
}

export function planSpeedDown(p) {
  if (!p) return "";
  const d = String(p.download_speed || "").trim();
  if (d) return d;
  const s = String(p.speed || "").trim();
  // Legacy plans stored MikroTik rate in speed as "100M/100M".
  if (s.includes("/")) return s.split("/")[0].trim();
  return "";
}

export function planSpeedUp(p) {
  if (!p) return "";
  const u = String(p.upload_speed || "").trim();
  if (u) return u;
  const s = String(p.speed || "").trim();
  if (s.includes("/")) return (s.split("/")[1] || "").trim();
  return "";
}

/** Customer-facing label on jmwifi.pro/apply (Mbps text). Uses plans.speed, not MikroTik queue. */
export function planDisplaySpeed(p) {
  if (!p) return "";
  const s = String(p.speed || "").trim();
  if (s && !s.includes("/")) return s.replace(/\s*mbps\s*$/i, "").trim();
  const d = planSpeedDown(p);
  if (d) return d.replace(/[MmKkBb]$/, "").trim();
  return s.replace(/[MmKkBb/].*$/, "").trim();
}

export function planRateLimit(p) {
  const d = planSpeedDown(p), u = planSpeedUp(p) || d;
  if (!d) return "";
  return d + "/" + (u || d);
}

export function fmtPlanDuration(p) {
  if (!p) return "";
  const v = Number(p.duration_value) || Math.max(1, Math.round(planDurationMins(p) / 1440));
  const t = String(p.duration_type || "day").toLowerCase();
  const label = t === "week" ? "week" : t === "month" ? "month" : t === "hour" ? "hour" : "day";
  return `${v} ${label}${v === 1 ? "" : "s"}`;
}

function planMatchesConnType(p, connType) {
  const ct = String(connType || "pppoe").toLowerCase();
  const clientType = String(p.client_type || p.type || "pppoe").toLowerCase();
  if (clientType === "both") return true;
  return clientType === ct;
}

const run = (sql, ...args) => db.prepare(sql).run(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const get = (sql, ...args) => db.prepare(sql).get(...args);

function pad2(n) { return String(n).padStart(2, "0"); }
export function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

// ---- Plans ---------------------------------------------------------------
function planRowFields(p) {
  const mins = planDurationMins(p);
  const download_speed = planSpeedDown(p);
  const upload_speed = planSpeedUp(p);
  // speed column = display label for portal/apply (e.g. "100" or "100 Mbps"). MikroTik uses download_speed/upload_speed.
  let speed = String(p.speed || "").trim();
  if (speed.includes("/")) {
    speed = planDisplaySpeed({ ...p, speed: speed.split("/")[0] });
  }
  if (!speed && download_speed) speed = download_speed.replace(/[MmKkBb]$/, "").trim();
  const durVal = Number(p.duration_value) || Math.max(1, Math.round(mins / (String(p.duration_type || "day").toLowerCase() === "week" ? 10080 : String(p.duration_type || "day").toLowerCase() === "month" ? 43200 : 1440)));
  const durType = String(p.duration_type || "day").toLowerCase();
  const clientType = String(p.client_type || p.type || "pppoe").toLowerCase();
  const status = String(p.status || "active").toLowerCase() === "inactive" ? "inactive" : "active";
  return {
    name: p.name,
    price: Number(p.price) || 0,
    speed,
    validity_days: Math.max(1, Math.round(mins / 1440)),
    validity_mins: mins,
    router_profile: p.router_profile || "default",
    type: p.type || (clientType === "both" ? "ipoe" : clientType),
    data_cap_gb: Number(p.data_cap_gb) || 0,
    features: p.features || "",
    installation_fee: Number(p.installation_fee) || 0,
    duration_value: durVal,
    duration_type: durType,
    download_speed,
    upload_speed,
    status,
    client_type: clientType,
  };
}

export const Plans = {
  list: () => all("SELECT * FROM plans ORDER BY price ASC"),
  listActiveForConn: (connType) => {
    const ct = String(connType || "pppoe").toLowerCase();
    return all("SELECT * FROM plans ORDER BY price ASC").filter((p) =>
      String(p.status || "active").toLowerCase() !== "inactive" && planMatchesConnType(p, ct));
  },
  get: (id) => get("SELECT * FROM plans WHERE id=?", id),
  /** Per-plan install fee, or global default when plan fee is 0 / missing. */
  installFee: (planId, globalFallback = 0) => {
    const g = Number(globalFallback) || 0;
    if (!planId) return g;
    const p = get("SELECT installation_fee FROM plans WHERE id=?", planId);
    if (!p) return g;
    const f = Number(p.installation_fee);
    return f > 0 ? f : g;
  },
  create: (p) => {
    const f = planRowFields(p);
    const r = run(
      `INSERT INTO plans (name,price,speed,validity_days,validity_mins,router_profile,type,data_cap_gb,features,installation_fee,
        duration_value,duration_type,download_speed,upload_speed,status,client_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      f.name, f.price, f.speed, f.validity_days, f.validity_mins, f.router_profile, f.type, f.data_cap_gb, f.features, f.installation_fee,
      f.duration_value, f.duration_type, f.download_speed, f.upload_speed, f.status, f.client_type
    );
    return get("SELECT * FROM plans WHERE id=?", r.lastInsertRowid);
  },
  update: (id, p) => {
    const cur = get("SELECT * FROM plans WHERE id=?", id);
    if (!cur) return null;
    const f = planRowFields({ ...cur, ...p });
    run(
      `UPDATE plans SET name=?,price=?,speed=?,validity_days=?,validity_mins=?,router_profile=?,type=?,data_cap_gb=?,features=?,installation_fee=?,
        duration_value=?,duration_type=?,download_speed=?,upload_speed=?,status=?,client_type=? WHERE id=?`,
      f.name, f.price, f.speed, f.validity_days, f.validity_mins, f.router_profile, f.type, f.data_cap_gb, f.features, f.installation_fee,
      f.duration_value, f.duration_type, f.download_speed, f.upload_speed, f.status, f.client_type, id
    );
    return get("SELECT * FROM plans WHERE id=?", id);
  },
  remove: (id) => run("DELETE FROM plans WHERE id=?", id),
};

// ---- Customers -----------------------------------------------------------
function normalizeExpiryStored(val) {
  const v = String(val || "").trim();
  if (!v) return "";
  const normalized = v.replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) return normalized + ":00";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) return normalized.slice(0, 19);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v + " 23:59:59";
  return normalized;
}

export const Customers = {
  list: () =>
    all(`SELECT c.*, p.name AS plan_name, p.price AS plan_price, p.type AS plan_type,
                p.router_profile AS plan_profile, p.validity_days AS plan_days, p.validity_mins AS plan_mins, p.data_cap_gb AS plan_cap, p.speed AS plan_speed,
                p.download_speed AS plan_download_speed, p.upload_speed AS plan_upload_speed,
                p.installation_fee AS plan_install_fee,
                lp.name AS last_paid_plan_name, lp.price AS last_paid_plan_price,
                rt.name AS router_name
         FROM customers c LEFT JOIN plans p ON p.id=c.plan_id
         LEFT JOIN plans lp ON lp.id=c.last_paid_plan_id
         LEFT JOIN routers rt ON rt.id=c.router_id
         ORDER BY c.name ASC`),
  get: (id) =>
    get(`SELECT c.*, p.name AS plan_name, p.price AS plan_price, p.type AS plan_type,
                p.router_profile AS plan_profile, p.validity_days AS plan_days, p.validity_mins AS plan_mins, p.data_cap_gb AS plan_cap, p.speed AS plan_speed,
                p.download_speed AS plan_download_speed, p.upload_speed AS plan_upload_speed,
                p.installation_fee AS plan_install_fee,
                lp.name AS last_paid_plan_name, lp.price AS last_paid_plan_price,
                rt.name AS router_name
         FROM customers c LEFT JOIN plans p ON p.id=c.plan_id
         LEFT JOIN plans lp ON lp.id=c.last_paid_plan_id
         LEFT JOIN routers rt ON rt.id=c.router_id WHERE c.id=?`, id),
  create: (c) => {
    // Random subscriber code like IPOE-5NIHH1VKH3MQ (or PPPOE-… for PPPoE).
    const prefix = (c.conn_type || "pppoe") === "ipoe" ? "IPOE" : (c.conn_type || "pppoe") === "hotspot" ? "HS" : "PPPOE";
    const rand = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 12; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
    let code = c.account_code || (prefix + "-" + rand());
    let guard = 0;
    while (get("SELECT id FROM customers WHERE account_code=?", code) && guard++ < 8) code = prefix + "-" + rand();
    const r = run(
      `INSERT INTO customers (name,contact,address,area,username,password,plan_id,billing_day,status,notes,lat,lng,conn_type,mac,static_ip,vlan_iface,account_code,router_id,referred_by,expiry)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      c.name, c.contact || "", c.address || "", c.area || "", c.username || "", c.password || "",
      c.plan_id || null, Number(c.billing_day) || 1, c.status || "active", c.notes || "",
      c.lat != null && c.lat !== "" ? Number(c.lat) : null, c.lng != null && c.lng !== "" ? Number(c.lng) : null,
      c.conn_type || "pppoe", (c.mac || "").toUpperCase(), c.static_ip || "", c.vlan_iface || "", code,
      (c.router_id != null && c.router_id !== "") ? Number(c.router_id) : null,
      c.referred_by ? Number(c.referred_by) : null,
      c.expiry != null ? normalizeExpiryStored(c.expiry) : ""
    );
    Referrals.ensureCode(r.lastInsertRowid, c.username || c.name);
    return Customers.get(r.lastInsertRowid);
  },
  setRouter: (id, routerId) => run("UPDATE customers SET router_id=? WHERE id=?", (routerId != null && routerId !== "") ? Number(routerId) : null, id),
  update: (id, c) => {
    const cur = Customers.get(id);
    if (!cur) return null;
    const pick = (k, def = "") => (k in c && c[k] != null && c[k] !== "") ? c[k] : (cur[k] ?? def);
    const pickStr = (k) => (k in c) ? String(c[k] || "") : String(cur[k] || "");
    const expiry = ("expiry" in c) ? normalizeExpiryStored(c.expiry) : normalizeExpiryStored(cur.expiry);
    run(
      `UPDATE customers SET name=?,contact=?,address=?,area=?,username=?,password=?,plan_id=?,billing_day=?,notes=?,conn_type=?,mac=?,static_ip=?,vlan_iface=?,router_id=?,expiry=?,status=? WHERE id=?`,
      pick("name", cur.name), pickStr("contact"), pickStr("address"), pickStr("area"), pickStr("username"),
      (c.password != null && String(c.password) !== "") ? c.password : (cur.password || ""),
      ("plan_id" in c) ? (c.plan_id || null) : cur.plan_id,
      ("billing_day" in c) ? (Number(c.billing_day) || 1) : (Number(cur.billing_day) || 1),
      pickStr("notes"),
      pickStr("conn_type") || "pppoe", pickStr("mac").toUpperCase(), pickStr("static_ip"), pickStr("vlan_iface"),
      ("router_id" in c)
        ? ((c.router_id != null && c.router_id !== "") ? Number(c.router_id) : null)
        : cur.router_id,
      expiry,
      ("status" in c) ? String(c.status || "active") : (cur.status || "active"),
      id
    );
    return Customers.get(id);
  },
  setLocation: (id, lat, lng, napId) => { run("UPDATE customers SET lat=?, lng=?, nap_id=? WHERE id=?", lat == null || lat === "" ? null : Number(lat), lng == null || lng === "" ? null : Number(lng), napId ? Number(napId) : null, id); return Customers.get(id); },
  located: () => all("SELECT c.*, p.name AS plan_name FROM customers c LEFT JOIN plans p ON p.id=c.plan_id WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL"),
  areas: () => all("SELECT DISTINCT area FROM customers WHERE area<>'' ORDER BY area").map((r) => r.area),
  addCredit: (id, amount, reason) => {
    const amt = Number(amount) || 0;
    run("UPDATE customers SET credit = COALESCE(credit,0) + ? WHERE id=?", amt, id);
    run("INSERT INTO credit_ledger (customer_id,amount,reason) VALUES (?,?,?)", id, amt, reason || "");
    // Option A (cash basis): a POSITIVE credit change = real money arriving (a top-up), so record
    // it as income tagged "Wallet topup:". A NEGATIVE change = spending wallet credit, which is
    // NOT new cash (already counted at top-up), so we never record income for it here.
    // Skip internal moves that shouldn't be income: a "wallet renewal"/"wallet" spend is negative
    // anyway; an explicit reason starting with "no-income" is also skipped.
    if (amt > 0 && !/^no-income/i.test(reason || "")) {
      try { run("INSERT INTO payments (customer_id,amount,method,note) VALUES (?,?,?,?)", id, amt, "wallet", "Wallet topup: " + (reason || "")); } catch {}
    }
    return get("SELECT credit FROM customers WHERE id=?", id).credit;
  },
  creditLedger: (id) => all("SELECT * FROM credit_ledger WHERE customer_id=? ORDER BY id DESC LIMIT 20", id),
  byUsername: (u) => get(
    `SELECT c.*, p.name AS plan_name, p.price AS plan_price, p.type AS plan_type, p.router_profile AS plan_profile, p.validity_days AS plan_days, p.validity_mins AS plan_mins, p.data_cap_gb AS plan_cap, p.speed AS plan_speed
     FROM customers c LEFT JOIN plans p ON p.id=c.plan_id WHERE LOWER(c.username)=LOWER(?)`, String(u || "")),
  byArea: (area) => all("SELECT * FROM customers WHERE area=? AND contact<>''", area),
  // Match a customer by mobile number (last 10 digits, ignoring formatting / +63 / 0 prefix).
  byContact: (phone) => {
    const d = String(phone || "").replace(/\D/g, "");
    if (d.length < 7) return null;
    const tail = d.slice(-10);
    return all("SELECT * FROM customers WHERE contact<>''").find((c) => String(c.contact).replace(/\D/g, "").endsWith(tail)) || null;
  },
  setStatus: (id, status) => { run("UPDATE customers SET status=? WHERE id=?", status, id); return Customers.get(id); },
  setExpiry: (id, date) => { run("UPDATE customers SET expiry=? WHERE id=?", normalizeExpiryStored(date), id); return Customers.get(id); },
  setLastPaidPlan: (id, planId) => { run("UPDATE customers SET last_paid_plan_id=? WHERE id=?", planId || null, id); return Customers.get(id); },
  // Active customers whose expiry is at/before the given time (datetime, billing server clock).
  expiredAsOf: (nowStr) => all(
    `SELECT c.*, p.name AS plan_name, p.price AS plan_price, p.type AS plan_type, p.router_profile AS plan_profile, p.validity_days AS plan_days, p.validity_mins AS plan_mins, p.data_cap_gb AS plan_cap, p.speed AS plan_speed
     FROM customers c LEFT JOIN plans p ON p.id=c.plan_id
     WHERE c.status='active' AND trim(c.expiry) <> ''
       AND datetime(replace(trim(c.expiry), 'T', ' ')) <= datetime(?)
       AND (trim(c.username) <> '' OR trim(c.static_ip) <> '' OR trim(c.mac) <> '')`, nowStr),
  // Expired PPPoE/hotspot accounts (any DB status) — validated every sweep by router profile.
  expiredPppoeForValidation: (nowStr) => all(
    `SELECT c.*, p.name AS plan_name, p.price AS plan_price, p.type AS plan_type, p.router_profile AS plan_profile, p.validity_days AS plan_days, p.validity_mins AS plan_mins, p.data_cap_gb AS plan_cap, p.speed AS plan_speed
     FROM customers c LEFT JOIN plans p ON p.id=c.plan_id
     WHERE trim(c.expiry) <> ''
       AND datetime(replace(trim(c.expiry), 'T', ' ')) <= datetime(?)
       AND trim(c.username) <> ''
       AND COALESCE(c.conn_type, 'pppoe') <> 'ipoe'`, nowStr),
  // Auto-suspended, past expiry — kept for reports; sweep uses expiredPppoeForValidation.
  expiredRouterResync: (nowStr) => all(
    `SELECT c.*, p.name AS plan_name, p.price AS plan_price, p.type AS plan_type, p.router_profile AS plan_profile, p.validity_days AS plan_days, p.validity_mins AS plan_mins, p.data_cap_gb AS plan_cap, p.speed AS plan_speed
     FROM customers c LEFT JOIN plans p ON p.id=c.plan_id
     WHERE c.status='suspended' AND c.auto_suspended=1 AND trim(c.expiry) <> ''
       AND datetime(replace(trim(c.expiry), 'T', ' ')) <= datetime(?)
       AND (trim(c.username) <> '' OR trim(c.static_ip) <> '' OR trim(c.mac) <> '')`, nowStr),
  isExpiredAsOf: (expiry, nowStr) => {
    const e = normalizeExpiryStored(expiry);
    if (!e || !nowStr) return false;
    const row = get("SELECT datetime(replace(?, 'T', ' ')) <= datetime(?) AS due", e, nowStr);
    return !!row?.due;
  },
  // Active customers whose expiry is exactly this date (for reminders N days ahead).
  expiringOn: (ymd) => all(
    `SELECT c.*, p.name AS plan_name FROM customers c LEFT JOIN plans p ON p.id=c.plan_id
     WHERE c.status='active' AND c.expiry <> '' AND date(c.expiry) = date(?)`, ymd),
  // Active customers expiring within [today, toYmd] inclusive (for the daily report).
  expiringBy: (toYmd) => all(
    `SELECT c.*, p.name AS plan_name FROM customers c LEFT JOIN plans p ON p.id=c.plan_id
     WHERE c.status='active' AND c.expiry <> '' AND date(c.expiry) <= date(?) ORDER BY date(c.expiry)`, toYmd),
  setReminded: (id, ymd) => run("UPDATE customers SET last_reminded=? WHERE id=?", ymd, id),
  setStatusAndAuto: (id, status, autoFlag) => {
    run("UPDATE customers SET status=?, auto_suspended=? WHERE id=?", status, autoFlag ? 1 : 0, id);
    return Customers.get(id);
  },
  remove: (id) => run("DELETE FROM customers WHERE id=?", id),
};

// ---- Invoices ------------------------------------------------------------
export const Invoices = {
  get: (id) => get(`SELECT i.*, c.name AS customer_name, c.username, c.contact, c.address, c.plan_id,
                            p.name AS plan_name FROM invoices i JOIN customers c ON c.id=i.customer_id
                     LEFT JOIN plans p ON p.id=c.plan_id WHERE i.id=?`, id),
  list: (filter = {}) => {
    let sql = `SELECT i.*, c.name AS customer_name, c.username AS username
               FROM invoices i JOIN customers c ON c.id=i.customer_id`;
    const where = [], args = [];
    if (filter.status) { where.push("i.status=?"); args.push(filter.status); }
    if (filter.period) { where.push("i.period=?"); args.push(filter.period); }
    if (filter.customer_id) { where.push("i.customer_id=?"); args.push(filter.customer_id); }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY i.created_at DESC LIMIT 500";
    return all(sql, ...args);
  },
  // One-off charge (e.g. installation fee + router cost). Uses a unique period tag.
  addOne: (o) => {
    const period = o.period || ("CHG-" + Date.now());
    const r = run("INSERT INTO invoices (customer_id,period,amount,due_date,status,note,plan_id) VALUES (?,?,?,?, 'unpaid', ?,?)",
      o.customer_id, period, Number(o.amount) || 0, o.due_date || period, o.note || "", o.plan_id || null);
    return get("SELECT * FROM invoices WHERE id=?", r.lastInsertRowid);
  },
  /** One prepaid renewal invoice (IPoE plan switch). Period tag is unique per payment. */
  addPrepaidRenewal: (o) => {
    const period = o.period || ("PREPAID-" + Date.now());
    const r = run("INSERT INTO invoices (customer_id,period,amount,due_date,status,note,plan_id) VALUES (?,?,?,?, 'unpaid', ?,?)",
      o.customer_id, period, Number(o.amount) || 0, o.due_date || period.slice(0, 10), o.note || "IPoE prepaid renewal", o.plan_id || null);
    return get("SELECT * FROM invoices WHERE id=?", r.lastInsertRowid);
  },

  // Create one invoice per active customer (with a plan) for the period,
  // skipping any that already exist. Returns how many were created.
  generateMonthly: (period) => {
    period = period || currentPeriod();
    // only "monthly or longer" plans (>= 28 days) — skips short time/piso plans
    const cust = all(
      `SELECT c.*, p.price AS plan_price FROM customers c
       JOIN plans p ON p.id=c.plan_id
       WHERE c.status='active' AND c.plan_id IS NOT NULL
         AND COALESCE(c.conn_type, 'pppoe') <> 'ipoe'
         AND COALESCE(p.validity_mins, p.validity_days*1440, 43200) >= 40320`
    );
    let created = 0;
    for (const c of cust) {
      if (get("SELECT id FROM invoices WHERE customer_id=? AND period=?", c.id, period)) continue;
      const day = Math.min(Math.max(Number(c.billing_day) || 1, 1), 28);
      run("INSERT INTO invoices (customer_id,period,amount,due_date,status) VALUES (?,?,?,?, 'unpaid')",
        c.id, period, Number(c.plan_price) || 0, `${period}-${pad2(day)}`);
      created++;
    }
    return { period, created };
  },
  generate: (period) => {
    period = period || currentPeriod();
    const cust = all(
      `SELECT c.*, p.price AS plan_price FROM customers c
       JOIN plans p ON p.id=c.plan_id
       WHERE c.status='active' AND c.plan_id IS NOT NULL
         AND COALESCE(c.conn_type, 'pppoe') <> 'ipoe'`
    );
    let created = 0;
    for (const c of cust) {
      const exists = get("SELECT id FROM invoices WHERE customer_id=? AND period=?", c.id, period);
      if (exists) continue;
      const day = Math.min(Math.max(Number(c.billing_day) || 1, 1), 28);
      const due = `${period}-${pad2(day)}`;
      run("INSERT INTO invoices (customer_id,period,amount,due_date,status) VALUES (?,?,?,?, 'unpaid')",
        c.id, period, Number(c.plan_price) || 0, due);
      created++;
    }
    return { period, created };
  },

  setLink: (id, linkId, url) => run("UPDATE invoices SET payment_link_id=?, payment_url=? WHERE id=?", linkId, url, id),
  byLink: (linkId) => get(`SELECT i.*, c.name AS customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.payment_link_id=?`, linkId),
  byCustomer: (id) => all("SELECT * FROM invoices WHERE customer_id=? ORDER BY period DESC, id DESC", id),

  // Record a (possibly partial) payment. Overpayment beyond the balance goes to
  // the customer's wallet credit. Returns { invoice, applied, toCredit }.
  pay: (id, pay = {}) => {
    const inv = get("SELECT * FROM invoices WHERE id=?", id);
    if (!inv) throw new Error("Invoice not found");
    if (inv.status === "paid") return { invoice: inv, applied: 0, toCredit: 0 };
    const already = Number(inv.paid_amount) || 0;
    const balance = Math.max(0, Number(inv.amount) - already);
    const amt = pay.amount != null && pay.amount !== "" ? Number(pay.amount) : balance;
    if (!(amt > 0)) throw new Error("Payment amount must be more than zero");
    const applied = Math.min(amt, balance);
    const toCredit = Math.max(0, amt - balance);
    const newPaid = already + applied;
    const fully = newPaid >= Number(inv.amount) - 0.005;
    run("UPDATE invoices SET paid_amount=?, status=?, paid_at=CASE WHEN ? THEN datetime('now') ELSE paid_at END WHERE id=?",
      newPaid, fully ? "paid" : "unpaid", fully ? 1 : 0, id);
    run("INSERT INTO payments (customer_id,invoice_id,amount,method,reference,note) VALUES (?,?,?,?,?,?)",
      inv.customer_id, id, amt, pay.method || "cash", pay.reference || "", pay.note || (applied < amt ? `₱${toCredit.toFixed(2)} to wallet` : ""));
    if (toCredit > 0 && inv.customer_id) Customers.addCredit(inv.customer_id, toCredit, "no-income: overpayment on invoice #" + id);
    return { invoice: get("SELECT * FROM invoices WHERE id=?", id), applied, toCredit, fully };
  },
};

// ---- Payments ------------------------------------------------------------
export const Payments = {
  get: (id) => get(`SELECT pm.*, c.name AS customer_name, c.username AS customer_username, c.contact AS customer_contact, c.address AS customer_address
                    FROM payments pm LEFT JOIN customers c ON c.id=pm.customer_id WHERE pm.id=?`, id),
  minId: () => { const r = get("SELECT MIN(id) m FROM payments"); return r && r.m ? r.m : 1; },
  list: () =>
    all(`SELECT pm.*, c.name AS customer_name FROM payments pm
         LEFT JOIN customers c ON c.id=pm.customer_id
         ORDER BY pm.paid_at DESC LIMIT 200`),
  byCustomer: (id) => all("SELECT * FROM payments WHERE customer_id=? ORDER BY paid_at DESC", id),
  lastForCustomer: (id) => get("SELECT * FROM payments WHERE customer_id=? ORDER BY paid_at DESC LIMIT 1", id),
  record: (p) => {
    const r = run(
      "INSERT INTO payments (customer_id,invoice_id,amount,method,reference,note) VALUES (?,?,?,?,?,?)",
      p.customer_id || null, p.invoice_id || null, Number(p.amount) || 0,
      p.method || "cash", p.reference || "", p.note || ""
    );
    const row = get("SELECT * FROM payments WHERE id=?", r.lastInsertRowid);
    try { Agents.awardForPayment(row); } catch {}
    return row;
  },
};

// ---- Collections (auto-suspend / auto-reconnect candidates) --------------
export const Collections = {
  collectedOn: (ymd) => get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM payments WHERE date(paid_at)=date(?)", ymd),
  // Customers that should be SUSPENDED: active, have a router username, and have
  // an unpaid invoice whose due date + grace period has passed.
  toSuspend: (graceDays = 0) =>
    all(
      `SELECT DISTINCT c.* FROM customers c
       JOIN invoices i ON i.customer_id = c.id
       WHERE c.status='active' AND c.username <> ''
         AND i.status='unpaid'
         AND date(i.due_date, '+' || ? || ' days') < date('now')`,
      Number(graceDays) || 0
    ),
  // Customers that should be RECONNECTED: previously AUTO-suspended (not manual)
  // and with no unpaid invoices left. Must NOT still be past billing expiry.
  toReconnect: (nowStr) =>
    all(
      `SELECT c.* FROM customers c
       WHERE c.status='suspended' AND c.auto_suspended=1 AND c.username <> ''
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id=c.id AND i.status='unpaid')
         AND (
           trim(c.expiry) = ''
           OR datetime(replace(trim(c.expiry), 'T', ' ')) > datetime(?)
         )`, nowStr || new Date().toISOString().slice(0, 19).replace("T", " ")),
};

// ---- Audit log -----------------------------------------------------------
db.exec("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)");
db.exec(`CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, contact TEXT, message TEXT, image TEXT,
  status TEXT DEFAULT 'open', reply TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);
ensureColumn("tickets", "category", "TEXT DEFAULT ''");
ensureColumn("tickets", "reply_image", "TEXT DEFAULT ''");
db.exec(`CREATE TABLE IF NOT EXISTS payment_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER, customer_id INTEGER, username TEXT,
  image TEXT, note TEXT, amount REAL,
  status TEXT DEFAULT 'pending',
  tg_message_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
)`);
ensureColumn("payment_proofs", "reference", "TEXT DEFAULT ''");
ensureColumn("payment_proofs", "reject_reason", "TEXT DEFAULT ''");
ensureColumn("plans", "data_cap_gb", "REAL DEFAULT 0");
ensureColumn("plans", "features", "TEXT DEFAULT ''");
ensureColumn("plans", "installation_fee", "REAL DEFAULT 0");
db.exec(`CREATE TABLE IF NOT EXISTS usage_live (key TEXT PRIMARY KEY, last_up INTEGER DEFAULT 0, last_down INTEGER DEFAULT 0, updated_at TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS usage_period (key TEXT, period TEXT, up INTEGER DEFAULT 0, down INTEGER DEFAULT 0, PRIMARY KEY (key, period))`);

export const Tickets = {
  add: (t) => { const r = run("INSERT INTO tickets (name,contact,message,image,category) VALUES (?,?,?,?,?)", t.name||"", t.contact||"", t.message||"", t.image||"", t.category||""); return Tickets.get(r.lastInsertRowid); },
  get: (id) => get("SELECT * FROM tickets WHERE id=?", id),
  list: (status) => status ? all("SELECT * FROM tickets WHERE status=? ORDER BY id DESC", status) : all("SELECT * FROM tickets ORDER BY id DESC LIMIT 200"),
  statusView: (id) => get("SELECT id, name, contact, category, message, status, reply, reply_image, created_at FROM tickets WHERE id=?", id),
  setStatus: (id, status) => run("UPDATE tickets SET status=? WHERE id=?", status, id),
  reply: (id, reply, image) => run("UPDATE tickets SET reply=?, reply_image=?, status='answered' WHERE id=?", reply, image || "", id),
  openCount: () => get("SELECT COUNT(*) c FROM tickets WHERE status='open'").c,
};

export const Proofs = {
  add: (p) => { const r = run("INSERT INTO payment_proofs (invoice_id,customer_id,username,image,note,amount,reference,flags) VALUES (?,?,?,?,?,?,?,?)", p.invoice_id||null, p.customer_id||null, p.username||"", p.image||"", p.note||"", p.amount||0, p.reference||"", p.flags||""); return Proofs.get(r.lastInsertRowid); },
  allRefs: () => all("SELECT id, reference, customer_id FROM payment_proofs WHERE reference<>''"),
  get: (id) => get("SELECT * FROM payment_proofs WHERE id=?", id),
  list: (status) => status ? all("SELECT * FROM payment_proofs WHERE status=? ORDER BY id DESC", status) : all("SELECT * FROM payment_proofs ORDER BY id DESC LIMIT 200"),
  latestForUser: (username) => get("SELECT * FROM payment_proofs WHERE lower(username)=lower(?) ORDER BY id DESC LIMIT 1", username),
  setStatus: (id, status) => run("UPDATE payment_proofs SET status=? WHERE id=?", status, id),
  reject: (id, reason) => run("UPDATE payment_proofs SET status='rejected', reject_reason=? WHERE id=?", reason||"", id),
  setMsgId: (id, mid) => run("UPDATE payment_proofs SET tg_message_id=? WHERE id=?", mid, id),
  pendingCount: () => get("SELECT COUNT(*) c FROM payment_proofs WHERE status='pending'").c,
};
export const Settings = {
  get: (k, dflt = "") => { const r = get("SELECT v FROM settings WHERE k=?", k); return r ? r.v : dflt; },
  all: () => { const o = {}; for (const r of all("SELECT k,v FROM settings")) o[r.k] = r.v; return o; },
  set: (k, v) => run("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v == null ? "" : v)),
  setMany: (obj) => { for (const k of Object.keys(obj || {})) Settings.set(k, obj[k]); return Settings.all(); },
};

function _referralCodeFrom(id, seed) {
  const base = String(seed || "JM").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "JM";
  let code = (base + String(id).padStart(4, "0")).slice(0, 12);
  let n = 0;
  while (get("SELECT id FROM customers WHERE referral_code=? AND id<>?", code, id || 0) && n++ < 20) {
    code = (base + String(id).padStart(4, "0") + n).slice(0, 12);
  }
  return code;
}

export const Referrals = {
  ensureCode: (id, seed) => {
    const cur = get("SELECT referral_code FROM customers WHERE id=?", id);
    if (cur && cur.referral_code) return cur.referral_code;
    const code = _referralCodeFrom(id, seed);
    run("UPDATE customers SET referral_code=? WHERE id=?", code, id);
    return code;
  },
  findCustomerByCode: (code) => {
    const c = String(code || "").trim().toUpperCase();
    if (!c) return null;
    const cust = get("SELECT * FROM customers WHERE UPPER(referral_code)=?", c);
    if (cust) return cust;
    const u = get("SELECT id, username, referral_code FROM users WHERE UPPER(referral_code)=?", c);
    if (!u) return null;
    return Referrals.findCustomerForPanelUser(u.username);
  },
  ensureUserCode: (userId, seed) => {
    const cur = get("SELECT referral_code FROM users WHERE id=?", userId);
    if (cur && cur.referral_code) return cur.referral_code;
    const code = _referralCodeFrom(userId, seed || "U");
    run("UPDATE users SET referral_code=? WHERE id=?", code, userId);
    return code;
  },
  addPoints: (customerId, points, reason, refereeId) => {
    const pts = Math.round(Number(points) || 0);
    if (pts <= 0) return 0;
    run("UPDATE customers SET referral_points = COALESCE(referral_points,0) + ? WHERE id=?", pts, customerId);
    run("INSERT INTO referral_ledger (customer_id, referee_id, points, reason) VALUES (?,?,?,?)",
      customerId, refereeId || null, pts, reason || "");
    return Number(get("SELECT referral_points FROM customers WHERE id=?", customerId).referral_points) || 0;
  },
  redeemPoints: (customerId, points, reason) => {
    const cur = get("SELECT referral_points FROM customers WHERE id=?", customerId);
    const bal = Number(cur?.referral_points) || 0;
    const use = Math.min(bal, Math.round(Number(points) || 0));
    if (use <= 0) return { ok: false, error: "No points available", used: 0, remaining: bal };
    run("UPDATE customers SET referral_points = referral_points - ? WHERE id=?", use, customerId);
    run("INSERT INTO referral_ledger (customer_id, points, reason) VALUES (?,?,?)", customerId, -use, reason || "redeemed");
    return { ok: true, used: use, remaining: bal - use };
  },
  awardSignup: (referralCode, refereeId, joId, refereeName) => {
    const code = String(referralCode || "").trim();
    if (!code || !refereeId) return null;
    const referrer = Referrals.findCustomerByCode(code);
    if (!referrer || referrer.id === refereeId) return null;
    if (get("SELECT 1 FROM referral_ledger WHERE referee_id=? AND points>0 LIMIT 1", refereeId)) return null;
    run("UPDATE customers SET referred_by=? WHERE id=?", referrer.id, refereeId);
    const pts = Number(Settings.get("referral_signup_points", "100")) || 100;
    Referrals.addPoints(referrer.id, pts, `signup: JO#${joId} ${refereeName || ""}`.trim(), refereeId);
    return { referrerId: referrer.id, points: pts };
  },
  ledger: (id) => all("SELECT * FROM referral_ledger WHERE customer_id=? ORDER BY id DESC LIMIT 30", id),
  pointPeso: () => Math.max(0.01, Number(Settings.get("referral_point_peso", "1")) || 1),
  signupPoints: () => Math.max(0, Number(Settings.get("referral_signup_points", "100")) || 100),
  summary: () => {
    const s = get(`SELECT COUNT(*) customers, SUM(COALESCE(referral_points,0)) total_points,
      SUM(CASE WHEN COALESCE(referral_points,0)>0 THEN 1 ELSE 0 END) with_points FROM customers`);
    const earned = get("SELECT COALESCE(SUM(points),0) earned FROM referral_ledger WHERE points>0");
    const redeemed = get("SELECT COALESCE(SUM(ABS(points)),0) redeemed FROM referral_ledger WHERE points<0");
    const recent = all(
      `SELECT rl.id, rl.customer_id, rl.referee_id, rl.points, rl.reason, rl.created_at, c.name AS customer_name
       FROM referral_ledger rl JOIN customers c ON c.id = rl.customer_id ORDER BY rl.id DESC LIMIT 25`,
    );
    return {
      customers: s?.customers || 0,
      totalPoints: Number(s?.total_points) || 0,
      withPoints: Number(s?.with_points) || 0,
      earned: Number(earned?.earned) || 0,
      redeemed: Number(redeemed?.redeemed) || 0,
      signupPoints: Referrals.signupPoints(),
      pointPeso: Referrals.pointPeso(),
      recent,
    };
  },
  list: (search) => {
    const q = String(search || "").trim();
    let sql = `SELECT c.id, c.name, c.username, c.contact, c.referral_code, COALESCE(c.referral_points,0) referral_points,
      c.referred_by, rb.name AS referred_by_name
      FROM customers c LEFT JOIN customers rb ON rb.id = c.referred_by`;
    const args = [];
    if (q) {
      sql += ` WHERE c.name LIKE ? OR c.username LIKE ? OR c.contact LIKE ? OR UPPER(c.referral_code) LIKE ?`;
      const like = `%${q}%`;
      const codeLike = `%${q.toUpperCase()}%`;
      args.push(like, like, like, codeLike);
    }
    sql += " ORDER BY c.referral_points DESC, c.name ASC LIMIT 500";
    return all(sql, ...args);
  },
  setBalance: (customerId, balance, reason) => {
    const cur = get("SELECT referral_points, name FROM customers WHERE id=?", customerId);
    if (!cur) return null;
    const newBal = Math.max(0, Math.round(Number(balance) || 0));
    const old = Number(cur.referral_points) || 0;
    const delta = newBal - old;
    run("UPDATE customers SET referral_points=? WHERE id=?", newBal, customerId);
    if (delta !== 0) {
      run("INSERT INTO referral_ledger (customer_id, points, reason) VALUES (?,?,?)",
        customerId, delta, reason || `admin set balance → ${newBal}`);
    }
    return { id: customerId, name: cur.name, referral_points: newBal, delta };
  },
  adjust: (customerId, delta, reason) => {
    const d = Math.round(Number(delta) || 0);
    if (!d) throw new Error("Adjustment must not be zero.");
    const cur = get("SELECT referral_points, name FROM customers WHERE id=?", customerId);
    if (!cur) return null;
    if (d > 0) {
      const bal = Referrals.addPoints(customerId, d, reason || "admin adjustment");
      return { id: customerId, name: cur.name, referral_points: bal, delta: d };
    }
    const bal = Math.max(0, (Number(cur.referral_points) || 0) + d);
    run("UPDATE customers SET referral_points=? WHERE id=?", bal, customerId);
    run("INSERT INTO referral_ledger (customer_id, points, reason) VALUES (?,?,?)", customerId, d, reason || "admin adjustment");
    return { id: customerId, name: cur.name, referral_points: bal, delta: d };
  },
  findCustomerForPanelUser: (username) => {
    const u = String(username || "").trim();
    if (!u) return null;
    let c = get("SELECT * FROM customers WHERE LOWER(TRIM(username))=LOWER(?)", u);
    if (c) return c;
    c = get("SELECT * FROM customers WHERE LOWER(TRIM(account_code))=LOWER(?)", u);
    if (c) return c;
    const tech = get("SELECT name FROM techs WHERE active=1 AND LOWER(TRIM(name))=LOWER(?)", u);
    if (tech) {
      c = get("SELECT * FROM customers WHERE LOWER(TRIM(name))=LOWER(?)", tech.name);
      if (c) return c;
    }
    return get("SELECT * FROM customers WHERE LOWER(TRIM(name)) LIKE ? LIMIT 1", `%${u.toLowerCase()}%`);
  },
  meForPanelUser: (username) => {
    const u = String(username || "").trim();
    if (!u) return null;
    const c = Referrals.findCustomerForPanelUser(u);
    if (c) {
      const code = c.referral_code || Referrals.ensureCode(c.id, c.username || c.name);
      const pts = Number(c.referral_points) || 0;
      const peso = Referrals.pointPeso();
      return {
        linked: true,
        id: c.id,
        name: c.name,
        username: c.username || "",
        contact: c.contact || "",
        referral_code: code,
        referral_points: pts,
        point_peso: peso,
        peso_value: pts * peso,
        signup_points: Referrals.signupPoints(),
        ledger: Referrals.ledger(c.id),
      };
    }
    const acct = Accounts.getByName(u);
    if (!acct) return null;
    const code = Referrals.ensureUserCode(acct.id, acct.username);
    const peso = Referrals.pointPeso();
    return {
      linked: false,
      username: acct.username,
      referral_code: code,
      referral_points: 0,
      point_peso: peso,
      peso_value: 0,
      signup_points: Referrals.signupPoints(),
      ledger: [],
    };
  },
};

try {
  for (const row of db.prepare("SELECT id, name, username FROM customers WHERE referral_code IS NULL OR referral_code=''").all()) {
    Referrals.ensureCode(row.id, row.username || row.name);
  }
} catch {}
try {
  for (const row of db.prepare("SELECT id, username FROM users WHERE referral_code IS NULL OR referral_code=''").all()) {
    Referrals.ensureUserCode(row.id, row.username);
  }
} catch {}
try {
  if (!get("SELECT v FROM settings WHERE k='referral_signup_points'")) run("INSERT INTO settings (k,v) VALUES ('referral_signup_points','100')");
  if (!get("SELECT v FROM settings WHERE k='referral_point_peso'")) run("INSERT INTO settings (k,v) VALUES ('referral_point_peso','1')");
} catch {}

export const Accounts = {
  count: () => get("SELECT COUNT(*) c FROM users").c,
  list: () => all("SELECT id, username, role, scope, map_private, created_at, last_login FROM users ORDER BY username")
    .map((u) => ({ ...u, router_ids: Accounts.getSites(u.id), map_private: !!u.map_private })),
  getByName: (username) => get("SELECT * FROM users WHERE username=?", username),
  getById: (id) => get("SELECT id, username, role, created_at, last_login FROM users WHERE id=?", id),
  getByIdFull: (id) => {
    const u = get("SELECT id, username, role, scope, map_private, created_at, last_login FROM users WHERE id=?", id);
    if (!u) return null;
    return { ...u, router_ids: Accounts.getSites(id), map_private: !!u.map_private };
  },
  getSites: (userId) => all("SELECT router_id FROM user_sites WHERE user_id=? ORDER BY router_id", userId).map((r) => r.router_id),
  setSites: (userId, routerIds) => {
    run("DELETE FROM user_sites WHERE user_id=?", userId);
    for (const rid of (routerIds || []).map(Number).filter((n) => n > 0)) {
      run("INSERT OR IGNORE INTO user_sites (user_id, router_id) VALUES (?,?)", userId, rid);
    }
  },
  setScope: (userId, scope, mapPrivate) => {
    run("UPDATE users SET scope=?, map_private=? WHERE id=?", scope === "sites" ? "sites" : "all", mapPrivate ? 1 : 0, userId);
  },
  create: ({ username, salt, hash, role, scope, map_private, router_ids }) => {
    const r = run("INSERT INTO users (username,salt,hash,role,scope,map_private) VALUES (?,?,?,?,?,?)",
      username, salt, hash, role || "cashier", scope === "sites" ? "sites" : "all", map_private ? 1 : 0);
    const id = r.lastInsertRowid;
    if (scope === "sites" && router_ids && router_ids.length) Accounts.setSites(id, router_ids);
    return Accounts.getByIdFull(id);
  },
  setPassword: (id, salt, hash) => run("UPDATE users SET salt=?, hash=? WHERE id=?", salt, hash, id),
  setUsername: (id, username) => run("UPDATE users SET username=? WHERE id=?", username, id),
  setRole: (id, role) => run("UPDATE users SET role=? WHERE id=?", role, id),
  touchLogin: (id) => run("UPDATE users SET last_login=datetime('now') WHERE id=?", id),
  remove: (id) => { run("DELETE FROM user_sites WHERE user_id=?", id); run("DELETE FROM users WHERE id=?", id); },
};

export const Audit = {
  add: (e) =>
    run(
      "INSERT INTO audit (type,customer_id,customer_name,action,detail,ok) VALUES (?,?,?,?,?,?)",
      e.type || "auto", e.customer_id || null, e.customer_name || "",
      e.action || "", e.detail || "", e.ok === false ? 0 : 1
    ),
  list: (limit = 50) => all("SELECT * FROM audit ORDER BY id DESC LIMIT ?", Number(limit) || 50),
};

// ---- Data maintenance: stats + archive-then-clear for growing log tables ----
export const Maintenance = {
  // Tables that grow over time and are safe to archive/prune (logs, not core records).
  PRUNABLE: [
    { table: "audit", dateCol: "at", label: "Activity log" },
    { table: "sms_messages", dateCol: "at", label: "SMS messages" },
    { table: "usage_period", dateCol: "period", label: "Usage history", isPeriod: true },
    { table: "customer_sessions", dateCol: "expires", label: "Portal sessions" },
    { table: "coin_log_seen", dateCol: null, label: "Coin-log dedup markers" },
  ],
  // Core tables we never auto-clear (just report sizes).
  CORE: ["customers", "plans", "payments", "invoices", "inventory_items", "inventory_units", "inventory_moves", "installs", "job_orders", "expenses"],
  stats: () => {
    const rows = [];
    const countOf = (t) => { try { const r = get(`SELECT COUNT(*) n FROM ${t}`); return r ? r.n : 0; } catch { return 0; } };
    for (const p of Maintenance.PRUNABLE) rows.push({ table: p.table, label: p.label, rows: countOf(p.table), prunable: true });
    for (const t of Maintenance.CORE) rows.push({ table: t, label: t, rows: countOf(t), prunable: false });
    // DB file size if available
    let dbBytes = 0;
    try { const pc = get("PRAGMA page_count"); const ps = get("PRAGMA page_size"); dbBytes = (pc.page_count || 0) * (ps.page_size || 0); } catch {}
    return { tables: rows, dbBytes };
  },
  // Return rows older than cutoff (for archiving) for one prunable table.
  oldRows: (table, cutoffYmd) => {
    const def = Maintenance.PRUNABLE.find((p) => p.table === table);
    if (!def) return [];
    if (!def.dateCol) return all(`SELECT * FROM ${table}`); // no date -> all are archivable (dedup markers)
    if (def.isPeriod) return all(`SELECT * FROM ${table} WHERE ${def.dateCol} < ?`, cutoffYmd.slice(0, 7));
    return all(`SELECT * FROM ${table} WHERE ${def.dateCol} < ?`, cutoffYmd);
  },
  // Delete rows older than cutoff for one table. Returns rows removed.
  clearOld: (table, cutoffYmd) => {
    const def = Maintenance.PRUNABLE.find((p) => p.table === table);
    if (!def) return 0;
    let r;
    if (!def.dateCol) r = run(`DELETE FROM ${table}`);
    else if (def.isPeriod) r = run(`DELETE FROM ${table} WHERE ${def.dateCol} < ?`, cutoffYmd.slice(0, 7));
    else r = run(`DELETE FROM ${table} WHERE ${def.dateCol} < ?`, cutoffYmd);
    return r.changes || 0;
  },
  vacuum: () => { try { db.exec("VACUUM"); return true; } catch { return false; } },
};


// ---- Sales time series (daily / weekly / monthly / yearly) ---------------
function genLabels(range) {
  const out = [], now = new Date();
  if (range === "daily") {
    for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); out.push(d.toISOString().slice(0, 10)); }
  } else if (range === "weekly") {
    const d0 = new Date(now); const day = (d0.getDay() + 6) % 7; d0.setDate(d0.getDate() - day);
    for (let i = 11; i >= 0; i--) { const d = new Date(d0); d.setDate(d0.getDate() - i * 7); out.push(d.toISOString().slice(0, 10)); }
  } else if (range === "yearly") {
    const y = now.getFullYear(); for (let i = 5; i >= 0; i--) out.push(String(y - i));
  } else {
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(d.toISOString().slice(0, 7)); }
  }
  return out;
}

function seriesFrom(rows, range, field) {
  const keyOf = (s) => {
    const dt = s.slice(0, 10);
    if (range === "daily") return dt;
    if (range === "yearly") return s.slice(0, 4);
    if (range === "weekly") { const d = new Date(dt + "T00:00:00"); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d.toISOString().slice(0, 10); }
    return s.slice(0, 7);
  };
  const sums = {};
  for (const r of rows) { if (!r[field]) continue; const k = keyOf(r[field]); sums[k] = (sums[k] || 0) + Number(r.amount || 0); }
  const labels = genLabels(range);
  const series = labels.map((l) => ({ label: l, amount: sums[l] || 0 }));
  return { range, series, total: series.reduce((s, x) => s + x.amount, 0) };
}

export const Sales = {
  // Optional routerId = MikroTik site (customer.router_id). Omits unassigned customers when filtered.
  series: (range = "monthly", routerId = null) => {
    const rid = routerId != null && routerId !== "" ? Number(routerId) : null;
    if (rid == null || Number.isNaN(rid)) {
      return seriesFrom(all("SELECT paid_at, amount FROM payments WHERE paid_at IS NOT NULL"), range, "paid_at");
    }
    return seriesFrom(
      all(
        `SELECT pm.paid_at, pm.amount FROM payments pm
         INNER JOIN customers c ON c.id = pm.customer_id
         WHERE pm.paid_at IS NOT NULL AND c.router_id = ?`,
        rid
      ),
      range,
      "paid_at"
    );
  },
};

// ---- Hotspot events: login / logout / coin (from MikroTik webhooks) ------
export const HotspotEvents = {
  add: (e) =>
    run(
      "INSERT INTO hotspot_events (type,user,amount,mac,ip,detail,vendo,device) VALUES (?,?,?,?,?,?,?,?)",
      e.type || "", e.user || "", Number(e.amount) || 0, e.mac || "", e.ip || "", e.detail || "", e.vendo || "", e.device || ""
    ),
  recent: (limit = 40) => all("SELECT * FROM hotspot_events ORDER BY id DESC LIMIT ?", Number(limit) || 40),
};

// Per-vendo sales (matches the "Vendo | Client | Credit | Sold" view).
export const VendoSales = {
  // recent coin drops for one vendo (for anomaly detection)
  eventsForVendo: (vendo, limit = 200) =>
    all("SELECT at, amount FROM hotspot_events WHERE type='coin' AND vendo=? ORDER BY id DESC LIMIT ?", String(vendo || ""), Number(limit) || 200),
  summary: () => ({
    today: all("SELECT COALESCE(NULLIF(vendo,''),'(unknown)') vendo, COUNT(*) c, SUM(amount) s FROM hotspot_events WHERE type='coin' AND substr(at,1,10)=date('now') GROUP BY vendo ORDER BY s DESC"),
    month: all("SELECT COALESCE(NULLIF(vendo,''),'(unknown)') vendo, COUNT(*) c, SUM(amount) s FROM hotspot_events WHERE type='coin' AND substr(at,1,7)=strftime('%Y-%m','now') GROUP BY vendo ORDER BY s DESC"),
  }),
  recent: (limit = 80) =>
    all("SELECT at, COALESCE(NULLIF(vendo,''),'(unknown)') vendo, user, amount FROM hotspot_events WHERE type='coin' ORDER BY id DESC LIMIT ?", Number(limit) || 80),
};

// Recent hotspot logins enriched with the coin amount/vendo (matched by voucher).
export const NewUsers = {
  recent: (limit = 20) => {
    const logins = all("SELECT * FROM hotspot_events WHERE type='login' ORDER BY id DESC LIMIT ?", Number(limit) || 20);
    for (const l of logins) {
      const coin = get("SELECT amount, vendo FROM hotspot_events WHERE type='coin' AND user=? ORDER BY id DESC LIMIT 1", l.user || "");
      l.coin = coin ? coin.amount : 0;
      l.vendo = coin ? coin.vendo : "";
    }
    return logins;
  },
};

// Reset / clear sales data (kept separate so it's an explicit, audited action).
export const SalesAdmin = {
  stats: () => {
    const count = (sql, ...args) => { try { return get(sql, ...args).n || 0; } catch { return 0; } };
    const sum = (sql, ...args) => { try { return Number(get(sql, ...args).s || 0); } catch { return 0; } };
    return {
      payments: count("SELECT COUNT(*) n FROM payments"),
      paymentTotal: sum("SELECT COALESCE(SUM(amount),0) s FROM payments"),
      hardware: count("SELECT COUNT(*) n FROM hardware_sales"),
      hardwareTotal: sum("SELECT COALESCE(SUM(sell_price),0) s FROM hardware_sales"),
      proofs: count("SELECT COUNT(*) n FROM payment_proofs"),
      invoicesPaid: count("SELECT COUNT(*) n FROM invoices WHERE status='paid' OR COALESCE(paid_amount,0)>0"),
      hotspotEvents: count("SELECT COUNT(*) n FROM hotspot_events"),
    };
  },
  reset: (scope = "all") => {
    const deleted = {};
    const del = (sql, ...args) => { const r = run(sql, ...args); return r.changes || 0; };
    if (scope === "payments" || scope === "all") deleted.payments = del("DELETE FROM payments");
    if (scope === "hardware" || scope === "all") deleted.hardware_sales = del("DELETE FROM hardware_sales");
    if (scope === "proofs" || scope === "all") deleted.payment_proofs = del("DELETE FROM payment_proofs");
    if (scope === "coins" || scope === "all") {
      deleted.hotspot_events = del("DELETE FROM hotspot_events");
      deleted.coin_log_seen = del("DELETE FROM coin_log_seen");
    }
    if (scope === "all") {
      deleted.invoices_reset = del("UPDATE invoices SET status='unpaid', paid_amount=0, paid_at=NULL WHERE status='paid' OR COALESCE(paid_amount,0)>0");
    }
    return { scope, deleted };
  },
};

export const Coins = {
  // Today's coin-drop totals, broken down by denomination.
  today: () => {
    const rows = all(
      "SELECT amount, COUNT(*) c, SUM(amount) s FROM hotspot_events WHERE type='coin' AND substr(at,1,10)=date('now') GROUP BY amount"
    );
    const denom = { 1: 0, 5: 0, 10: 0, 20: 0, other: 0 };
    let count = 0, total = 0;
    for (const r of rows) {
      const a = Number(r.amount);
      if (denom[a] !== undefined) denom[a] += r.c; else denom.other += r.c;
      count += r.c; total += Number(r.s) || 0;
    }
    const monthTotal = get(
      "SELECT COALESCE(SUM(amount),0) s FROM hotspot_events WHERE type='coin' AND substr(at,1,7)=strftime('%Y-%m','now')"
    ).s;
    return { date: new Date().toISOString().slice(0, 10), denom, count, total, monthTotal };
  },
};

export const HotspotSales = {
  series: (range = "monthly") =>
    seriesFrom(all("SELECT at, amount FROM hotspot_events WHERE type='coin'"), range, "at"),
};

// ---- Coin-log ingestion dedupe -------------------------------------------
export const CoinLog = {
  // returns true if this signature is new (and records it), false if seen before
  markNew: (sig) => run("INSERT OR IGNORE INTO coin_log_seen (sig) VALUES (?)", sig).changes > 0,
};

// ---- Vendos (JuanFi NodeMCU registry) ------------------------------------
export const Vendos = {
  list: () => all("SELECT * FROM vendos ORDER BY name ASC"),
  get: (id) => get("SELECT * FROM vendos WHERE id=?", id),
  create: (v) => {
    const r = run(
      "INSERT INTO vendos (name,ip,port,username,password,apikey,enabled,router_id,mac,kind,online,last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      v.name, v.ip, Number(v.port) || 80, v.username || "", v.password || "", v.apikey || "", v.enabled === false ? 0 : 1,
      (v.router_id != null && v.router_id !== "") ? Number(v.router_id) : null,
      (v.mac || "").toUpperCase(), v.kind || "", v.online ? 1 : 0, v.online ? new Date().toISOString().slice(0, 19).replace("T", " ") : null
    );
    return Vendos.get(r.lastInsertRowid);
  },
  update: (id, v) => {
    const cur = Vendos.get(id);
    run("UPDATE vendos SET name=?,ip=?,port=?,username=?,password=?,apikey=?,enabled=?,router_id=?,mac=?,kind=? WHERE id=?",
      v.name, v.ip, Number(v.port) || 80, v.username || "", v.password || "", v.apikey || "", v.enabled === false ? 0 : 1,
      (v.router_id != null && v.router_id !== "") ? Number(v.router_id) : (cur ? cur.router_id : null),
      v.mac != null ? (v.mac || "").toUpperCase() : (cur ? cur.mac : ""), v.kind != null ? v.kind : (cur ? cur.kind : ""), id);
    return Vendos.get(id);
  },
  byRouter: (rid) => all("SELECT * FROM vendos WHERE router_id=? ORDER BY name ASC", rid),
  remove: (id) => run("DELETE FROM vendos WHERE id=?", id),
  setStatus: (id, online) => run("UPDATE vendos SET online=?, last_seen=datetime('now') WHERE id=?", online ? 1 : 0, id),
  saveSnapshot: (id, online, data) =>
    run("UPDATE vendos SET online=?, last_seen=datetime('now'), last_data=? WHERE id=?",
      online ? 1 : 0, typeof data === "string" ? data : JSON.stringify(data || {}), id),
};

// ---- Dashboard summary ---------------------------------------------------
export function summary(routerIds = null) {
  const period = currentPeriod();
  const ids = routerIds && routerIds.length ? routerIds.map(Number) : null;
  const custWhere = ids ? ` WHERE router_id IN (${ids.map(() => "?").join(",")})` : "";
  const custArgs = ids ? [...ids] : [];
  const payJoin = ids ? " INNER JOIN customers c ON c.id=pm.customer_id" : "";
  const payWhere = ids
    ? ` WHERE substr(pm.paid_at,1,7)=? AND c.router_id IN (${ids.map(() => "?").join(",")})`
    : " WHERE substr(pm.paid_at,1,7)=?";
  const payArgs = ids ? [period, ...ids] : [period];
  const invJoin = ids ? " INNER JOIN customers c ON c.id=i.customer_id" : "";
  const invWhere = ids
    ? ` WHERE i.status='unpaid' AND c.router_id IN (${ids.map(() => "?").join(",")})`
    : " WHERE status='unpaid'";
  const invArgs = ids ? [...ids] : [];
  const odJoin = ids ? " INNER JOIN customers c ON c.id=i.customer_id" : "";
  const odWhere = ids
    ? ` WHERE i.status='unpaid' AND i.due_date < date('now') AND c.router_id IN (${ids.map(() => "?").join(",")})`
    : " WHERE status='unpaid' AND due_date < date('now')";
  const odArgs = ids ? [...ids] : [];
  const totalCustomers = get(`SELECT COUNT(*) n FROM customers${custWhere}`, ...custArgs).n;
  const active = get(`SELECT COUNT(*) n FROM customers WHERE status='active'${ids ? ` AND router_id IN (${ids.map(() => "?").join(",")})` : ""}`, ...custArgs).n;
  const suspended = get(`SELECT COUNT(*) n FROM customers WHERE status='suspended'${ids ? ` AND router_id IN (${ids.map(() => "?").join(",")})` : ""}`, ...custArgs).n;
  const revenueMonth = get(
    `SELECT COALESCE(SUM(pm.amount),0) s FROM payments pm${payJoin}${payWhere}`, ...payArgs
  ).s;
  const outstanding = get(`SELECT COALESCE(SUM(i.amount),0) s FROM invoices i${invJoin}${invWhere}`, ...invArgs).s;
  const overdue = get(`SELECT COUNT(*) n FROM invoices i${odJoin}${odWhere}`, ...odArgs).n;
  return { period, totalCustomers, active, suspended, revenueMonth, outstanding, overdue, scoped: !!ids };
}

// ---- Backup / restore (portable JSON of the important tables) ------------
const BACKUP_TABLES = ["settings", "plans", "customers", "invoices", "payments", "users", "vendos", "tickets", "payment_proofs"];
export function kpis() {
  const s = summary();
  const ct = get("SELECT COALESCE(SUM(amount),0) v, COUNT(*) n FROM payments WHERE date(paid_at)=date('now')");
  const expiring7 = get("SELECT COUNT(*) n FROM customers WHERE status='active' AND expiry<>'' AND date(expiry) >= date('now') AND date(expiry) <= date('now','+7 day')").n;
  const planValue = get("SELECT COALESCE(SUM(p.price),0) v FROM customers c JOIN plans p ON p.id=c.plan_id WHERE c.status='active'").v;
  let pendingProofs = 0, openTickets = 0, openOutages = 0;
  try { pendingProofs = get("SELECT COUNT(*) n FROM payment_proofs WHERE status='pending'").n; } catch {}
  try { openTickets = get("SELECT COUNT(*) n FROM tickets WHERE status='open'").n; } catch {}
  try { openOutages = get("SELECT COUNT(*) n FROM outages WHERE status='open'").n; } catch {}
  return { ...s, collectedToday: ct.v, collectedTodayCount: ct.n, expiring7, planValue, pendingProofs, openTickets, openOutages };
}

db.exec(`CREATE TABLE IF NOT EXISTS naps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, area TEXT DEFAULT '', lat REAL, lng REAL, notes TEXT DEFAULT ''
)`);
ensureColumn("customers", "nap_id", "INTEGER");
ensureColumn("customers", "router_id", "INTEGER");   // which MikroTik serves this customer (multi-router)
ensureColumn("vendos", "router_id", "INTEGER");      // which router/site a JuanFi vendo belongs to
ensureColumn("vendos", "mac", "TEXT");               // NodeMCU MAC (for DHCP-lease monitoring)
ensureColumn("vendos", "kind", "TEXT");              // '' = JuanFi vendo, 'nodemcu' = ESP/WIZ board
ensureColumn("customers", "credit", "REAL DEFAULT 0");
ensureColumn("customers", "conn_type", "TEXT DEFAULT 'pppoe'");
ensureColumn("customers", "mac", "TEXT DEFAULT ''");
ensureColumn("customers", "static_ip", "TEXT DEFAULT ''");
ensureColumn("customers", "vlan_iface", "TEXT DEFAULT ''");
ensureColumn("customers", "account_code", "TEXT DEFAULT ''");
ensureColumn("customers", "referral_code", "TEXT DEFAULT ''");
ensureColumn("users", "referral_code", "TEXT DEFAULT ''");
ensureColumn("users", "scope", "TEXT DEFAULT 'all'");
ensureColumn("users", "map_private", "INTEGER DEFAULT 0");
db.exec(`CREATE TABLE IF NOT EXISTS user_sites (
  user_id INTEGER NOT NULL,
  router_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, router_id)
)`);
ensureColumn("customers", "referral_points", "INTEGER DEFAULT 0");
ensureColumn("customers", "referred_by", "INTEGER");
db.exec(`CREATE TABLE IF NOT EXISTS referral_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, referee_id INTEGER,
  points INTEGER NOT NULL, reason TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ---- Agents: partner accounts, points (1 pt = ₱1), monthly withdrawal on day 30 ----
db.exec(`CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  gcash TEXT DEFAULT '',
  agent_code TEXT UNIQUE NOT NULL,
  points INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS agent_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  points INTEGER NOT NULL,
  reason TEXT DEFAULT '',
  customer_id INTEGER,
  payment_id INTEGER,
  job_order_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS agent_withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  amount_peso REAL NOT NULL,
  points_used INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  gcash TEXT DEFAULT '',
  note TEXT DEFAULT '',
  admin_note TEXT DEFAULT '',
  requested_at TEXT DEFAULT (datetime('now','localtime')),
  reviewed_at TEXT DEFAULT '',
  reviewed_by TEXT DEFAULT ''
)`);
ensureColumn("customers", "agent_id", "INTEGER");

function _agentCodeFrom(id, seed) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "AG-" + String(seed || "A").replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase();
  while (code.length < 6) code += a[Math.floor(Math.random() * a.length)];
  let n = 0;
  while (get("SELECT id FROM agents WHERE UPPER(agent_code)=? AND id<>?", code.toUpperCase(), id || 0) && n++ < 30) {
    code = "AG-" + a[Math.floor(Math.random() * a.length)] + a[Math.floor(Math.random() * a.length)] + id + n;
  }
  return code.toUpperCase();
}

function _agentWithdrawDay() {
  return Math.max(1, Math.min(31, Number(Settings.get("agent_withdraw_day", "30")) || 30));
}

export const Agents = {
  pointPeso: () => Math.max(0.01, Number(Settings.get("agent_point_peso", "1")) || 1),
  minWithdrawPeso: () => Math.max(1, Number(Settings.get("agent_min_withdraw", "500")) || 500),
  signupPoints: () => Math.max(0, Number(Settings.get("agent_signup_points", "400")) || 400),
  paymentPointRate: () => Math.max(0, Number(Settings.get("agent_payment_point_rate", "1")) || 1),
  isWithdrawDay(d = new Date()) {
    const target = _agentWithdrawDay();
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const day = d.getDate();
    if (target > last) return day === last;
    return day === target;
  },
  nextWithdrawLabel(d = new Date()) {
    const target = _agentWithdrawDay();
    const y = d.getFullYear();
    const m = d.getMonth();
    const last = new Date(y, m + 1, 0).getDate();
    const day = target > last ? last : target;
    let nm = m;
    let ny = y;
    if (d.getDate() > day || (d.getDate() === day && !this.isWithdrawDay(d))) {
      nm = m + 1;
      if (nm > 11) { nm = 0; ny++; }
    }
    const last2 = new Date(ny, nm + 1, 0).getDate();
    const d2 = target > last2 ? last2 : target;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[nm]} ${d2}, ${ny}`;
  },
  connQualifies(connType) {
    const ct = String(connType || "pppoe").toLowerCase();
    return ct === "pppoe" || ct === "ipoe";
  },
  list: () => all(`SELECT a.*, u.username FROM agents a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.name`),
  get: (id) => get(`SELECT a.*, u.username FROM agents a LEFT JOIN users u ON u.id=a.user_id WHERE a.id=?`, id),
  getByUserId: (userId) => get(`SELECT a.*, u.username FROM agents a LEFT JOIN users u ON u.id=a.user_id WHERE a.user_id=?`, userId),
  getByCode: (code) => {
    const c = String(code || "").trim().toUpperCase();
    if (!c) return null;
    return get("SELECT * FROM agents WHERE UPPER(agent_code)=? AND enabled=1", c);
  },
  ensureCode: (id, seed) => {
    const cur = get("SELECT agent_code FROM agents WHERE id=?", id);
    if (cur && cur.agent_code) return cur.agent_code;
    const code = _agentCodeFrom(id, seed);
    run("UPDATE agents SET agent_code=? WHERE id=?", code, id);
    return code;
  },
  create: (a) => {
    const code = String(a.agent_code || "").trim().toUpperCase() || _agentCodeFrom(0, a.name || "AG");
    const r = run(
      "INSERT INTO agents (user_id,name,contact,gcash,agent_code,points,enabled) VALUES (?,?,?,?,?,?,?)",
      a.user_id || null, String(a.name || "Agent").trim(), String(a.contact || ""), String(a.gcash || ""),
      code, Math.max(0, Number(a.points) || 0), a.enabled === 0 ? 0 : 1
    );
    const ag = Agents.get(r.lastInsertRowid);
    if (ag && ag.user_id) {
      try { run("UPDATE users SET referral_code=? WHERE id=?", ag.agent_code, ag.user_id); } catch {}
    }
    return ag;
  },
  /** Create agent profile if user has role agent but no agents row yet. */
  ensureForUser: (userId, username) => {
    if (!userId) return null;
    const existing = Agents.getByUserId(userId);
    if (existing) return existing;
    const acct = Accounts.getById(userId);
    if (!acct || String(acct.role || "").toLowerCase() !== "agent") return null;
    const name = String(username || acct.username || "Agent").trim() || "Agent";
    return Agents.create({ user_id: userId, name, enabled: 1 });
  },
  update: (id, a) => {
    const cur = Agents.get(id);
    if (!cur) return null;
    run(
      "UPDATE agents SET name=?, contact=?, gcash=?, enabled=?, user_id=? WHERE id=?",
      a.name != null ? String(a.name).trim() : cur.name,
      a.contact != null ? String(a.contact) : cur.contact,
      a.gcash != null ? String(a.gcash) : cur.gcash,
      a.enabled != null ? (a.enabled ? 1 : 0) : cur.enabled,
      a.user_id != null ? (a.user_id || null) : cur.user_id,
      id
    );
    return Agents.get(id);
  },
  remove: (id) => run("DELETE FROM agents WHERE id=?", id),
  ledger: (agentId, limit = 50) => all("SELECT * FROM agent_ledger WHERE agent_id=? ORDER BY id DESC LIMIT ?", agentId, Number(limit) || 50),
  pendingWithdrawal: (agentId) => get("SELECT * FROM agent_withdrawals WHERE agent_id=? AND status='pending' ORDER BY id DESC LIMIT 1", agentId),
  withdrawals: (agentId, limit = 30) => all("SELECT * FROM agent_withdrawals WHERE agent_id=? ORDER BY id DESC LIMIT ?", agentId, Number(limit) || 30),
  allWithdrawals: (status) => {
    const st = String(status || "").trim();
    if (st) return all("SELECT w.*, a.name agent_name, a.agent_code FROM agent_withdrawals w JOIN agents a ON a.id=w.agent_id WHERE w.status=? ORDER BY w.id DESC LIMIT 200", st);
    return all("SELECT w.*, a.name agent_name, a.agent_code FROM agent_withdrawals w JOIN agents a ON a.id=w.agent_id ORDER BY w.id DESC LIMIT 200");
  },
  addPoints: (agentId, points, meta = {}) => {
    const pts = Math.round(Number(points) || 0);
    if (!pts) return null;
    const ag = Agents.get(agentId);
    if (!ag) return null;
    run("UPDATE agents SET points = COALESCE(points,0) + ? WHERE id=?", pts, agentId);
    run(
      "INSERT INTO agent_ledger (agent_id,points,reason,customer_id,payment_id,job_order_id) VALUES (?,?,?,?,?,?)",
      agentId, pts, meta.reason || "", meta.customer_id || null, meta.payment_id || null, meta.job_order_id || null
    );
    return { agent_id: agentId, points: Number(get("SELECT points FROM agents WHERE id=?", agentId).points) || 0, delta: pts };
  },
  adjust: (agentId, delta, reason) => {
    const d = Math.round(Number(delta) || 0);
    if (!d) return null;
    return Agents.addPoints(agentId, d, { reason: reason || "admin adjustment" });
  },
  setBalance: (agentId, balance, reason) => {
    const ag = Agents.get(agentId);
    if (!ag) return null;
    const newBal = Math.max(0, Math.round(Number(balance) || 0));
    const old = Number(ag.points) || 0;
    const d = newBal - old;
    run("UPDATE agents SET points=? WHERE id=?", newBal, agentId);
    if (d) run("INSERT INTO agent_ledger (agent_id,points,reason) VALUES (?,?,?)", agentId, d, reason || "admin set balance");
    return { agent_id: agentId, points: newBal, delta: d };
  },
  linkCustomer: (customerId, agentId) => {
    if (!customerId || !agentId) return;
    run("UPDATE customers SET agent_id=? WHERE id=?", agentId, customerId);
  },
  awardSignup: (agentCode, customerId, jobOrderId, connType) => {
    if (!Agents.connQualifies(connType)) return null;
    const ag = Agents.getByCode(agentCode);
    if (!ag) return null;
    if (jobOrderId && get("SELECT 1 FROM agent_ledger WHERE job_order_id=? AND points>0 LIMIT 1", jobOrderId)) return null;
    if (customerId) Agents.linkCustomer(customerId, ag.id);
    const pts = Agents.signupPoints();
    if (!pts) return { agentId: ag.id, points: 0 };
    const r = Agents.addPoints(ag.id, pts, { reason: `install JO#${jobOrderId || ""}`, customer_id: customerId || null, job_order_id: jobOrderId || null });
    return { agentId: ag.id, points: pts, balance: r?.points };
  },
  awardForPayment: (paymentRow) => {
    if (!paymentRow || !paymentRow.customer_id) return null;
    if (paymentRow.id && get("SELECT 1 FROM agent_ledger WHERE payment_id=? AND points>0 LIMIT 1", paymentRow.id)) return null;
    const c = Customers.get(paymentRow.customer_id);
    if (!c || !c.agent_id) return null;
    if (!Agents.connQualifies(c.conn_type)) return null;
    const amt = Number(paymentRow.amount) || 0;
    if (amt <= 0) return null;
    const rate = Agents.paymentPointRate();
    const pts = Math.floor(amt * rate);
    if (!pts) return null;
    return Agents.addPoints(c.agent_id, pts, {
      reason: `payment ₱${amt} (${c.conn_type || "pppoe"})`,
      customer_id: c.id,
      payment_id: paymentRow.id || null,
    });
  },
  meForUser: (userId) => {
    const ag = Agents.getByUserId(userId);
    if (!ag) return null;
    const peso = Agents.pointPeso();
    const pts = Number(ag.points) || 0;
    const pending = Agents.pendingWithdrawal(ag.id);
    const minP = Agents.minWithdrawPeso();
    const minPts = Math.ceil(minP / peso);
    return {
      ...ag,
      point_peso: peso,
      peso_value: pts * peso,
      min_withdraw_peso: minP,
      min_withdraw_points: minPts,
      can_withdraw: Agents.isWithdrawDay() && pts >= minPts && !pending,
      withdraw_day: _agentWithdrawDay(),
      next_withdraw: Agents.nextWithdrawLabel(),
      pending_withdrawal: pending || null,
      ledger: Agents.ledger(ag.id, 40),
      withdrawals: Agents.withdrawals(ag.id, 20),
      clients: all("SELECT id, name, username, conn_type, status FROM customers WHERE agent_id=? ORDER BY name LIMIT 200", ag.id),
    };
  },
  requestWithdrawal: (agentId, note) => {
    const ag = Agents.get(agentId);
    if (!ag || !ag.enabled) return { error: "Agent not found or disabled." };
    if (!Agents.isWithdrawDay()) return { error: `Withdrawal requests open on day ${_agentWithdrawDay()} of each month (next: ${Agents.nextWithdrawLabel()}).` };
    if (Agents.pendingWithdrawal(agentId)) return { error: "You already have a pending withdrawal request." };
    const peso = Agents.pointPeso();
    const pts = Number(ag.points) || 0;
    const minP = Agents.minWithdrawPeso();
    const minPts = Math.ceil(minP / peso);
    if (pts < minPts) return { error: `Minimum withdrawal is ₱${minP.toLocaleString()} (${minPts} pts). You have ${pts} pts.` };
    if (!String(ag.gcash || "").trim()) return { error: "Add your GCash number in your profile first." };
    const amountPeso = pts * peso;
    const r = run(
      "INSERT INTO agent_withdrawals (agent_id,amount_peso,points_used,status,gcash,note) VALUES (?,?,?,?,?,?)",
      agentId, amountPeso, pts, "pending", ag.gcash, String(note || "").trim()
    );
    return get("SELECT * FROM agent_withdrawals WHERE id=?", r.lastInsertRowid);
  },
  reviewWithdrawal: (id, status, adminUser, adminNote) => {
    const w = get("SELECT * FROM agent_withdrawals WHERE id=?", id);
    if (!w) return { error: "Withdrawal not found." };
    if (w.status !== "pending") return { error: "Already reviewed." };
    const st = String(status || "").toLowerCase();
    if (st === "approved" || st === "paid") {
      const ag = Agents.get(w.agent_id);
      const pts = Number(ag?.points) || 0;
      if (pts < Number(w.points_used)) return { error: "Agent no longer has enough points." };
      run("UPDATE agents SET points = points - ? WHERE id=?", Number(w.points_used), w.agent_id);
      run(
        "INSERT INTO agent_ledger (agent_id,points,reason) VALUES (?,?,?)",
        w.agent_id, -Number(w.points_used), `withdrawal #${id} approved`
      );
      run(
        "UPDATE agent_withdrawals SET status='paid', reviewed_at=datetime('now','localtime'), reviewed_by=?, admin_note=? WHERE id=?",
        adminUser || "", String(adminNote || "").trim(), id
      );
      return get("SELECT * FROM agent_withdrawals WHERE id=?", id);
    }
    if (st === "rejected") {
      run(
        "UPDATE agent_withdrawals SET status='rejected', reviewed_at=datetime('now','localtime'), reviewed_by=?, admin_note=? WHERE id=?",
        adminUser || "", String(adminNote || "").trim(), id
      );
      return get("SELECT * FROM agent_withdrawals WHERE id=?", id);
    }
    return { error: "Use approved or rejected." };
  },
  summary: () => {
    const s = get("SELECT COUNT(*) agents, SUM(COALESCE(points,0)) total_points FROM agents WHERE enabled=1");
    const pending = get("SELECT COUNT(*) c, COALESCE(SUM(amount_peso),0) s FROM agent_withdrawals WHERE status='pending'");
    return {
      agents: Number(s?.agents) || 0,
      total_points: Number(s?.total_points) || 0,
      pending_count: Number(pending?.c) || 0,
      pending_peso: Number(pending?.s) || 0,
      settings: {
        pointPeso: Agents.pointPeso(),
        minWithdraw: Agents.minWithdrawPeso(),
        withdrawDay: _agentWithdrawDay(),
        signupPoints: Agents.signupPoints(),
        paymentPointRate: Agents.paymentPointRate(),
      },
    };
  },
};

try {
  if (!get("SELECT v FROM settings WHERE k='agent_point_peso'")) run("INSERT INTO settings (k,v) VALUES ('agent_point_peso','1')");
  if (!get("SELECT v FROM settings WHERE k='agent_min_withdraw'")) run("INSERT INTO settings (k,v) VALUES ('agent_min_withdraw','500')");
  if (!get("SELECT v FROM settings WHERE k='agent_withdraw_day'")) run("INSERT INTO settings (k,v) VALUES ('agent_withdraw_day','30')");
  if (!get("SELECT v FROM settings WHERE k='agent_signup_points'")) run("INSERT INTO settings (k,v) VALUES ('agent_signup_points','400')");
  else {
    const cur = get("SELECT v FROM settings WHERE k='agent_signup_points'");
    if (cur && String(cur.v) === "100") run("UPDATE settings SET v='400' WHERE k='agent_signup_points'");
  }
  if (!get("SELECT v FROM settings WHERE k='agent_payment_point_rate'")) run("INSERT INTO settings (k,v) VALUES ('agent_payment_point_rate','1')");
} catch {}
try {
  const orphanAgents = db.prepare(
    "SELECT id, username FROM users WHERE LOWER(role)='agent' AND id NOT IN (SELECT user_id FROM agents WHERE user_id IS NOT NULL)"
  ).all();
  for (const u of orphanAgents) Agents.ensureForUser(u.id, u.username);
} catch {}
try {
  const need = db.prepare("SELECT id, conn_type FROM customers WHERE account_code IS NULL OR account_code=''").all();
  const mkcode = (ct) => { const p = ct === "ipoe" ? "IPOE" : ct === "hotspot" ? "HS" : "PPPOE"; const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 12; i++) s += a[Math.floor(Math.random() * a.length)]; return p + "-" + s; };
  for (const row of need) db.prepare("UPDATE customers SET account_code=? WHERE id=?").run(mkcode(row.conn_type || "pppoe"), row.id);
} catch {}
ensureColumn("invoices", "paid_amount", "REAL DEFAULT 0");
ensureColumn("payment_proofs", "flags", "TEXT DEFAULT ''");
try { db.exec("UPDATE invoices SET paid_amount=amount WHERE status='paid' AND (paid_amount IS NULL OR paid_amount=0)"); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL,
  amount REAL NOT NULL, reason TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ---- Routers / Sites: multiple MikroTik devices (each reachable over VPN via RouterOS API) ----
db.exec(`CREATE TABLE IF NOT EXISTS routers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                 -- friendly name, e.g. "Main Site" / "Branch 2"
  host TEXT DEFAULT '',               -- VPN-reachable IP or hostname of the router
  port INTEGER DEFAULT 0,             -- API port (0 = auto: 8729 if ssl else 8728)
  username TEXT DEFAULT '',           -- RouterOS API user
  password TEXT DEFAULT '',           -- RouterOS API password
  ssl INTEGER DEFAULT 0,              -- 1 = api-ssl (8729), 0 = plain api (8728)
  area TEXT DEFAULT '',               -- location / area label
  vpn_notes TEXT DEFAULT '',          -- how this router is reached (VPN peer, etc.)
  enabled INTEGER DEFAULT 1,          -- 0 = paused (no commands sent)
  is_default INTEGER DEFAULT 0,       -- the fallback router for unassigned customers
  last_seen TEXT DEFAULT '',          -- last successful connection
  last_status TEXT DEFAULT '',        -- 'ok' | 'fail: ...' from the last test
  created_at TEXT DEFAULT (datetime('now'))
)`);

export const Routers = {
  list: () => all(`SELECT r.*,
      (SELECT COUNT(*) FROM customers c WHERE c.router_id=r.id) AS clients,
      (SELECT COUNT(*) FROM customers c WHERE c.router_id=r.id AND (c.status='suspended' OR c.auto_suspended=1)) AS suspended
    FROM routers r ORDER BY r.is_default DESC, r.name`),
  get: (id) => get("SELECT * FROM routers WHERE id=?", id),
  getDefault: () => get("SELECT * FROM routers WHERE is_default=1 LIMIT 1") || get("SELECT * FROM routers ORDER BY id LIMIT 1"),
  create: (r) => {
    const willDefault = (r.is_default ? 1 : 0) || (get("SELECT COUNT(*) n FROM routers").n === 0 ? 1 : 0);
    if (willDefault) run("UPDATE routers SET is_default=0");
    const res = run("INSERT INTO routers (name,host,port,username,password,ssl,area,vpn_notes,enabled,is_default) VALUES (?,?,?,?,?,?,?,?,?,?)",
      String(r.name || "Router").trim(), String(r.host || "").trim(), Number(r.port) || 0,
      String(r.username || "").trim(), String(r.password || ""), r.ssl ? 1 : 0,
      String(r.area || ""), String(r.vpn_notes || ""), r.enabled === 0 ? 0 : 1, willDefault ? 1 : 0);
    return get("SELECT * FROM routers WHERE id=?", res.lastInsertRowid);
  },
  update: (id, r) => {
    const cur = get("SELECT * FROM routers WHERE id=?", id);
    if (!cur) throw new Error("Router not found");
    if (r.is_default) run("UPDATE routers SET is_default=0");
    run(`UPDATE routers SET name=?, host=?, port=?, username=?, password=?, ssl=?, area=?, vpn_notes=?, enabled=?, is_default=? WHERE id=?`,
      r.name != null && String(r.name).trim() !== "" ? String(r.name).trim() : cur.name,
      r.host != null ? String(r.host).trim() : cur.host,
      r.port != null && r.port !== "" ? Number(r.port) : cur.port,
      r.username != null ? String(r.username).trim() : cur.username,
      // keep existing password if a blank one is sent (so editing doesn't wipe it)
      (r.password != null && String(r.password) !== "") ? String(r.password) : cur.password,
      r.ssl != null ? (r.ssl ? 1 : 0) : cur.ssl,
      r.area != null ? String(r.area) : cur.area,
      r.vpn_notes != null ? String(r.vpn_notes) : cur.vpn_notes,
      r.enabled != null ? (r.enabled ? 1 : 0) : cur.enabled,
      r.is_default != null ? (r.is_default ? 1 : 0) : cur.is_default,
      id);
    return get("SELECT * FROM routers WHERE id=?", id);
  },
  setStatus: (id, status) => { try { run("UPDATE routers SET last_status=?, last_seen=CASE WHEN ? LIKE 'ok%' THEN datetime('now') ELSE last_seen END WHERE id=?", String(status || ""), String(status || ""), id); } catch {} },
  remove: (id) => {
    const cur = get("SELECT * FROM routers WHERE id=?", id);
    run("UPDATE customers SET router_id=NULL WHERE router_id=?", id);
    const res = run("DELETE FROM routers WHERE id=?", id);
    // if we deleted the default, promote another
    if (cur && cur.is_default) { const nxt = get("SELECT id FROM routers ORDER BY id LIMIT 1"); if (nxt) run("UPDATE routers SET is_default=1 WHERE id=?", nxt.id); }
    return res;
  },
};

export const Naps = {
  list: () => all(`SELECT n.*, 
      (SELECT COUNT(*) FROM customers c WHERE c.nap_id=n.id) AS clients,
      (SELECT COUNT(*) FROM customers c WHERE c.nap_id=n.id AND c.status='suspended') AS suspended
    FROM naps n ORDER BY n.name`),
  create: (n) => { const r = run("INSERT INTO naps (name,area,lat,lng,notes) VALUES (?,?,?,?,?)", n.name, n.area || "", n.lat != null && n.lat !== "" ? Number(n.lat) : null, n.lng != null && n.lng !== "" ? Number(n.lng) : null, n.notes || ""); return get("SELECT * FROM naps WHERE id=?", r.lastInsertRowid); },
  update: (id, n) => {
    const cur = get("SELECT * FROM naps WHERE id=?", id);
    if (!cur) throw new Error("Tower not found");
    run("UPDATE naps SET name=?, area=?, lat=?, lng=?, notes=? WHERE id=?",
      n.name != null && String(n.name).trim() !== "" ? String(n.name).trim() : cur.name,
      n.area != null ? n.area : cur.area,
      n.lat != null && n.lat !== "" ? Number(n.lat) : (n.lat === "" ? null : cur.lat),
      n.lng != null && n.lng !== "" ? Number(n.lng) : (n.lng === "" ? null : cur.lng),
      n.notes != null ? n.notes : cur.notes, id);
    return get("SELECT * FROM naps WHERE id=?", id);
  },
  remove: (id) => {
    run("UPDATE customers SET nap_id=NULL WHERE nap_id=?", id);
    run("DELETE FROM fiber_lines WHERE (from_kind='nap' AND from_id=?) OR (to_kind='nap' AND to_id=?)", id, id);
    return run("DELETE FROM naps WHERE id=?", id);
  },
};

db.exec(`CREATE TABLE IF NOT EXISTS olts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, area TEXT DEFAULT '', lat REAL, lng REAL, notes TEXT DEFAULT ''
)`);

export const Olts = {
  list: () => all(`SELECT o.*,
      (SELECT COUNT(*) FROM fiber_lines f WHERE f.from_kind='olt' AND f.from_id=o.id) AS feeds
    FROM olts o ORDER BY o.name`),
  create: (o) => {
    const r = run("INSERT INTO olts (name,area,lat,lng,notes) VALUES (?,?,?,?,?)",
      o.name, o.area || "", o.lat != null && o.lat !== "" ? Number(o.lat) : null, o.lng != null && o.lng !== "" ? Number(o.lng) : null, o.notes || "");
    return get("SELECT * FROM olts WHERE id=?", r.lastInsertRowid);
  },
  update: (id, o) => {
    const cur = get("SELECT * FROM olts WHERE id=?", id);
    if (!cur) throw new Error("OLT not found");
    run("UPDATE olts SET name=?, area=?, lat=?, lng=?, notes=? WHERE id=?",
      o.name != null && String(o.name).trim() !== "" ? String(o.name).trim() : cur.name,
      o.area != null ? o.area : cur.area,
      o.lat != null && o.lat !== "" ? Number(o.lat) : (o.lat === "" ? null : cur.lat),
      o.lng != null && o.lng !== "" ? Number(o.lng) : (o.lng === "" ? null : cur.lng),
      o.notes != null ? o.notes : cur.notes, id);
    return get("SELECT * FROM olts WHERE id=?", id);
  },
  remove: (id) => {
    run("DELETE FROM fiber_lines WHERE from_kind='olt' AND from_id=?", id);
    return run("DELETE FROM olts WHERE id=?", id);
  },
};

db.exec(`CREATE TABLE IF NOT EXISTS fiber_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_type TEXT NOT NULL DEFAULT 'nap_nap',
  from_kind TEXT NOT NULL,
  from_id INTEGER NOT NULL,
  to_kind TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

ensureColumn("fiber_lines", "color", "TEXT DEFAULT ''");
ensureColumn("fiber_lines", "path_json", "TEXT DEFAULT ''");
ensureColumn("fiber_lines", "reversed", "INTEGER DEFAULT 0");

function parseFiberPath(raw) {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((pt) => Array.isArray(pt) && pt.length >= 2) : [];
  } catch {
    return [];
  }
}

function enrichFiberLine(row) {
  if (!row) return row;
  return { ...row, path: parseFiberPath(row.path_json), reversed: !!row.reversed };
}

export const FiberLines = {
  list: () => all("SELECT * FROM fiber_lines ORDER BY id").map(enrichFiberLine),
  get: (id) => enrichFiberLine(get("SELECT * FROM fiber_lines WHERE id=?", id)),
  create: (f) => {
    const lt = f.line_type || "nap_nap";
    const pathJson = f.path ? JSON.stringify(f.path) : (f.path_json || "");
    const color = String(f.color || "").trim();
    if (lt === "manual") {
      const path = f.path ? f.path : parseFiberPath(pathJson);
      if (!Array.isArray(path) || path.length < 2) throw new Error("Manual line needs at least 2 map points.");
      const r = run(
        "INSERT INTO fiber_lines (line_type,from_kind,from_id,to_kind,to_id,notes,color,path_json,reversed) VALUES (?,?,?,?,?,?,?,?,?)",
        "manual", "manual", 0, "manual", 0, f.notes || "", color, JSON.stringify(path), 0
      );
      return FiberLines.get(r.lastInsertRowid);
    }
    const r = run(
      "INSERT INTO fiber_lines (line_type,from_kind,from_id,to_kind,to_id,notes,color,path_json,reversed) VALUES (?,?,?,?,?,?,?,?,?)",
      lt, f.from_kind, Number(f.from_id), f.to_kind, Number(f.to_id), f.notes || "", color, "", 0
    );
    return FiberLines.get(r.lastInsertRowid);
  },
  update: (id, patch) => {
    const f = get("SELECT * FROM fiber_lines WHERE id=?", id);
    if (!f) return null;
    if (patch.color != null) run("UPDATE fiber_lines SET color=? WHERE id=?", String(patch.color).trim(), id);
    if (patch.notes != null) run("UPDATE fiber_lines SET notes=? WHERE id=?", String(patch.notes), id);
    return FiberLines.get(id);
  },
  reverse: (id) => {
    const f = get("SELECT * FROM fiber_lines WHERE id=?", id);
    if (!f) return null;
    if (f.line_type === "manual") {
      const path = parseFiberPath(f.path_json);
      if (path.length >= 2) run("UPDATE fiber_lines SET path_json=? WHERE id=?", JSON.stringify([...path].reverse()), id);
    } else if (f.line_type === "nap_nap") {
      run("UPDATE fiber_lines SET from_id=?, to_id=? WHERE id=?", f.to_id, f.from_id, id);
    } else {
      run("UPDATE fiber_lines SET reversed = 1 - COALESCE(reversed,0) WHERE id=?", id);
    }
    return FiberLines.get(id);
  },
  remove: (id) => run("DELETE FROM fiber_lines WHERE id=?", id),
};

db.exec(`CREATE TABLE IF NOT EXISTS outages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  scope_type TEXT DEFAULT 'all',      -- 'nap' | 'area' | 'all'
  scope_value TEXT DEFAULT '',        -- nap id or area name
  status TEXT DEFAULT 'open',         -- 'open' | 'resolved'
  started_at TEXT DEFAULT (datetime('now','localtime')),
  resolved_at TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  notified INTEGER DEFAULT 0
)`);

db.exec(`CREATE TABLE IF NOT EXISTS customer_sessions (
  token TEXT PRIMARY KEY, customer_id INTEGER NOT NULL, expires TEXT NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS client_status (
  username TEXT PRIMARY KEY, online INTEGER DEFAULT 0,
  last_seen TEXT DEFAULT '', last_change TEXT DEFAULT ''
)`);

export const ClientStatus = {
  map: () => { const m = new Map(); for (const r of all("SELECT * FROM client_status")) m.set(r.username, !!r.online); return m; },
  all: () => all("SELECT * FROM client_status"),
  apply: (changes, onlineSet, now) => {
    for (const ch of changes) {
      run(`INSERT INTO client_status (username,online,last_seen,last_change) VALUES (?,?,?,?)
           ON CONFLICT(username) DO UPDATE SET online=?, last_change=?`,
        ch.username, ch.online ? 1 : 0, ch.online ? now : "", now, ch.online ? 1 : 0, now);
    }
    // refresh last_seen for everyone currently online
    for (const u of onlineSet) run("UPDATE client_status SET last_seen=? WHERE username=?", now, u);
  },
};

db.exec(`CREATE TABLE IF NOT EXISTS sms_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT DEFAULT 'in',
  number TEXT DEFAULT '',
  name TEXT DEFAULT '',
  body TEXT DEFAULT '',
  gcash INTEGER DEFAULT 0,
  amount REAL DEFAULT 0,
  reference TEXT DEFAULT '',
  status TEXT DEFAULT '',
  read INTEGER DEFAULT 0,
  at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ---- Inventory: stock items + movements (in/out/consume/return) ----
db.exec(`CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  unit TEXT DEFAULT 'pcs',
  qty REAL DEFAULT 0,
  reorder_level REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS inventory_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER,
  type TEXT DEFAULT 'in',         -- in | out | consume | return | adjust
  qty REAL DEFAULT 0,             -- positive number; sign applied by type
  customer_id INTEGER,            -- optional: install/job this was used on
  install_id INTEGER,             -- optional: install job id
  tech TEXT DEFAULT '',           -- optional: technician who took/used it
  note TEXT DEFAULT '',
  at TEXT DEFAULT (datetime('now','localtime'))
)`);

// Serialized units: individual physical items (routers/ONUs) tracked by serial + MAC.
db.exec(`CREATE TABLE IF NOT EXISTS inventory_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER,                 -- which item type (e.g. "Wireless Router")
  serial TEXT DEFAULT '',
  mac TEXT DEFAULT '',
  status TEXT DEFAULT 'in_stock',  -- in_stock | assigned | installed | returned | defective
  tech TEXT DEFAULT '',            -- technician currently holding it (if assigned)
  customer_id INTEGER,             -- client it's installed at (if installed)
  install_id INTEGER,              -- the install job it belongs to
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
// Per-unit lifecycle events (trace a router's history: stocked, assigned, installed,
// pulled out, marked defective, returned, replaced).
db.exec(`CREATE TABLE IF NOT EXISTS unit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER,
  event TEXT DEFAULT '',           -- stocked | assigned | installed | pulled_out | defective | returned | replaced_by | replaces
  from_status TEXT DEFAULT '',
  to_status TEXT DEFAULT '',
  customer_id INTEGER,
  tech TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  at TEXT DEFAULT (datetime('now','localtime'))
)`);
// Install jobs: bundle client + tech + materials/units + client sign-off.
db.exec(`CREATE TABLE IF NOT EXISTS installs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  tech TEXT DEFAULT '',
  status TEXT DEFAULT 'open',      -- open | completed
  approval_type TEXT DEFAULT '',   -- signature | typed | photo
  approved_by TEXT DEFAULT '',     -- client name who confirmed
  approval_data TEXT DEFAULT '',   -- signature dataURL / photo dataURL / typed text
  approved_at TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// Install applications / job orders (public apply -> admin pipeline).
db.exec(`CREATE TABLE IF NOT EXISTS job_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  area TEXT DEFAULT '',
  lat REAL, lng REAL,
  plan_id INTEGER,
  conn_type TEXT DEFAULT 'pppoe',
  notes TEXT DEFAULT '',
  install_fee REAL DEFAULT 0,
  router_cost REAL DEFAULT 0,
  pay_choice TEXT DEFAULT 'on_install',
  pay_status TEXT DEFAULT 'unpaid',
  pay_reference TEXT DEFAULT '',
  pay_proof TEXT DEFAULT '',
  agreed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'applied',
  tech TEXT DEFAULT '',
  customer_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
ensureColumn("job_orders", "referral_code", "TEXT DEFAULT ''");
ensureColumn("job_orders", "install_id", "INTEGER");
ensureColumn("job_orders", "reject_reason", "TEXT DEFAULT ''");
ensureColumn("job_orders", "facebook", "TEXT DEFAULT ''");
ensureColumn("job_orders", "last_name", "TEXT DEFAULT ''");
ensureColumn("job_orders", "username", "TEXT DEFAULT ''");
ensureColumn("job_orders", "password", "TEXT DEFAULT ''");
ensureColumn("job_orders", "source", "TEXT DEFAULT 'apply'");
ensureColumn("job_orders", "job_type", "TEXT DEFAULT 'new_install'");
ensureColumn("job_orders", "scheduled_date", "TEXT DEFAULT ''");
ensureColumn("job_orders", "street_sitio", "TEXT DEFAULT ''");
ensureColumn("job_orders", "address_line2", "TEXT DEFAULT ''");
ensureColumn("job_orders", "address_line3", "TEXT DEFAULT ''");
ensureColumn("job_orders", "address_line4", "TEXT DEFAULT ''");
ensureColumn("job_orders", "address_line5", "TEXT DEFAULT ''");
ensureColumn("job_orders", "full_address", "TEXT DEFAULT ''");
ensureColumn("job_orders", "marking_order", "TEXT DEFAULT ''");
ensureColumn("job_orders", "marking_completed", "TEXT DEFAULT ''");
ensureColumn("job_orders", "marking_repair", "TEXT DEFAULT ''");

// Multiple technicians per job order (lead, helper, installer).
db.exec(`CREATE TABLE IF NOT EXISTS job_order_techs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_order_id INTEGER NOT NULL,
  staff_id INTEGER,
  tech_name TEXT NOT NULL,
  role TEXT DEFAULT 'lead',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(job_order_id, tech_name)
)`);
ensureColumn("job_order_techs", "staff_id", "INTEGER");

db.exec(`CREATE TABLE IF NOT EXISTS job_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_order_id INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  job_type TEXT NOT NULL DEFAULT 'residential_install',
  vendo_name TEXT DEFAULT '',
  plan_id INTEGER,
  router_cost REAL DEFAULT 0,
  install_fee REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  marking TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
try {
  const legacy = all("SELECT id, tech FROM job_orders WHERE COALESCE(tech,'')<>''");
  for (const row of legacy) {
    run("INSERT OR IGNORE INTO job_order_techs (job_order_id, tech_name, role) VALUES (?,?,?)", row.id, row.tech, "lead");
  }
} catch {}

ensureColumn("inventory_items", "serialized", "INTEGER DEFAULT 0");
ensureColumn("inventory_items", "sell_price", "REAL DEFAULT 0");

// Business expenses (utilities, fuel, vehicle, salary, etc.) for profit tracking.
db.exec(`CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT DEFAULT 'misc',
  description TEXT DEFAULT '',
  amount REAL DEFAULT 0,
  vendor TEXT DEFAULT '',
  paid_by TEXT DEFAULT '',
  spent_at TEXT DEFAULT (date('now','localtime')),
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
ensureColumn("expenses", "router_id", "INTEGER");    // which site/router an expense belongs to (optional)

// Hardware sales: router/equipment sold to clients, with cost vs sell price for margin.
db.exec(`CREATE TABLE IF NOT EXISTS hardware_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  item_id INTEGER,
  unit_id INTEGER,
  item_name TEXT DEFAULT '',
  cost REAL DEFAULT 0,
  sell_price REAL DEFAULT 0,
  margin REAL DEFAULT 0,
  method TEXT DEFAULT 'cash',
  payment_id INTEGER,
  expense_id INTEGER,
  note TEXT DEFAULT '',
  sold_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// Technical team: the field crew, their rank, availability, and areas they cover.
db.exec(`CREATE TABLE IF NOT EXISTS techs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rank TEXT DEFAULT 'Technician',
  phone TEXT DEFAULT '',
  status TEXT DEFAULT 'available',     -- available | on_job | off_duty
  areas TEXT DEFAULT '',               -- comma-separated areas/barangays they cover
  active INTEGER DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

export const Sms = {
  add: (m) => { const r = run("INSERT INTO sms_messages (direction,number,name,body,gcash,amount,reference,status,read) VALUES (?,?,?,?,?,?,?,?,?)",
      m.direction || "in", m.number || "", m.name || "", m.body || "", m.gcash ? 1 : 0, m.amount || 0, m.reference || "", m.status || "", m.read ? 1 : 0);
    return get("SELECT * FROM sms_messages WHERE id=?", r.lastInsertRowid); },
  list: (limit = 100) => all("SELECT * FROM sms_messages ORDER BY id DESC LIMIT ?", Number(limit) || 100),
  gcashList: (limit = 50) => all("SELECT * FROM sms_messages WHERE gcash=1 ORDER BY id DESC LIMIT ?", Number(limit) || 50),
  byNumber: (number, limit = 50) => all("SELECT * FROM sms_messages WHERE number=? ORDER BY id ASC LIMIT ?", String(number || ""), Number(limit) || 50),
  unread: () => get("SELECT COUNT(*) c FROM sms_messages WHERE direction='in' AND read=0").c,
  markRead: (number) => run("UPDATE sms_messages SET read=1 WHERE number=? AND direction='in'", String(number || "")),
  refExists: (ref) => !!(ref && get("SELECT 1 FROM sms_messages WHERE reference=? AND gcash=1 LIMIT 1", String(ref))),
  // Find a received GCash/Maya payment text matching a reference (preferred) or exact amount.
  findPayment: (reference, amount) => {
    const ref = String(reference || "").replace(/\s+/g, "");
    if (ref) { const r = get("SELECT * FROM sms_messages WHERE direction='in' AND gcash=1 AND replace(reference,' ','')=? ORDER BY id DESC LIMIT 1", ref); if (r) return r; }
    if (amount > 0) { const r = get("SELECT * FROM sms_messages WHERE direction='in' AND gcash=1 AND ABS(amount-?)<0.01 ORDER BY id DESC LIMIT 1", Number(amount)); if (r) return r; }
    return null;
  },
};

export const Inventory = {
  items: () => all("SELECT * FROM inventory_items ORDER BY category, name"),
  item: (id) => get("SELECT * FROM inventory_items WHERE id=?", id),
  addItem: (i) => {
    // For serialized items (routers/ONUs) the on-hand count is driven ENTIRELY by the
    // individual units you add (each unit = qty+1). So ignore any manual opening qty here,
    // otherwise adding the item with qty=1 and then adding 1 unit would double to 2.
    const openingQty = i.serialized ? 0 : (Number(i.qty) || 0);
    const r = run("INSERT INTO inventory_items (name,category,unit,qty,reorder_level,cost,sell_price,notes,serialized) VALUES (?,?,?,?,?,?,?,?,?)",
      i.name, i.category || "", i.unit || "pcs", openingQty, Number(i.reorder_level) || 0, Number(i.cost) || 0, Number(i.sell_price) || 0, i.notes || "", i.serialized ? 1 : 0);
    const item = Inventory.item(r.lastInsertRowid);
    if (openingQty > 0) run("INSERT INTO inventory_moves (item_id,type,qty,note) VALUES (?,?,?,?)", item.id, "in", openingQty, "opening stock");
    return item;
  },
  updateItem: (id, i) => {
    run("UPDATE inventory_items SET name=?,category=?,unit=?,reorder_level=?,cost=?,sell_price=?,notes=?,serialized=? WHERE id=?",
      i.name, i.category || "", i.unit || "pcs", Number(i.reorder_level) || 0, Number(i.cost) || 0, Number(i.sell_price) || 0, i.notes || "", i.serialized ? 1 : 0, id);
    return Inventory.item(id);
  },
  removeItem: (id) => { run("DELETE FROM inventory_moves WHERE item_id=?", id); return run("DELETE FROM inventory_items WHERE id=?", id); },
  // Record a movement row WITHOUT adjusting qty (used when qty was already changed elsewhere,
  // e.g. a serialized unit released/returned via setUnit, which adjusts the parent item qty).
  logMove: (m) => {
    if (!m.item_id) return;
    run("INSERT INTO inventory_moves (item_id,type,qty,customer_id,install_id,tech,note) VALUES (?,?,?,?,?,?,?)",
      m.item_id, m.type || "out", Math.abs(Number(m.qty) || 1), m.customer_id || null, m.install_id || null, m.tech || "", m.note || "");
  },
  // Record a movement and adjust qty. type: in|out|consume|return|adjust
  move: (m) => {
    const item = Inventory.item(m.item_id);
    if (!item) throw new Error("Item not found");
    const q = Math.abs(Number(m.qty) || 0);
    if (q <= 0 && m.type !== "adjust") throw new Error("Quantity must be greater than zero");
    let delta = 0;
    if (m.type === "in" || m.type === "return") delta = q;
    else if (m.type === "out" || m.type === "consume") delta = -q;
    else if (m.type === "adjust") delta = Number(m.qty) || 0; // signed for adjust
    const newQty = Number(item.qty) + delta;
    if (newQty < 0) throw new Error(`Not enough stock: ${item.name} has ${item.qty} ${item.unit}, tried to remove ${q}.`);
    run("UPDATE inventory_items SET qty=? WHERE id=?", newQty, item.id);
    run("INSERT INTO inventory_moves (item_id,type,qty,customer_id,install_id,tech,note) VALUES (?,?,?,?,?,?,?)",
      item.id, m.type, m.type === "adjust" ? (Number(m.qty) || 0) : q, m.customer_id || null, m.install_id || null, m.tech || "", m.note || "");
    return Inventory.item(item.id);
  },
  moves: (limit = 200) => all(
    `SELECT mv.*, it.name AS item_name, it.unit AS unit, c.name AS customer_name
     FROM inventory_moves mv LEFT JOIN inventory_items it ON it.id=mv.item_id
     LEFT JOIN customers c ON c.id=mv.customer_id
     ORDER BY mv.id DESC LIMIT ?`, Number(limit) || 200),
  movesForCustomer: (cid) => all(
    `SELECT mv.*, it.name AS item_name, it.unit AS unit FROM inventory_moves mv
     LEFT JOIN inventory_items it ON it.id=mv.item_id
     WHERE mv.customer_id=? AND mv.type IN ('consume','out') ORDER BY mv.id DESC`, cid),
  lowStock: () => all("SELECT * FROM inventory_items WHERE reorder_level > 0 AND qty <= reorder_level ORDER BY name"),
  summary: () => {
    // Materials = non-serialized items (qty is a real stock count like meters/pcs).
    // Serialized = routers/ONUs tracked as individual units (serial+MAC).
    const mat = get("SELECT COUNT(*) n, COALESCE(SUM(qty),0) units, COALESCE(SUM(qty*cost),0) val FROM inventory_items WHERE COALESCE(serialized,0)=0");
    // Serialized value = cost of units still IN STOCK (not assigned/installed/returned/defective).
    const serVal = get(`SELECT COALESCE(SUM(it.cost),0) val
                        FROM inventory_units u JOIN inventory_items it ON it.id=u.item_id
                        WHERE u.status='in_stock'`);
    const unitsInStock = get("SELECT COUNT(*) n FROM inventory_units WHERE status='in_stock'");
    const unitsTotal = get("SELECT COUNT(*) n FROM inventory_units");
    const low = get("SELECT COUNT(*) n FROM inventory_items WHERE reorder_level > 0 AND qty <= reorder_level");
    const itemCount = get("SELECT COUNT(*) n FROM inventory_items");
    return {
      items: itemCount.n,
      // serialized routers/ONUs physically in stock (not yet assigned/installed)
      unitsInStock: unitsInStock.n, unitsTotal: unitsTotal.n,
      // material stock (cable/connectors etc.)
      materialUnits: mat.units,
      // total stock value = material value + value of in-stock serialized units
      value: (mat.val || 0) + (serVal.val || 0),
      low: low.n,
    };
  },

  // ---- Serialized units (serial + MAC per physical router/ONU) ----
  units: (filter) => {
    let sql = `SELECT u.*, it.name AS item_name, c.name AS customer_name
               FROM inventory_units u LEFT JOIN inventory_items it ON it.id=u.item_id
               LEFT JOIN customers c ON c.id=u.customer_id`;
    const args = [];
    if (filter && filter.status) { sql += " WHERE u.status=?"; args.push(filter.status); }
    sql += " ORDER BY u.id DESC";
    return all(sql, ...args);
  },
  unit: (id) => get("SELECT * FROM inventory_units WHERE id=?", id),
  addUnit: (u) => {
    const it = u.item_id ? Inventory.item(u.item_id) : null;
    if (!it) throw new Error("Choose a valid item.");
    if (!it.serialized) throw new Error(`"${it.name}" isn't a serialized item (router/ONU). Only serialized items track serial + MAC. Edit the item and tick "Serialized" if it should.`);
    if (!u.serial || !String(u.serial).trim()) throw new Error("Serial number is required.");
    const mac = (u.mac || "").toUpperCase().replace(/[^0-9A-F]/g, "");
    if (mac.length !== 12) throw new Error("A valid MAC (6 pairs) is required, e.g. A8:A5:EF:26:2B:55.");
    const macFmt = mac.match(/.{2}/g).join(":");
    if (get("SELECT 1 FROM inventory_units WHERE serial=? AND serial<>''", u.serial)) throw new Error("Serial " + u.serial + " already exists.");
    if (get("SELECT 1 FROM inventory_units WHERE mac=? AND mac<>''", macFmt)) throw new Error("MAC " + macFmt + " already exists.");
    const r = run("INSERT INTO inventory_units (item_id,serial,mac,status,notes) VALUES (?,?,?,?,?)",
      u.item_id || null, String(u.serial).trim(), macFmt, "in_stock", u.notes || "");
    // bump the item's qty to reflect the new physical unit
    if (u.item_id) run("UPDATE inventory_items SET qty=qty+1 WHERE id=?", u.item_id);
    Inventory.logUnitEvent(r.lastInsertRowid, "stocked", "", "in_stock", { detail: "added to stock" });
    return Inventory.unit(r.lastInsertRowid);
  },
  setUnit: (id, patch) => {
    const u = Inventory.unit(id); if (!u) throw new Error("Unit not found");
    const prevStatus = u.status;
    const fields = [], args = [];
    for (const k of ["serial", "mac", "status", "tech", "customer_id", "install_id", "notes"]) {
      if (patch[k] !== undefined) { fields.push(k + "=?"); args.push(patch[k]); }
    }
    if (!fields.length) return u;
    fields.push("updated_at=datetime('now','localtime')");
    args.push(id);
    run("UPDATE inventory_units SET " + fields.join(",") + " WHERE id=?", ...args);
    // log a lifecycle event when status changes
    if (patch.status !== undefined && patch.status !== prevStatus) {
      const evMap = { assigned: "assigned", installed: "installed", returned: "returned", defective: "defective", in_stock: "returned" };
      Inventory.logUnitEvent(id, evMap[patch.status] || "status", prevStatus, patch.status, { customer_id: patch.customer_id != null ? patch.customer_id : u.customer_id, tech: patch.tech != null ? patch.tech : u.tech, detail: patch._reason || "" });
      // Keep the parent item's on-hand qty in sync with physical reality:
      // leaving stock (in_stock -> assigned/installed/defective/returned) decrements on-hand,
      // coming back to stock (-> in_stock) increments it. Never go below zero.
      const leftStock = prevStatus === "in_stock" && patch.status !== "in_stock";
      const cameBack = prevStatus !== "in_stock" && patch.status === "in_stock";
      if (u.item_id && leftStock) run("UPDATE inventory_items SET qty=MAX(0, qty-1) WHERE id=?", u.item_id);
      if (u.item_id && cameBack) run("UPDATE inventory_items SET qty=qty+1 WHERE id=?", u.item_id);
    }
    return Inventory.unit(id);
  },
  logUnitEvent: (unitId, event, fromStatus, toStatus, opts = {}) => run(
    "INSERT INTO unit_events (unit_id,event,from_status,to_status,customer_id,tech,detail) VALUES (?,?,?,?,?,?,?)",
    unitId, event, fromStatus || "", toStatus || "", opts.customer_id || null, opts.tech || "", opts.detail || ""),
  // Find a unit by MAC or serial (for scan/search). Accepts loose MAC formats.
  findByMacOrSerial: (q) => {
    const raw = String(q || "").trim();
    if (!raw) return null;
    const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, "");
    let u = null;
    if (hex.length === 12) { const mac = hex.match(/.{2}/g).join(":"); u = get("SELECT * FROM inventory_units WHERE REPLACE(REPLACE(UPPER(mac),':',''),'-','')=? ", hex); }
    if (!u) u = get("SELECT * FROM inventory_units WHERE UPPER(serial)=?", raw.toUpperCase());
    if (!u) u = get("SELECT * FROM inventory_units WHERE REPLACE(REPLACE(UPPER(mac),':',''),'-','')=?", hex);
    if (!u) return null;
    return Inventory.unitFull(u.id);
  },
  unitFull: (id) => {
    const u = get(`SELECT u.*, it.name AS item_name, c.name AS customer_name
                   FROM inventory_units u LEFT JOIN inventory_items it ON it.id=u.item_id
                   LEFT JOIN customers c ON c.id=u.customer_id WHERE u.id=?`, id);
    if (!u) return null;
    u.history = all(`SELECT e.*, c.name AS customer_name FROM unit_events e LEFT JOIN customers c ON c.id=e.customer_id WHERE e.unit_id=? ORDER BY e.id DESC`, id);
    return u;
  },
  // Pull a router out from a client (e.g. disconnection or swap). Marks defective or returned.
  pullOut: (id, opts = {}) => {
    const u = Inventory.unit(id); if (!u) throw new Error("Unit not found");
    const toStatus = opts.defective ? "defective" : "returned";
    const cid = u.customer_id;
    run("UPDATE inventory_units SET status=?, customer_id=NULL, updated_at=datetime('now','localtime') WHERE id=?", toStatus, id);
    Inventory.logUnitEvent(id, "pulled_out", u.status, toStatus, { customer_id: cid, tech: opts.tech || "", detail: opts.reason || (opts.defective ? "pulled out — defective" : "pulled out — returned to stock") });
    return Inventory.unitFull(id);
  },
  // Replace a pulled unit with a new in-stock unit for the same customer.
  replaceUnit: (oldId, newId, opts = {}) => {
    const oldU = Inventory.unit(oldId); if (!oldU) throw new Error("Old unit not found");
    const newU = Inventory.unit(newId); if (!newU) throw new Error("Replacement unit not found");
    if (newU.status !== "in_stock") throw new Error("Replacement must be an in-stock unit.");
    const cid = opts.customer_id || oldU.customer_id;
    // old unit -> defective/returned (pulled), new unit -> installed at the customer
    const oldTo = opts.defective === false ? "returned" : "defective";
    run("UPDATE inventory_units SET status=?, customer_id=NULL, updated_at=datetime('now','localtime') WHERE id=?", oldTo, oldId);
    run("UPDATE inventory_units SET status='installed', customer_id=?, updated_at=datetime('now','localtime') WHERE id=?", cid || null, newId);
    Inventory.logUnitEvent(oldId, "replaced_by", oldU.status, oldTo, { customer_id: cid, tech: opts.tech || "", detail: `Replaced by unit #${newId} (${newU.serial || newU.mac})` });
    Inventory.logUnitEvent(newId, "replaces", "in_stock", "installed", { customer_id: cid, tech: opts.tech || "", detail: `Replaces unit #${oldId} (${oldU.serial || oldU.mac})` });
    return { old: Inventory.unitFull(oldId), new: Inventory.unitFull(newId) };
  },
  removeUnit: (id) => { const u = Inventory.unit(id); if (u && u.item_id) run("UPDATE inventory_items SET qty=MAX(0,qty-1) WHERE id=?", u.item_id); return run("DELETE FROM inventory_units WHERE id=?", id); },
  unitsForCustomer: (cid) => all(`SELECT u.*, it.name AS item_name FROM inventory_units u LEFT JOIN inventory_items it ON it.id=u.item_id WHERE u.customer_id=? ORDER BY u.id DESC`, cid),

  // ---- Per-technician custody ("what's on my truck") ----
  // Serialized units currently assigned to (held by) a technician, not yet installed/returned.
  techUnits: () => all(`SELECT u.*, it.name AS item_name FROM inventory_units u
     LEFT JOIN inventory_items it ON it.id=u.item_id
     WHERE u.status='assigned' AND COALESCE(u.tech,'')<>'' ORDER BY u.tech, it.name`),
  // Net materials a technician took out but hasn't consumed/returned: out - consume - return.
  techMaterials: () => all(`SELECT t.tech, t.item_id, it.name AS item_name, it.unit AS unit,
       SUM(CASE WHEN t.type='out' THEN t.qty
                WHEN t.type IN ('consume','return') THEN -t.qty
                ELSE 0 END) AS held
     FROM inventory_moves t LEFT JOIN inventory_items it ON it.id=t.item_id
     WHERE COALESCE(t.tech,'')<>'' AND t.type IN ('out','consume','return')
     GROUP BY t.tech, t.item_id HAVING held > 0 ORDER BY t.tech, it.name`),
  // Roll the above up into one object per technician.
  techCustody: () => {
    const units = Inventory.techUnits();
    const mats = Inventory.techMaterials();
    const techs = {};
    const ensure = (name) => (techs[name] = techs[name] || { tech: name, units: [], materials: [], unitCount: 0, matLines: 0 });
    for (const u of units) { const t = ensure(u.tech); t.units.push(u); t.unitCount++; }
    for (const m of mats) { const t = ensure(m.tech); t.materials.push(m); t.matLines++; }
    return Object.values(techs).sort((a, b) => a.tech.localeCompare(b.tech));
  },

  // ---- Install jobs (client + tech + materials/units + sign-off) ----
  createInstall: (i) => {
    const r = run("INSERT INTO installs (customer_id,tech,notes) VALUES (?,?,?)", i.customer_id || null, i.tech || "", i.notes || "");
    return get("SELECT * FROM installs WHERE id=?", r.lastInsertRowid);
  },
  install: (id) => get(`SELECT ins.*, c.name AS customer_name FROM installs ins LEFT JOIN customers c ON c.id=ins.customer_id WHERE ins.id=?`, id),
  installsForCustomer: (cid) => all("SELECT * FROM installs WHERE customer_id=? ORDER BY id DESC", cid),
  approveInstall: (id, a) => {
    run("UPDATE installs SET status='completed', approval_type=?, approved_by=?, approval_data=?, approved_at=datetime('now','localtime') WHERE id=?",
      a.approval_type || "typed", a.approved_by || "", a.approval_data || "", id);
    return Inventory.install(id);
  },
  // One-time / idempotent repair: set each serialized item's on-hand qty to the real number
  // of its units that are still in_stock. Fixes historical double-counts. Safe to run anytime.
  recalcSerializedQty: () => {
    const items = all("SELECT id FROM inventory_items WHERE serialized=1");
    let fixed = 0;
    for (const it of items) {
      const r = get("SELECT COUNT(*) n FROM inventory_units WHERE item_id=? AND status='in_stock'", it.id);
      const real = r ? r.n : 0;
      const cur = get("SELECT qty FROM inventory_items WHERE id=?", it.id);
      if (cur && Number(cur.qty) !== Number(real)) { run("UPDATE inventory_items SET qty=? WHERE id=?", real, it.id); fixed++; }
    }
    return fixed;
  },
  installUnits: (id) => all(`SELECT u.*, it.name AS item_name FROM inventory_units u LEFT JOIN inventory_items it ON it.id=u.item_id WHERE u.install_id=?`, id),
  installMoves: (id) => all(`SELECT mv.*, it.name AS item_name, it.unit AS unit FROM inventory_moves mv LEFT JOIN inventory_items it ON it.id=mv.item_id WHERE mv.install_id=?`, id),
  // Back-fill the customer on an install + its material movements once the account is created
  // (equipment is released before the account exists, so these start with customer_id NULL).
  setInstallCustomer: (id, cid) => { run("UPDATE installs SET customer_id=? WHERE id=?", cid || null, id); return Inventory.install(id); },
  setMovesCustomerByInstall: (installId, cid) => { run("UPDATE inventory_moves SET customer_id=? WHERE install_id=? AND (customer_id IS NULL OR customer_id='')", cid || null, installId); },
};

export const JobOrders = {
  SOURCES: [{ id: "apply", label: "Online apply" }, { id: "manual", label: "Manual" }],
  JOB_TYPES: [
    { id: "router_install_repair", label: "Router Install/repair" },
    { id: "residential_install", label: "Residential Install" },
    { id: "vendo_install_repair", label: "Vendo Install/repair" },
    { id: "other", label: "Other / Manual Job" },
  ],
  ITEM_STATUSES: [
    { id: "pending", label: "Pending" },
    { id: "in_progress", label: "In Progress" },
    { id: "done", label: "Done" },
    { id: "repair_needed", label: "Repair Needed" },
    { id: "cancelled", label: "Cancelled" },
  ],
  LEGACY_TYPE_LABELS: {
    new_install: "Residential Install",
    router_install: "Router Install/repair",
    router_repair: "Router Install/repair",
    vendo_install: "Vendo Install/repair",
    vendo_repair: "Vendo Install/repair",
    maintenance: "Other / Manual Job",
  },
  typeLabel: (t) => JobOrders.JOB_TYPES.find((x) => x.id === t)?.label || JobOrders.LEGACY_TYPE_LABELS[t] || t || "—",
  itemStatusLabel: (s) => JobOrders.ITEM_STATUSES.find((x) => x.id === s)?.label || s || "—",
  sourceLabel: (s) => JobOrders.SOURCES.find((x) => x.id === s)?.label || s || "—",
  needsVendoName: (jobType) => jobType === "vendo_install_repair" || jobType === "vendo_install" || jobType === "vendo_repair",
  TECH_ROLES: [
    { id: "lead", label: "Lead Technician" },
    { id: "staff", label: "Staff" },
    { id: "helper", label: "Helper" },
    { id: "installer", label: "Installer" },
  ],
  roleLabel: (role) => {
    const r = role === "assistant" ? "helper" : role;
    return JobOrders.TECH_ROLES.find((x) => x.id === r)?.label || role || "Staff";
  },
  normalizeRole: (role) => {
    const r = String(role || "helper").toLowerCase();
    if (r === "assistant") return "helper";
    return ["lead", "staff", "helper", "installer"].includes(r) ? r : "helper";
  },
  buildFullAddress: (a) => {
    const manual = String(a.full_address || "").trim();
    if (manual) return manual;
    return [a.address, a.street_sitio, a.address_line2, a.address_line3, a.address_line4, a.address_line5, a.area]
      .map((s) => String(s || "").trim()).filter(Boolean).join(", ");
  },
  getItems: (jobOrderId) => all(
    `SELECT ji.*, p.name AS plan_name, p.price AS plan_price
     FROM job_order_items ji LEFT JOIN plans p ON p.id = ji.plan_id
     WHERE ji.job_order_id=? ORDER BY ji.sort_order ASC, ji.id ASC`, jobOrderId,
  ),
  legacyItemsFromJo: (jo) => [{
    id: null,
    job_order_id: jo.id,
    sort_order: 0,
    job_type: jo.job_type || "residential_install",
    vendo_name: "",
    plan_id: jo.plan_id,
    plan_name: jo.plan_name || "",
    router_cost: jo.router_cost || 0,
    install_fee: jo.install_fee || 0,
    notes: jo.notes || "",
    marking: "",
    status: "pending",
    legacy: true,
  }],
  getTechs: (jobOrderId) => all(
    `SELECT jot.id, jot.job_order_id, jot.staff_id, jot.tech_name, jot.role
     FROM job_order_techs jot WHERE jot.job_order_id=?
     ORDER BY CASE jot.role WHEN 'lead' THEN 0 WHEN 'installer' THEN 1 ELSE 2 END, jot.tech_name`,
    jobOrderId,
  ),
  leadTechName: (jobOrderId, fallbackTech = "") => {
    const lead = get("SELECT tech_name FROM job_order_techs WHERE job_order_id=? AND role='lead' ORDER BY id LIMIT 1", jobOrderId);
    if (lead?.tech_name) return lead.tech_name;
    return fallbackTech || "";
  },
  enrich: (jo) => {
    if (!jo) return jo;
    jo.techs = JobOrders.getTechs(jo.id);
    jo.tech = JobOrders.leadTechName(jo.id, jo.tech || "");
    jo.tech_crew = jo.techs.map((t) => `${t.tech_name} (${JobOrders.roleLabel(t.role)})`).join(", ");
    jo.items = JobOrders.getItems(jo.id);
    if (!jo.items.length) jo.items = JobOrders.legacyItemsFromJo(jo);
    jo.item_count = jo.items.length;
    jo.full_address = jo.full_address || JobOrders.buildFullAddress(jo);
    return jo;
  },
  list: (filter = {}) => {
    let sql = `SELECT jo.*, p.name AS plan_name, p.price AS plan_price, c.name AS linked_customer,
               (SELECT GROUP_CONCAT(jot.tech_name || ' (' || jot.role || ')', ', ')
                FROM job_order_techs jot WHERE jot.job_order_id = jo.id) AS tech_crew,
               (SELECT COUNT(*) FROM job_order_items ji WHERE ji.job_order_id = jo.id) AS item_count
               FROM job_orders jo LEFT JOIN plans p ON p.id=jo.plan_id
               LEFT JOIN customers c ON c.id=jo.customer_id`;
    const where = [], args = [];
    if (filter.status) { where.push("jo.status=?"); args.push(filter.status); }
    if (filter.source) { where.push("jo.source=?"); args.push(filter.source); }
    if (filter.job_type) { where.push("jo.job_type=?"); args.push(filter.job_type); }
    if (filter.scheduledToday) {
      where.push("(COALESCE(NULLIF(jo.scheduled_date,''), date(jo.created_at)) = date('now','localtime'))");
    }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY jo.id DESC LIMIT 500";
    return all(sql, ...args);
  },
  get: (id) => JobOrders.enrich(get(`SELECT jo.*, p.name AS plan_name, p.price AS plan_price, p.speed AS plan_speed, p.type AS plan_type, c.name AS linked_customer
                    FROM job_orders jo LEFT JOIN plans p ON p.id=jo.plan_id
                    LEFT JOIN customers c ON c.id=jo.customer_id WHERE jo.id=?`, id)),
  // Public application submit.
  apply: (a) => {
    const r = run(`INSERT INTO job_orders (name,last_name,username,password,contact,email,facebook,address,area,lat,lng,plan_id,conn_type,notes,install_fee,router_cost,pay_choice,pay_status,pay_reference,pay_proof,agreed,referral_code,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      a.name, a.last_name || "", a.username || "", a.password || "",
      a.contact || "", a.email || "", a.facebook || "", a.address || "", a.area || "",
      a.lat != null && a.lat !== "" ? Number(a.lat) : null, a.lng != null && a.lng !== "" ? Number(a.lng) : null,
      a.plan_id || null, a.conn_type || "pppoe", a.notes || "",
      Number(a.install_fee) || 0, Number(a.router_cost) || 0,
      a.pay_choice === "now" ? "now" : "on_install",
      a.pay_choice === "now" ? "paid" : "unpaid",
      a.pay_reference || "", a.pay_proof || "", a.agreed ? 1 : 0,
      String(a.referral_code || "").trim().toUpperCase() || "",
      a.status || "applied");
    return JobOrders.get(r.lastInsertRowid);
  },
  // Staff-created job (walk-in, phone, daily router list — not from /apply).
  create: (a) => {
    const first = String(a.name || a.first_name || "").trim();
    const contact = String(a.contact || "").trim();
    const items = Array.isArray(a.items) ? a.items : [];
    if (!items.length) throw new Error("Add at least one job item.");
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const jt = String(it.job_type || "").trim();
      if (!jt) throw new Error(`Job item ${i + 1}: job type is required.`);
      if (JobOrders.needsVendoName(jt) && !String(it.vendo_name || "").trim()) {
        throw new Error(`Job item ${i + 1}: vendo name is required for ${JobOrders.typeLabel(jt)}.`);
      }
    }
    const firstItem = items[0];
    const jobType = String(firstItem.job_type || "residential_install");
    const sched = String(a.scheduled_date || "").trim() || new Date().toISOString().slice(0, 10);
    const addr = {
      address: a.address || "",
      street_sitio: a.street_sitio || "",
      address_line2: a.address_line2 || "",
      address_line3: a.address_line3 || "",
      address_line4: a.address_line4 || "",
      address_line5: a.address_line5 || "",
      area: a.area || "",
      full_address: a.full_address || "",
    };
    const fullAddr = JobOrders.buildFullAddress(addr);
    const totalInstall = items.reduce((s, it) => s + (Number(it.install_fee) || 0), 0);
    const totalRouter = items.reduce((s, it) => s + (Number(it.router_cost) || 0), 0);
    const r = run(`INSERT INTO job_orders (name,last_name,username,password,contact,email,facebook,address,street_sitio,address_line2,address_line3,address_line4,address_line5,full_address,area,lat,lng,plan_id,conn_type,notes,install_fee,router_cost,pay_choice,pay_status,pay_reference,pay_proof,agreed,referral_code,status,source,job_type,scheduled_date,marking_order,marking_completed,marking_repair)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      first, String(a.last_name || "").trim(), String(a.username || "").trim(), String(a.password || "").trim(),
      contact, a.email || "", a.facebook || "",
      addr.address, addr.street_sitio, addr.address_line2, addr.address_line3, addr.address_line4, addr.address_line5,
      fullAddr, addr.area,
      a.lat != null && a.lat !== "" ? Number(a.lat) : null, a.lng != null && a.lng !== "" ? Number(a.lng) : null,
      firstItem.plan_id || null, a.conn_type || "pppoe", a.notes || "",
      totalInstall || Number(a.install_fee) || 0,
      totalRouter || Number(a.router_cost) || 0,
      a.pay_choice === "now" ? "now" : "on_install",
      a.pay_choice === "now" && a.pay_status === "paid" ? "paid" : (a.pay_status || "unpaid"),
      a.pay_reference || "", a.pay_proof || "", 1,
      String(a.referral_code || "").trim().toUpperCase() || "",
      a.status || "applied",
      a.source || "manual",
      jobType,
      sched,
      a.marking_order || "", a.marking_completed || "", a.marking_repair || "");
    const id = r.lastInsertRowid;
    JobOrders.saveItems(id, items);
    if (Array.isArray(a.techs) && a.techs.length) JobOrders.setTechs(id, a.techs);
    else if (a.tech) JobOrders.setTech(id, a.tech);
    return JobOrders.get(id);
  },
  saveItems: (jobOrderId, items) => {
    run("DELETE FROM job_order_items WHERE job_order_id=?", jobOrderId);
    (items || []).forEach((it, idx) => {
      const jt = String(it.job_type || "other").trim();
      const status = JobOrders.ITEM_STATUSES.some((s) => s.id === it.status) ? it.status : "pending";
      run(`INSERT INTO job_order_items (job_order_id,sort_order,job_type,vendo_name,plan_id,router_cost,install_fee,notes,marking,status)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        jobOrderId, idx,
        jt,
        JobOrders.needsVendoName(jt) ? String(it.vendo_name || "").trim() : String(it.vendo_name || "").trim(),
        it.plan_id || null,
        Number(it.router_cost) || 0,
        Number(it.install_fee) || 0,
        it.notes || "",
        it.marking || "",
        status);
    });
  },
  setStatus: (id, status) => { run("UPDATE job_orders SET status=? WHERE id=?", status, id); return JobOrders.get(id); },
  reject: (id, reason) => { run("UPDATE job_orders SET status='rejected', reject_reason=? WHERE id=?", reason || "", id); return JobOrders.get(id); },
  setTech: (id, tech) => JobOrders.setTechs(id, tech ? [{ tech_name: tech, role: "lead" }] : []),
  setTechs: (id, techs) => {
    const jo = get("SELECT id, status FROM job_orders WHERE id=?", id);
    if (!jo) return null;
    const rows = (Array.isArray(techs) ? techs : []).map((t) => {
      let staffId = t.staff_id != null && t.staff_id !== "" ? Number(t.staff_id) : null;
      let techName = String(t.tech_name || t.name || t.tech || "").trim();
      if (staffId) {
        const row = Techs.get(staffId);
        if (row) techName = row.name;
      }
      return { staff_id: staffId, tech_name: techName, role: JobOrders.normalizeRole(t.role) };
    }).filter((t) => t.tech_name);
    const seen = new Set();
    const clean = [];
    for (const t of rows) {
      const key = t.staff_id ? `id:${t.staff_id}` : t.tech_name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push(t);
    }
    if (clean.length && !clean.some((t) => t.role === "lead")) clean[0].role = "lead";
    run("DELETE FROM job_order_techs WHERE job_order_id=?", id);
    for (const t of clean) {
      run("INSERT INTO job_order_techs (job_order_id, staff_id, tech_name, role) VALUES (?,?,?,?)",
        id, t.staff_id || null, t.tech_name, t.role);
    }
    const lead = clean.find((t) => t.role === "lead")?.tech_name || clean[0]?.tech_name || "";
    run(
      "UPDATE job_orders SET tech=?, status=CASE WHEN status='applied' AND ?<>'' THEN 'assigned' ELSE status END WHERE id=?",
      lead, lead, id,
    );
    return JobOrders.get(id);
  },
  setPaid: (id) => { run("UPDATE job_orders SET pay_status='paid' WHERE id=?", id); return JobOrders.get(id); },
  link: (id, customer_id) => { run("UPDATE job_orders SET customer_id=? WHERE id=?", customer_id, id); return JobOrders.get(id); },
  setInstall: (id, install_id) => { run("UPDATE job_orders SET install_id=? WHERE id=?", install_id, id); return JobOrders.get(id); },
  remove: (id) => {
    run("DELETE FROM job_order_items WHERE job_order_id=?", id);
    run("DELETE FROM job_order_techs WHERE job_order_id=?", id);
    run("DELETE FROM job_orders WHERE id=?", id);
  },
  summary: () => {
    const s = get("SELECT COUNT(*) total, SUM(status='applied') applied, SUM(status IN ('assigned','released','installed')) inprogress, SUM(status='completed') completed FROM job_orders");
    return { total: s.total || 0, applied: s.applied || 0, inprogress: s.inprogress || 0, completed: s.completed || 0 };
  },
  // Things needing attention, for the dashboard/nav badge + alerts panel.
  alerts: () => {
    const newApps = all("SELECT id,name,created_at FROM job_orders WHERE status='applied' ORDER BY id DESC");
    // Only flag "unassigned" as a warning if it's been waiting over ~12 hours — a brand-new
    // application being unassigned is normal, not an error.
    const staleUnassigned = all(`SELECT jo.id, jo.name FROM job_orders jo
      WHERE jo.status='applied' AND COALESCE(jo.tech,'')=''
        AND NOT EXISTS (SELECT 1 FROM job_order_techs jot WHERE jot.job_order_id=jo.id)
        AND datetime(COALESCE(jo.created_at, datetime('now'))) < datetime('now','-12 hours')`);
    const awaitingPay = all("SELECT id,name FROM job_orders WHERE pay_status='proof_submitted'");
    const readyNoAccount = all("SELECT id,name FROM job_orders WHERE status IN ('released','installed') AND customer_id IS NULL");
    const items = [];
    if (newApps.length) items.push({ kind: "new", level: "info", count: newApps.length, text: `${newApps.length} new application${newApps.length === 1 ? "" : "s"} to review`, ids: newApps.map((r) => r.id) });
    if (staleUnassigned.length) items.push({ kind: "unassigned", level: "warn", count: staleUnassigned.length, text: `${staleUnassigned.length} application${staleUnassigned.length === 1 ? "" : "s"} waiting over 12h for a technician`, ids: staleUnassigned.map((r) => r.id) });
    if (awaitingPay.length) items.push({ kind: "pay", level: "warn", count: awaitingPay.length, text: `${awaitingPay.length} payment proof${awaitingPay.length === 1 ? "" : "s"} to verify`, ids: awaitingPay.map((r) => r.id) });
    if (readyNoAccount.length) items.push({ kind: "account", level: "warn", count: readyNoAccount.length, text: `${readyNoAccount.length} installed job${readyNoAccount.length === 1 ? "" : "s"} with no account created yet`, ids: readyNoAccount.map((r) => r.id) });
    return { items, total: items.reduce((s, i) => s + i.count, 0) };
  },
};

export const Techs = {
  RANKS: ["Lead Technician", "Senior Technician", "Technician", "Junior Technician", "Helper/Apprentice"],
  STATUSES: ["available", "on_job", "off_duty"],
  list: () => {
    const techs = all("SELECT * FROM techs WHERE active=1 ORDER BY name");
    // enrich each with their active job orders + areas they've actually installed in
    for (const t of techs) {
      const jobs = all(
        `SELECT jo.id, jo.name AS client, jo.area, jo.address, jo.status, jot.role
         FROM job_order_techs jot
         JOIN job_orders jo ON jo.id = jot.job_order_id
         WHERE jot.tech_name=? AND jo.status IN ('assigned','released','installed')
         ORDER BY jo.id DESC`, t.name);
      t.activeJobs = jobs;
      t.activeCount = jobs.length;
      const doneAreas = all(
        `SELECT DISTINCT COALESCE(NULLIF(jo.area,''),'(no area)') area
         FROM job_order_techs jot
         JOIN job_orders jo ON jo.id = jot.job_order_id
         WHERE jot.tech_name=? AND jo.status='completed' AND jo.area IS NOT NULL`, t.name).map((r) => r.area);
      t.servedAreas = doneAreas;
      t.completedCount = get(
        `SELECT COUNT(DISTINCT jo.id) n FROM job_order_techs jot
         JOIN job_orders jo ON jo.id = jot.job_order_id
         WHERE jot.tech_name=? AND jo.status='completed'`, t.name).n;
      // a tech is effectively busy if they have any active (not-yet-completed) job
      t.effectiveStatus = t.status === "off_duty" ? "off_duty" : (t.activeCount > 0 ? "on_job" : "available");
    }
    return techs;
  },
  get: (id) => get("SELECT * FROM techs WHERE id=?", id),
  byName: (name) => get("SELECT * FROM techs WHERE name=? AND active=1", name),
  create: (t) => {
    const r = run("INSERT INTO techs (name,rank,phone,status,areas,notes) VALUES (?,?,?,?,?,?)",
      t.name, t.rank || "Technician", t.phone || "", Techs.STATUSES.includes(t.status) ? t.status : "available", t.areas || "", t.notes || "");
    return Techs.get(r.lastInsertRowid);
  },
  update: (id, t) => {
    run("UPDATE techs SET name=?,rank=?,phone=?,status=?,areas=?,notes=? WHERE id=?",
      t.name, t.rank || "Technician", t.phone || "", Techs.STATUSES.includes(t.status) ? t.status : "available", t.areas || "", t.notes || "", id);
    return Techs.get(id);
  },
  setStatus: (id, status) => { run("UPDATE techs SET status=? WHERE id=?", Techs.STATUSES.includes(status) ? status : "available", id); return Techs.get(id); },
  remove: (id) => run("UPDATE techs SET active=0 WHERE id=?", id), // soft-delete: keep history intact
  // Names for assignment dropdowns (active techs only).
  names: () => all("SELECT name FROM techs WHERE active=1 ORDER BY name").map((r) => r.name),
  summary: () => {
    const list = Techs.list();
    return {
      total: list.length,
      available: list.filter((t) => t.effectiveStatus === "available").length,
      onJob: list.filter((t) => t.effectiveStatus === "on_job").length,
      offDuty: list.filter((t) => t.effectiveStatus === "off_duty").length,
    };
  },
};

export const Hardware = {
  record: (s) => {
    const r = run(`INSERT INTO hardware_sales (customer_id,item_id,unit_id,item_name,cost,sell_price,margin,method,payment_id,expense_id,note)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      s.customer_id || null, s.item_id || null, s.unit_id || null, s.item_name || "",
      Number(s.cost) || 0, Number(s.sell_price) || 0, (Number(s.sell_price) || 0) - (Number(s.cost) || 0),
      s.method || "cash", s.payment_id || null, s.expense_id || null, s.note || "");
    return get("SELECT * FROM hardware_sales WHERE id=?", r.lastInsertRowid);
  },
  list: (limit = 200) => all("SELECT * FROM hardware_sales ORDER BY id DESC LIMIT ?", Number(limit) || 200),
  // Totals for a period (YYYY-MM); omit for all-time.
  summary: (ym) => {
    const where = ym ? "WHERE substr(sold_at,1,7)=?" : "";
    const args = ym ? [ym] : [];
    const row = get(`SELECT COUNT(*) n, COALESCE(SUM(sell_price),0) revenue, COALESCE(SUM(cost),0) cost, COALESCE(SUM(margin),0) margin FROM hardware_sales ${where}`, ...args);
    return { count: row.n, revenue: row.revenue, cost: row.cost, margin: row.margin };
  },
};

export const Expenses = {
  CATEGORIES: ["electricity", "fuel", "vehicle", "salary", "rent", "internet/bandwidth", "equipment", "supplies", "tax/permit", "misc"],
  list: (filter = {}) => {
    let sql = "SELECT * FROM expenses";
    const where = [], args = [];
    if (filter.period) { where.push("substr(spent_at,1,7)=?"); args.push(filter.period); }
    if (filter.category) { where.push("category=?"); args.push(filter.category); }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY spent_at DESC, id DESC LIMIT 500";
    return all(sql, ...args);
  },
  add: (e) => {
    const r = run("INSERT INTO expenses (category,description,amount,vendor,paid_by,spent_at,note,router_id) VALUES (?,?,?,?,?,?,?,?)",
      e.category || "misc", e.description || "", Number(e.amount) || 0, e.vendor || "", e.paid_by || "",
      e.spent_at || new Date().toISOString().slice(0, 10), e.note || "",
      (e.router_id != null && e.router_id !== "") ? Number(e.router_id) : null);
    return get("SELECT * FROM expenses WHERE id=?", r.lastInsertRowid);
  },
  update: (id, e) => {
    const cur = get("SELECT * FROM expenses WHERE id=?", id);
    run("UPDATE expenses SET category=?,description=?,amount=?,vendor=?,paid_by=?,spent_at=?,note=?,router_id=? WHERE id=?",
      e.category || "misc", e.description || "", Number(e.amount) || 0, e.vendor || "", e.paid_by || "",
      e.spent_at || new Date().toISOString().slice(0, 10), e.note || "",
      (e.router_id != null && e.router_id !== "") ? Number(e.router_id) : (cur ? cur.router_id : null), id);
    return get("SELECT * FROM expenses WHERE id=?", id);
  },
  remove: (id) => run("DELETE FROM expenses WHERE id=?", id),
  byCategory: (period) => all(
    "SELECT category, COALESCE(SUM(amount),0) total, COUNT(*) n FROM expenses" +
    (period ? " WHERE substr(spent_at,1,7)=?" : "") + " GROUP BY category ORDER BY total DESC",
    ...(period ? [period] : [])),
  totalForPeriod: (period) => {
    const r = get("SELECT COALESCE(SUM(amount),0) total FROM expenses" + (period ? " WHERE substr(spent_at,1,7)=?" : ""), ...(period ? [period] : []));
    return r ? r.total : 0;
  },
};

export const CSessions = {
  create: (customerId, days = 7) => {
    const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const exp = new Date(Date.now() + days * 86400000).toISOString();
    run("INSERT INTO customer_sessions (token,customer_id,expires) VALUES (?,?,?)", token, customerId, exp);
    run("DELETE FROM customer_sessions WHERE expires < datetime('now')");
    return token;
  },
  get: (token) => {
    if (!token) return null;
    const s = get("SELECT * FROM customer_sessions WHERE token=? AND expires > datetime('now')", token);
    return s || null;
  },
  destroy: (token) => run("DELETE FROM customer_sessions WHERE token=?", token),
};

export const Outages = {
  list: () => all(`SELECT o.*, CASE WHEN o.scope_type='nap' THEN (SELECT name FROM naps WHERE id=CAST(o.scope_value AS INTEGER)) ELSE o.scope_value END AS scope_name FROM outages o ORDER BY o.status='resolved', o.started_at DESC`),
  get: (id) => get("SELECT * FROM outages WHERE id=?", id),
  create: (o) => { const r = run("INSERT INTO outages (title,scope_type,scope_value,notes) VALUES (?,?,?,?)", o.title, o.scope_type || "all", String(o.scope_value || ""), o.notes || ""); return Outages.get(r.lastInsertRowid); },
  setNotified: (id, n) => run("UPDATE outages SET notified=? WHERE id=?", n, id),
  resolve: (id) => { run("UPDATE outages SET status='resolved', resolved_at=datetime('now','localtime') WHERE id=?", id); return Outages.get(id); },
  remove: (id) => run("DELETE FROM outages WHERE id=?", id),
  openCount: () => get("SELECT COUNT(*) n FROM outages WHERE status='open'").n,
  // customers affected by a scope (with any contact for notification; all for counting)
  affected: (scope_type, scope_value) => {
    if (scope_type === "nap") return all("SELECT * FROM customers WHERE nap_id=?", Number(scope_value) || 0);
    if (scope_type === "area") return all("SELECT * FROM customers WHERE area=?", String(scope_value));
    return all("SELECT * FROM customers");
  },
};

export const Reports = {
  // last N months of revenue + invoicing performance
  monthly: (n) => {
    n = Math.min(Math.max(Number(n) || 12, 1), 36);
    const rows = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const rev = get("SELECT COALESCE(SUM(amount),0) v, COUNT(*) c FROM payments WHERE substr(paid_at,1,7)=?", period);
      const inv = get("SELECT COALESCE(SUM(amount),0) v, COUNT(*) c FROM invoices WHERE period=?", period);
      const paid = get("SELECT COALESCE(SUM(amount),0) v, COUNT(*) c FROM invoices WHERE period=? AND status='paid'", period);
      rows.push({
        period, revenue: rev.v, payments: rev.c,
        invoiced: inv.v, invoices: inv.c, invoicesPaid: paid.c,
        collectionRate: inv.v > 0 ? Math.round((paid.v / inv.v) * 100) : null,
        newCustomers: get("SELECT COUNT(*) c FROM customers WHERE substr(created_at,1,7)=?", period).c,
      });
    }
    return rows;
  },
  byMethod: (period) => all("SELECT COALESCE(NULLIF(method,''),'cash') method, COALESCE(SUM(amount),0) total, COUNT(*) n FROM payments" + (period ? " WHERE substr(paid_at,1,7)=?" : "") + " GROUP BY 1 ORDER BY total DESC", ...(period ? [period] : [])),
  // Full monthly financial statement: every income stream separated + expenses + net.
  monthlyStatement: (period) => {
    const p = period || new Date().toISOString().slice(0, 7);
    const cf = Reports.cashflow(p); // subscriptions / install / hardware margin / expenses / net
    // Vendo / hotspot coin income for the month
    const vendoRows = all("SELECT COALESCE(NULLIF(vendo,''),'(unknown)') vendo, COUNT(*) c, COALESCE(SUM(amount),0) s FROM hotspot_events WHERE type='coin' AND substr(at,1,7)=? GROUP BY vendo ORDER BY s DESC", p);
    const vendoTotal = vendoRows.reduce((a, r) => a + Number(r.s || 0), 0);
    // Payment method breakdown for subscriptions+install+hardware payments (cash flow visibility)
    const methods = all("SELECT COALESCE(NULLIF(method,''),'cash') method, COALESCE(SUM(amount),0) total, COUNT(*) n FROM payments WHERE substr(paid_at,1,7)=? GROUP BY 1 ORDER BY total DESC", p);
    // Expenses by category
    const expRows = cf.out.byCategory || [];
    // Income streams, in proper order
    const income = {
      subscriptions: cf.in.subscriptions,   // monthly client payments
      installation: cf.in.installFees,       // installation fees
      hardware: (cf.in.hardware != null ? cf.in.hardware : cf.in.hardwareMargin), // resale margin + any untracked hardware payments
      vendo: vendoTotal,                     // hotspot/piso-wifi coin income
    };
    const incomeTotal = income.subscriptions + income.installation + income.hardware + income.vendo;
    const expenseTotal = cf.out.expenses;
    return {
      period: p,
      income,
      incomeTotal,
      hardwareDetail: { revenue: cf.in.hardwareRevenue, cost: cf.in.hardwareCost, margin: cf.in.hardwareMargin },
      vendoByDevice: vendoRows,
      methods,
      expenses: expRows,
      expenseTotal,
      net: incomeTotal - expenseTotal,
    };
  },
  // Payments are tagged by note: "Install:" and "Hardware:"; the rest are subscriptions.
  // Hardware money-in is shown as MARGIN (sell - cost) so it isn't double-counted against
  // the stock value already spent when the unit was bought.
  cashflow: (period, routerId = null) => {
    const rid = routerId != null && routerId !== "" && !Number.isNaN(Number(routerId)) ? Number(routerId) : null;
    const pmFrom = rid != null ? "payments pm INNER JOIN customers c ON c.id=pm.customer_id" : "payments pm";
    const pmArgs = () => { const a = []; if (period) a.push(period); if (rid != null) a.push(rid); return a; };
    const sumWhere = (extra) => {
      const wh = [];
      if (period) wh.push("substr(pm.paid_at,1,7)=?");
      if (rid != null) wh.push("c.router_id=?");
      if (extra) wh.push(extra);
      return get(`SELECT COALESCE(SUM(pm.amount),0) total, COUNT(*) n FROM ${pmFrom}${wh.length ? " WHERE " + wh.join(" AND ") : ""}`, ...pmArgs());
    };
    const install = sumWhere("pm.note LIKE 'Install:%'");
    const hardwarePay = sumWhere("pm.note LIKE 'Hardware:%'");
    // Wallet accounting (Option A, cash basis):
    //  • a "Wallet topup:" payment = real cash in → counts as income (under subscriptions stream).
    //  • a method='wallet' payment that is NOT a topup = spending wallet credit on a renewal →
    //    NOT new cash (already counted at top-up time) → excluded from income.
    const walletTopups = sumWhere("pm.note LIKE 'Wallet topup:%'");
    // subscriptions = everything that's NOT install / hardware / a wallet-spend.
    // Wallet topups stay in (real cash). Wallet *spends* are excluded so we don't double-count:
    //  - method='wallet' that isn't a "Wallet topup:" = spending wallet credit on a renewal.
    //  - method='credit' = ALSO a wallet/credit spend (e.g. "auto-renew from wallet", "paid from
    //    wallet credit"); the cash was already counted at top-up time, so it must NOT count again.
    const subs = sumWhere("COALESCE(pm.note,'') NOT LIKE 'Install:%' AND COALESCE(pm.note,'') NOT LIKE 'Hardware:%' AND COALESCE(pm.method,'') <> 'credit' AND NOT (COALESCE(pm.method,'')='wallet' AND COALESCE(pm.note,'') NOT LIKE 'Wallet topup:%')");
    // hardware margin for the period (from hardware_sales)
    let hwSql = "SELECT COALESCE(SUM(hs.sell_price),0) revenue, COALESCE(SUM(hs.cost),0) cost, COALESCE(SUM(hs.margin),0) margin, COUNT(*) n FROM hardware_sales hs";
    const hwArgs = [];
    const hwWh = [];
    if (rid != null) { hwSql += " INNER JOIN customers c ON c.id=hs.customer_id"; hwWh.push("c.router_id=?"); hwArgs.push(rid); }
    if (period) { hwWh.push("substr(hs.sold_at,1,7)=?"); hwArgs.push(period); }
    if (hwWh.length) hwSql += " WHERE " + hwWh.join(" AND ");
    const hw = get(hwSql, ...hwArgs);
    // expenses for the period, by category
    const expWh = [];
    const expArgs = [];
    if (period) { expWh.push("substr(spent_at,1,7)=?"); expArgs.push(period); }
    if (rid != null) { expWh.push("router_id=?"); expArgs.push(rid); }
    const expRows = all("SELECT category, COALESCE(SUM(amount),0) total, COUNT(*) n FROM expenses" + (expWh.length ? " WHERE " + expWh.join(" AND ") : "") + " GROUP BY category ORDER BY total DESC", ...expArgs);
    const expTotal = expRows.reduce((s, r) => s + Number(r.total || 0), 0);
    // Money IN streams. Subscriptions exclude install+hardware (they're tagged separately).
    const inSubs = Number(subs.total || 0);
    const inInstall = Number(install.total || 0);
    // Hardware money-in depends on the costing mode (must match how cost is handled on the
    // expense side, or the cost gets counted twice):
    //  • stock-value mode (cost NOT logged as expense): count MARGIN (sell-cost). The stock
    //    money was already spent when bought, so only the profit is "new" money in.
    //  • cost-as-expense mode (cost IS logged as expense): count full REVENUE here, because the
    //    cost is subtracted separately under expenses. Counting margin AND the expense would
    //    subtract the cost twice.
    // Plus: any payment tagged "Hardware:" with no matching hardware_sales row (recorded
    // directly, not via the sell flow) is added so that money never vanishes from the report.
    let costAsExpense = false;
    try { costAsExpense = Settings.get("inv_cost_as_expense", "0") === "1"; } catch {}
    const inHwMargin = Number(hw.margin || 0);
    const hwSalesRevenue = Number(hw.revenue || 0);
    const hwPayTotal = Number(hardwarePay.total || 0);
    // recorded-sale contribution: revenue (if cost expensed) or margin (stock-value mode)
    const hwSalesContribution = costAsExpense ? hwSalesRevenue : inHwMargin;
    // untracked hardware payments (tagged but no sales row) — count at face value either way
    const hwUntracked = Math.max(0, hwPayTotal - hwSalesRevenue);
    const inHardware = hwSalesContribution + hwUntracked;
    // Vendo / piso-WiFi coin income for the period (so the quick cashflow view matches the
    // printed monthly statement, which also counts vendo).
    let inVendo = 0;
    try {
      let vSql = "SELECT COALESCE(SUM(he.amount),0) t FROM hotspot_events he";
      const vWh = ["he.type='coin'"];
      const vArgs = [];
      if (rid != null) { vSql += " LEFT JOIN vendos v ON v.name=he.vendo"; vWh.push("v.router_id=?"); vArgs.push(rid); }
      if (period) { vWh.push("substr(he.at,1,7)=?"); vArgs.push(period); }
      vSql += " WHERE " + vWh.join(" AND ");
      const vrow = get(vSql, ...vArgs);
      inVendo = Number(vrow.t) || 0;
    } catch {}
    const moneyIn = inSubs + inInstall + inHardware + inVendo;
    const moneyOut = expTotal;
    return {
      period: period || "all-time",
      router_id: rid,
      in: {
        subscriptions: inSubs,
        installFees: inInstall,
        hardwareMargin: inHwMargin,
        hardwareRevenue: Number(hw.revenue || 0),
        hardwareCost: Number(hw.cost || 0),
        hardwareUntracked: hwUntracked,
        hardware: inHardware,
        vendo: inVendo,
        walletTopups: Number(walletTopups.total || 0),
        total: moneyIn,
      },
      out: { expenses: expTotal, byCategory: expRows },
      net: moneyIn - moneyOut,
      // Memo (not added to income): total unspent wallet credit you're currently holding.
      // This is money customers prepaid that they haven't used as service yet.
      walletHeld: (() => { try { return Number(get("SELECT COALESCE(SUM(credit),0) t FROM customers").t) || 0; } catch { return 0; } })(),
    };
  },
  // Sales per router/site, for a given period (or all-time). Money is attributed via the paying
  // customer's router_id; vendo coin income via the vendo's router_id. Unassigned → "(no router)".
  salesByRouter: (period) => {
    const pw = period ? " AND substr(pm.paid_at,1,7)=?" : "";
    const pa = period ? [period] : [];
    // subscription/topup/install cash by router (exclude wallet-spend double counting, same rule as cashflow)
    const rows = all(`
      SELECT c.router_id AS rid, rt.name AS router_name,
             COALESCE(SUM(pm.amount),0) AS total, COUNT(*) AS n
      FROM payments pm
      LEFT JOIN customers c ON c.id=pm.customer_id
      LEFT JOIN routers rt ON rt.id=c.router_id
      WHERE COALESCE(pm.note,'') NOT LIKE 'Hardware:%'
        AND COALESCE(pm.method,'') <> 'credit'
        AND NOT (COALESCE(pm.method,'')='wallet' AND COALESCE(pm.note,'') NOT LIKE 'Wallet topup:%')
        ${pw}
      GROUP BY c.router_id`, ...pa);
    // vendo coins by router (coins reference the vendo by NAME in hotspot_events.vendo)
    let vendoRows = [];
    try {
      const vw = period ? " AND substr(he.at,1,7)=?" : "";
      vendoRows = all(`
        SELECT v.router_id AS rid, COALESCE(SUM(he.amount),0) AS vendo, COUNT(*) AS vn
        FROM hotspot_events he LEFT JOIN vendos v ON v.name=he.vendo
        WHERE he.type='coin' ${vw} GROUP BY v.router_id`, ...(period ? [period] : []));
    } catch {}
    // merge into a per-router map
    const map = {};
    const routerList = all("SELECT id, name FROM routers ORDER BY name");
    for (const r of routerList) map[r.id] = { router_id: r.id, router_name: r.name, subscriptions: 0, payments: 0, vendo: 0, vendoCount: 0, total: 0 };
    map["null"] = { router_id: null, router_name: "(no router assigned)", subscriptions: 0, payments: 0, vendo: 0, vendoCount: 0, total: 0 };
    for (const row of rows) {
      const k = row.rid == null ? "null" : row.rid;
      if (!map[k]) map[k] = { router_id: row.rid, router_name: row.router_name || "(no router)", subscriptions: 0, payments: 0, vendo: 0, vendoCount: 0, total: 0 };
      map[k].subscriptions = Number(row.total || 0); map[k].payments = Number(row.n || 0);
    }
    for (const vr of vendoRows) {
      const k = vr.rid == null ? "null" : vr.rid;
      if (!map[k]) map[k] = { router_id: vr.rid, router_name: "(no router)", subscriptions: 0, payments: 0, vendo: 0, vendoCount: 0, total: 0 };
      map[k].vendo = Number(vr.vendo || 0); map[k].vendoCount = Number(vr.vn || 0);
    }
    const out = Object.values(map).map((r) => ({ ...r, total: r.subscriptions + r.vendo })).filter((r) => r.payments > 0 || r.vendo > 0 || r.router_id != null);
    out.sort((a, b) => b.total - a.total);
    return { period: period || "all-time", routers: out, grandTotal: out.reduce((s, r) => s + r.total, 0) };
  },
  // Profit per site: PPPoE income + IPoE income + vendo coins  −  expenses  =  net profit.
  // Income is attributed via the paying customer's router_id + conn_type; expenses via expenses.router_id.
  profitByRouter: (period) => {
    const pw = period ? " AND substr(pm.paid_at,1,7)=?" : "";
    const pa = period ? [period] : [];
    // income split by router + connection type (pppoe vs ipoe)
    const incomeRows = all(`
      SELECT c.router_id AS rid,
             COALESCE(NULLIF(c.conn_type,''),'pppoe') AS conn,
             COALESCE(SUM(pm.amount),0) AS total
      FROM payments pm
      LEFT JOIN customers c ON c.id=pm.customer_id
      WHERE COALESCE(pm.note,'') NOT LIKE 'Hardware:%'
        AND COALESCE(pm.method,'') <> 'credit'
        AND NOT (COALESCE(pm.method,'')='wallet' AND COALESCE(pm.note,'') NOT LIKE 'Wallet topup:%')
        ${pw}
      GROUP BY c.router_id, conn`, ...pa);
    // vendo coins by router
    let vendoRows = [];
    try {
      const vw = period ? " AND substr(he.at,1,7)=?" : "";
      vendoRows = all(`SELECT v.router_id AS rid, COALESCE(SUM(he.amount),0) AS vendo
        FROM hotspot_events he LEFT JOIN vendos v ON v.name=he.vendo
        WHERE he.type='coin' ${vw} GROUP BY v.router_id`, ...(period ? [period] : []));
    } catch {}
    // expenses by router
    const ew = period ? " AND substr(spent_at,1,7)=?" : "";
    const expenseRows = all(`SELECT router_id AS rid, COALESCE(SUM(amount),0) AS exp
      FROM expenses WHERE 1=1 ${ew} GROUP BY router_id`, ...(period ? [period] : []));
    // build per-router map
    const map = {};
    const routerList = all("SELECT id, name FROM routers ORDER BY name");
    const blank = (id, name) => ({ router_id: id, router_name: name, pppoe: 0, ipoe: 0, vendo: 0, expenses: 0, income: 0, net: 0 });
    for (const r of routerList) map[r.id] = blank(r.id, r.name);
    map["null"] = blank(null, "(no site assigned)");
    const slot = (rid) => { const k = rid == null ? "null" : rid; if (!map[k]) map[k] = blank(rid, "(no site)"); return map[k]; };
    for (const row of incomeRows) {
      const m = slot(row.rid);
      if (String(row.conn) === "ipoe") m.ipoe += Number(row.total || 0); else m.pppoe += Number(row.total || 0);
    }
    for (const vr of vendoRows) slot(vr.rid).vendo += Number(vr.vendo || 0);
    for (const er of expenseRows) slot(er.rid).expenses += Number(er.exp || 0);
    const out = Object.values(map).map((r) => {
      r.income = r.pppoe + r.ipoe + r.vendo;
      r.net = r.income - r.expenses;
      return r;
    }).filter((r) => r.income !== 0 || r.expenses !== 0 || r.router_id != null);
    out.sort((a, b) => b.net - a.net);
    return {
      period: period || "all-time",
      routers: out,
      totals: {
        pppoe: out.reduce((s, r) => s + r.pppoe, 0),
        ipoe: out.reduce((s, r) => s + r.ipoe, 0),
        vendo: out.reduce((s, r) => s + r.vendo, 0),
        income: out.reduce((s, r) => s + r.income, 0),
        expenses: out.reduce((s, r) => s + r.expenses, 0),
        net: out.reduce((s, r) => s + r.net, 0),
      },
    };
  },
  // Revenue split by connection type (IPoE vs PPPoE/hotspot), via the paying customer.
  byConnType: (period) => {
    const rows = all(
      "SELECT COALESCE(NULLIF(c.conn_type,''),'pppoe') conn, COALESCE(SUM(pm.amount),0) total, COUNT(*) n " +
      "FROM payments pm LEFT JOIN customers c ON c.id=pm.customer_id" +
      (period ? " WHERE substr(pm.paid_at,1,7)=?" : "") +
      " GROUP BY 1 ORDER BY total DESC", ...(period ? [period] : []));
    return rows;
  },
  snapshot: () => {
    const active = get("SELECT COUNT(*) c FROM customers WHERE status='active'").c;
    const suspended = get("SELECT COUNT(*) c FROM customers WHERE status='suspended'").c;
    const period = currentPeriod();
    const monthRev = get("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE substr(paid_at,1,7)=?", period).v;
    const planValue = get("SELECT COALESCE(SUM(p.price),0) v FROM customers c JOIN plans p ON p.id=c.plan_id WHERE c.status='active'").v;
    return { active, suspended, monthRevenue: monthRev, planValue, arpu: active ? Math.round(monthRev / active) : 0, period };
  },
};

export const Usage = {
  // rows: [{name, up, down}] of current raw counters. Accumulates deltas into the period,
  // detecting counter resets (cur < last => the counter reset, so the delta is `cur`).
  accumulate: (rows, period) => {
    period = period || currentPeriod();
    let accumulated = 0;
    for (const r of rows || []) {
      const key = String(r.name || "").toLowerCase(); if (!key) continue;
      const curUp = Number(r.up) || 0, curDown = Number(r.down) || 0;
      const live = get("SELECT * FROM usage_live WHERE key=?", key);
      let dUp = 0, dDown = 0;
      if (live) {
        dUp = curUp >= live.last_up ? curUp - live.last_up : curUp;
        dDown = curDown >= live.last_down ? curDown - live.last_down : curDown;
      }
      if (live) run("UPDATE usage_live SET last_up=?, last_down=?, updated_at=datetime('now') WHERE key=?", curUp, curDown, key);
      else run("INSERT INTO usage_live (key,last_up,last_down,updated_at) VALUES (?,?,?,datetime('now'))", key, curUp, curDown);
      if (dUp || dDown) {
        run(`INSERT INTO usage_period (key,period,up,down) VALUES (?,?,?,?)
             ON CONFLICT(key,period) DO UPDATE SET up=up+?, down=down+?`, key, period, dUp, dDown, dUp, dDown);
        accumulated++;
      }
    }
    return { period, updated: (rows || []).length, accumulated };
  },
  forPeriod: (period) => all("SELECT * FROM usage_period WHERE period=?", period || currentPeriod()),
  forKey: (key, period) => get("SELECT * FROM usage_period WHERE key=? AND period=?", String(key).toLowerCase(), period || currentPeriod()),
};

export function exportAll() {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    try { tables[t] = all(`SELECT * FROM ${t}`); } catch { tables[t] = []; }
  }
  return { version: 1, exported_at: new Date().toISOString(), tables };
}
export function importAll(data) {
  if (!data || !data.tables) throw new Error("invalid backup file");
  const counts = {};
  db.exec("BEGIN");
  try {
    for (const t of BACKUP_TABLES) {
      const rows = data.tables[t];
      if (!Array.isArray(rows)) continue;      // only touch tables present in the backup
      db.exec(`DELETE FROM ${t}`);
      for (const row of rows) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        const qs = cols.map(() => "?").join(",");
        run(`INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${qs})`, ...cols.map((c) => row[c]));
      }
      counts[t] = rows.length;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return counts;
}

export const dbFile = DB_FILE;

initHotspotCentral(db);
export const HotspotCentral = HotspotCentralApi(db);
export { hotspotCentralEnabled, uptimeToSecs, mikrotikCentralRadiusScript };

// One-time/idempotent data repair on boot: correct any serialized item on-hand counts that were
// double-counted under the old logic (opening qty + unit add). Safe — only changes wrong values.
try {
  const fixedQty = Inventory.recalcSerializedQty();
  if (fixedQty > 0) console.log("  >> inventory: corrected on-hand for " + fixedQty + " serialized item(s)");
} catch (e) { /* non-fatal */ }
