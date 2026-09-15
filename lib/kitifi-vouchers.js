// KiTifi / hotspot voucher orders — GCash via PayMongo → MikroTik hotspot user.
import crypto from "node:crypto";
import { Settings } from "./db.js";

const DEFAULT_PLANS = [
  { id: "1h", name: "1 Hour WiFi", price: 20, uptime: "1h", profile: "VOUCHER", speed: "4Mbps" },
  { id: "1d", name: "1 Day WiFi", price: 25, uptime: "1d", profile: "VOUCHER", speed: "4Mbps" },
  { id: "3d", name: "3 Days WiFi", price: 50, uptime: "3d", profile: "VOUCHER", speed: "4Mbps" },
  { id: "7d", name: "7 Days WiFi", price: 100, uptime: "7d", profile: "VOUCHER", speed: "4Mbps" },
];

/** GCash buy plans: ₱20 = 10h, ₱30 = 15h, walang validity (N/A). */
export function kitifiGcashPlans(profile = "KITIFI") {
  return [
    {
      id: "r4",
      name: "10 Hours",
      price: 20,
      uptime: "10 Hours",
      time: "10 Hours",
      expiry: "N/A",
      pause_limit: "0",
      label: "₱ 20 | 10 Hours | N/A | 0",
      amount_display: "₱ 20",
      profile,
      kitifi_rate_id: "4",
      r_id: "4",
      speed: "4Mbps",
    },
    {
      id: "r5",
      name: "15 Hours",
      price: 30,
      uptime: "15 Hours",
      time: "15 Hours",
      expiry: "N/A",
      pause_limit: "0",
      label: "₱ 30 | 15 Hours | N/A | 0",
      amount_display: "₱ 30",
      profile,
      kitifi_rate_id: "5",
      r_id: "5",
      speed: "4Mbps",
    },
  ];
}

export function kitifiDefaultRouterId() {
  const v = Settings.get("kitifi_router_id", "37");
  return Number(v) || 34;
}

/** MikroTik site that serves the KiTifi captive portal (GCash buy → generate). */
export function kitifiPortalRouterId(explicitId) {
  if (explicitId != null && explicitId !== "") {
    const n = Number(explicitId);
    if (n) return n;
  }
  const v = Settings.get("kitifi_portal_router_id", Settings.get("kitifi_router_id", "34"));
  return Number(v) || 34;
}

