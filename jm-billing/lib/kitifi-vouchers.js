// KiTifi / hotspot voucher orders — GCash via PayMongo → MikroTik hotspot user.
import crypto from "node:crypto";
import { Settings } from "./db.js";

const DEFAULT_PLANS = [
  { id: "1h", name: "1 Hour WiFi", price: 20, uptime: "1h", profile: "VOUCHER", speed: "4Mbps" },
  { id: "1d", name: "1 Day WiFi", price: 25, uptime: "1d", profile: "VOUCHER", speed: "4Mbps" },
  { id: "3d", name: "3 Days WiFi", price: 50, uptime: "3d", profile: "VOUCHER", speed: "4Mbps" },
  { id: "7d", name: "7 Days WiFi", price: 100, uptime: "7d", profile: "VOUCHER", speed: "4Mbps" },
];

export function kitifiDefaultRouterId() {
  const v = Settings.get("kitifi_router_id", "34");
  return Number(v) || 34;
}

export function kitifiPlans() {
  try {
    const raw = Settings.get("kitifi_plans", "");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {}
  return DEFAULT_PLANS;
}

export function kitifiPlanById(id) {
  return kitifiPlans().find((p) => p.id === id) || null;
}

export function initKitifiOrders(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS kitifi_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  plan_name TEXT,
  amount REAL NOT NULL,
  profile TEXT DEFAULT 'VOUCHER',
  uptime TEXT,
  router_id INTEGER,
  payment_intent_id TEXT,
  gateway_ref TEXT,
  status TEXT DEFAULT 'pending',
  voucher_code TEXT,
  client_mac TEXT,
  client_phone TEXT DEFAULT '',
  seller TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT,
  fulfilled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kitifi_orders_pi ON kitifi_orders(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_kitifi_orders_token ON kitifi_orders(token);
`);
  try { db.exec("ALTER TABLE kitifi_orders ADD COLUMN seller TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE kitifi_orders ADD COLUMN client_phone TEXT DEFAULT ''"); } catch {}
}

export function KitifiOrdersApi(db) {
  initKitifiOrders(db);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  return {
    create({ planId, amount, profile, uptime, routerId, paymentIntentId, clientMac, clientPhone, token: presetToken, seller }) {
      const token = presetToken || crypto.randomBytes(12).toString("hex");
      const plan = kitifiPlanById(planId);
      run(
        `INSERT INTO kitifi_orders (token, plan_id, plan_name, amount, profile, uptime, router_id, payment_intent_id, client_mac, client_phone, seller)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        token, planId, plan?.name || planId, amount, profile || "VOUCHER", uptime || plan?.uptime || "1d",
        routerId || kitifiDefaultRouterId(), paymentIntentId || "", clientMac || "", clientPhone || "",
        seller || Settings.get("kitifi_seller_name", "GCASH Online")
      );
      return get("SELECT * FROM kitifi_orders WHERE token=?", token);
    },

    byToken(token) {
      return get("SELECT * FROM kitifi_orders WHERE token=?", String(token || "").trim());
    },

    byPaymentIntent(pi) {
      return get("SELECT * FROM kitifi_orders WHERE payment_intent_id=?", String(pi || "").trim());
    },

    markPaid(id, gatewayRef) {
      run(
        `UPDATE kitifi_orders SET status='paid', gateway_ref=?, paid_at=datetime('now') WHERE id=? AND status='pending'`,
        gatewayRef || "", id
      );
      return get("SELECT * FROM kitifi_orders WHERE id=?", id);
    },

    markFulfilled(id, voucherCode) {
      run(
        `UPDATE kitifi_orders SET status='ready', voucher_code=?, fulfilled_at=datetime('now') WHERE id=?`,
        voucherCode, id
      );
      return get("SELECT * FROM kitifi_orders WHERE id=?", id);
    },

    markFailed(id, note) {
      run(`UPDATE kitifi_orders SET status='failed' WHERE id=?`, id);
      return get("SELECT * FROM kitifi_orders WHERE id=?", id);
    },

    isGatewayRefUsed(ref) {
      if (!ref) return false;
      return !!get("SELECT id FROM kitifi_orders WHERE gateway_ref=? AND status IN ('paid','ready')", ref);
    },
  };
}