export function kitifiPortalSites() {
  try {
    const raw = Settings.get("kitifi_portal_sites", "");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {}
  return {
    "34": { name: "Candelaria-kitifi", label: "Candelaria" },
    "37": { name: "4rth-server", label: "4rth-server" },
  };
}


/** MikroTik router ids that can bridge to KiTifi admin (10.0.0.10) on their LAN. */
export function kitifiBridgeRouterIds(allRouters = []) {
  const ids = new Set();
  for (const [id, meta] of Object.entries(kitifiPortalSites())) {
    const n = Number(id);
    if (n && meta?.enabled !== false) ids.add(n);
  }
  // Also include routers with explicit KiTifi billing config (even if not in portal_sites yet).
  for (const r of allRouters || []) {
    const rid = Number(r.id);
    if (!rid || ids.has(rid)) continue;
    if (Settings.get("kitifi_plans_" + rid, "") || Settings.get("kitifi_hotspot_login_" + rid, "")) {
      ids.add(rid);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/** Router rows from billing DB limited to KiTifi bridge sites. */
export function kitifiBridgeRouters(allRouters = []) {
  const ids = new Set(kitifiBridgeRouterIds(allRouters));
  return (allRouters || []).filter((r) => ids.has(Number(r.id)));
}

export function kitifiPlans(routerId) {
  const rid = routerId != null && routerId !== "" ? String(routerId) : "";
  if (rid) {
    try {
      const raw = Settings.get("kitifi_plans_" + rid, "");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {}
  }
  try {
    const raw = Settings.get("kitifi_plans", "");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {}
  return DEFAULT_PLANS;
}

export function kitifiPlanById(id, routerId) {
  return kitifiPlans(routerId).find((p) => p.id === id) || null;
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
  fulfilled_at TEXT,
  kitifi_batch TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_kitifi_orders_pi ON kitifi_orders(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_kitifi_orders_token ON kitifi_orders(token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kitifi_orders_pay_ready ON kitifi_orders(gateway_ref)
  WHERE status='ready' AND TRIM(COALESCE(gateway_ref,''))!='';
`);
  try { db.exec("ALTER TABLE kitifi_orders ADD COLUMN seller TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE kitifi_orders ADD COLUMN client_phone TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE kitifi_orders ADD COLUMN kitifi_batch TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE kitifi_orders ADD COLUMN autoconnected INTEGER DEFAULT 0"); } catch {}
}

export function KitifiOrdersApi(db) {
  initKitifiOrders(db);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  return {
    create({ planId, amount, profile, uptime, routerId, paymentIntentId, clientMac, clientPhone, token: presetToken, seller }) {
      const token = presetToken || crypto.randomBytes(12).toString("hex");
      const plan = kitifiPlanById(planId, routerId);
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

    readyByPaymentIntent(pi, excludeToken = "") {
      const ref = String(pi || "").trim();
      if (!ref) return null;
      if (excludeToken) {
        return get(
          "SELECT * FROM kitifi_orders WHERE payment_intent_id=? AND status='ready' AND token<>?",
          ref, String(excludeToken)
        );
      }
      return get("SELECT * FROM kitifi_orders WHERE payment_intent_id=? AND status='ready'", ref);
    },

    readyByGatewayRef(ref, excludeToken = "") {
      const g = String(ref || "").trim();
      if (!g) return null;
      if (excludeToken) {
        return get(
          "SELECT * FROM kitifi_orders WHERE gateway_ref=? AND status='ready' AND token<>?",
          g, String(excludeToken)
        );
      }
      return get("SELECT * FROM kitifi_orders WHERE gateway_ref=? AND status='ready'", g);
    },

    saveBatch(id, batch) {
      run("UPDATE kitifi_orders SET kitifi_batch=? WHERE id=?", String(batch || ""), id);
    },

    markPaid(id, gatewayRef) {
      run(
        `UPDATE kitifi_orders SET status='paid', gateway_ref=?, paid_at=datetime('now') WHERE id=? AND status='pending'`,
        gatewayRef || "", id
      );
      return get("SELECT * FROM kitifi_orders WHERE id=?", id);
    },

    /**
     * Atomic claim so webhook + status-poll cannot both call KiTifi generate.
     * Returns true only for the first caller (pending/paid → generating).
     */
    tryClaimFulfill(id, gatewayRef) {
      const ref = gatewayRef || "";
      const r = run(
        `UPDATE kitifi_orders
         SET status='generating',
             gateway_ref=CASE WHEN TRIM(COALESCE(gateway_ref,''))='' THEN ? ELSE gateway_ref END,
             paid_at=COALESCE(paid_at, datetime('now'))
         WHERE id=? AND status IN ('pending','paid')`,
        ref, id
      );
      return (r?.changes || 0) === 1;
    },

    markFulfilled(id, voucherCode, gatewayRef) {
      const ref = gatewayRef != null ? String(gatewayRef).trim() : "";
      if (ref) {
        run(
          `UPDATE kitifi_orders SET status='ready', voucher_code=?, fulfilled_at=datetime('now'),
           gateway_ref=CASE WHEN TRIM(COALESCE(gateway_ref,''))='' THEN ? ELSE gateway_ref END
           WHERE id=? AND status IN ('generating','paid')`,
          voucherCode, ref, id
        );
      } else {
        run(
          `UPDATE kitifi_orders SET status='ready', voucher_code=?, fulfilled_at=datetime('now') WHERE id=? AND status IN ('generating','paid')`,
          voucherCode, id
        );
      }
      return get("SELECT * FROM kitifi_orders WHERE id=?", id);
    },

    markFailed(id, note) {
      run(`UPDATE kitifi_orders SET status='failed' WHERE id=? AND status IN ('generating','paid','pending')`, id);
      return get("SELECT * FROM kitifi_orders WHERE id=?", id);
    },

    markAutoconnected(id) {
      try { run("UPDATE kitifi_orders SET autoconnected=1 WHERE id=?", id); } catch {}
      return get("SELECT * FROM kitifi_orders WHERE id=?", id);
    },

    pendingRecent(seconds = 1200, limit = 40) {
      const sec = Math.max(60, Number(seconds) || 1200);
      const lim = Math.min(80, Math.max(1, Number(limit) || 40));
      return all(
        `SELECT * FROM kitifi_orders
         WHERE status IN ('pending','paid')
           AND TRIM(COALESCE(payment_intent_id,'')) != ''
           AND created_at >= datetime('now', ?)
         ORDER BY id DESC LIMIT ?`,
        "-" + sec + " seconds",
        lim
      );
    },

    /** Ready vouchers that still need MikroTik MAC login (portal tab may already be closed). */
    readyUnconnectedRecent(seconds = 900, limit = 20) {
      const sec = Math.max(60, Number(seconds) || 900);
      const lim = Math.min(40, Math.max(1, Number(limit) || 20));
      return all(
        `SELECT * FROM kitifi_orders
         WHERE status='ready'
           AND TRIM(COALESCE(voucher_code,'')) != ''
           AND TRIM(COALESCE(client_mac,'')) != ''
           AND COALESCE(autoconnected,0)=0
           AND COALESCE(fulfilled_at, paid_at, created_at) >= datetime('now', ?)
         ORDER BY id DESC LIMIT ?`,
        "-" + sec + " seconds",
        lim
      );
    },

    resetStuckGenerating(seconds = 120) {
      const sec = Math.max(30, Number(seconds) || 120);
      const r = run(
        `UPDATE kitifi_orders SET status='paid'
         WHERE status='generating'
           AND created_at >= datetime('now', '-1 day')
           AND COALESCE(paid_at, created_at) <= datetime('now', ?)`,
        "-" + sec + " seconds"
      );
      return r?.changes || 0;
    },

    isGatewayRefUsed(ref) {
      if (!ref) return false;
      return !!get("SELECT id FROM kitifi_orders WHERE gateway_ref=? AND status IN ('paid','generating','ready')", ref);
    },

    /** Fulfilled KiTifi voucher GCash sales (status=ready). */
    list({ q = "", routerId = null, status = "ready", period = null, limit = 200 } = {}) {
      const like = "%" + String(q || "").trim() + "%";
      const rid = routerId != null && routerId !== "" ? Number(routerId) : null;
      const st = String(status || "ready").trim();
      const lim = Math.min(500, Math.max(1, Number(limit) || 200));
      let sql = `
        SELECT o.*, r.name AS router_name
        FROM kitifi_orders o
        LEFT JOIN routers r ON r.id = o.router_id
        WHERE 1=1`;
      const args = [];
      if (st && st !== "all") { sql += " AND o.status=?"; args.push(st); }
      if (rid) { sql += " AND o.router_id=?"; args.push(rid); }
      if (period) {
        sql += " AND substr(COALESCE(o.fulfilled_at, o.paid_at, o.created_at), 1, 7)=?";
        args.push(String(period));
      }
      if (String(q || "").trim()) {
        sql += " AND (o.plan_name LIKE ? OR o.voucher_code LIKE ? OR o.client_mac LIKE ? OR o.gateway_ref LIKE ? OR o.payment_intent_id LIKE ? OR r.name LIKE ?)";
        args.push(like, like, like, like, like, like);
      }
      sql += " ORDER BY COALESCE(o.fulfilled_at, o.paid_at, o.created_at) DESC, o.id DESC LIMIT ?";
      args.push(lim);
      return all(sql, ...args);
    },

    salesSeries(range = "monthly", routerId = null) {
      const rid = routerId != null && routerId !== "" ? Number(routerId) : null;
      const rows = rid
        ? all(
            `SELECT COALESCE(fulfilled_at, paid_at, created_at) AS sale_at, amount
             FROM kitifi_orders WHERE status='ready' AND router_id=?`,
            rid
          )
        : all(
            `SELECT COALESCE(fulfilled_at, paid_at, created_at) AS sale_at, amount
             FROM kitifi_orders WHERE status='ready'`
          );
      return kitifiSeriesFrom(rows, range, "sale_at");
    },

    salesStats(routerId = null) {
      const rid = routerId != null && routerId !== "" ? Number(routerId) : null;
      const base = rid ? " WHERE router_id=?" : "";
      const args = rid ? [rid] : [];
      const ready = get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM kitifi_orders${base}${base ? " AND" : " WHERE"} status='ready'`, ...args);
      const today = get(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM kitifi_orders
         WHERE status='ready' AND date(COALESCE(fulfilled_at, paid_at, created_at))=date('now')${rid ? " AND router_id=?" : ""}`,
        ...(rid ? [rid] : [])
      );
      const month = get(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM kitifi_orders
         WHERE status='ready' AND substr(COALESCE(fulfilled_at, paid_at, created_at),1,7)=strftime('%Y-%m','now')${rid ? " AND router_id=?" : ""}`,
        ...(rid ? [rid] : [])
      );
      return {
        ready_count: Number(ready?.n || 0),
        ready_total: Number(ready?.s || 0),
        today_count: Number(today?.n || 0),
        today_total: Number(today?.s || 0),
        month_count: Number(month?.n || 0),
        month_total: Number(month?.s || 0),
      };
    },
  };
}

function kitifiGenLabels(range) {
  const out = [], now = new Date();
  if (range === "yearly") {
    const y = now.getFullYear();
    for (let i = 5; i >= 0; i--) out.push(String(y - i));
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(d.toISOString().slice(0, 7));
    }
  }
  return out;
}

function kitifiSeriesFrom(rows, range, field) {
  const keyOf = (s) => (range === "yearly" ? s.slice(0, 4) : s.slice(0, 7));
  const sums = {};
  for (const r of rows) {
    if (!r[field]) continue;
    const k = keyOf(String(r[field]));
    sums[k] = (sums[k] || 0) + Number(r.amount || 0);
  }
  const labels = kitifiGenLabels(range);
  const series = labels.map((l) => ({ label: l, amount: sums[l] || 0 }));
  return { range, series, total: series.reduce((s, x) => s + x.amount, 0) };
}
