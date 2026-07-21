import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { loadEnv } from "./env.js";

loadEnv();

const DB_FILE = process.env.DB_FILE || path.resolve(process.cwd(), "billing.db");
const db = new DatabaseSync(DB_FILE);

db.exec(`
CREATE TABLE IF NOT EXISTS voucher_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  plan_name TEXT DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  code TEXT DEFAULT '',
  password TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  payment_ref TEXT DEFAULT '',
  payment_intent_id TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  limit_uptime TEXT DEFAULT '',
  profile TEXT DEFAULT 'default',
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT DEFAULT '',
  issued_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_voucher_orders_pi ON voucher_orders(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_voucher_orders_ref ON voucher_orders(payment_ref);
`);
try { db.exec("ALTER TABLE voucher_orders ADD COLUMN total_seconds INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE voucher_orders ADD COLUMN used_seconds INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE voucher_orders ADD COLUMN acct_session_secs INTEGER DEFAULT 0"); } catch {}

function row(r) {
  if (!r) return null;
  return { ...r, amount: Number(r.amount) || 0 };
}

export const VoucherOrders = {
  create({ plan_id, plan_name, amount, payment_intent_id = "", contact = "", limit_uptime = "", profile = "default" }) {
    const r = db.prepare(
      `INSERT INTO voucher_orders (plan_id, plan_name, amount, payment_intent_id, contact, limit_uptime, profile)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(plan_id, plan_name, amount, payment_intent_id, contact, limit_uptime, profile);
    return row(r);
  },
  get(id) {
    return row(db.prepare("SELECT * FROM voucher_orders WHERE id = ?").get(id));
  },
  byCode(code) {
    if (!code) return null;
    return row(db.prepare("SELECT * FROM voucher_orders WHERE UPPER(code) = UPPER(?) LIMIT 1").get(String(code).trim()));
  },
  byPaymentIntent(pi) {
    if (!pi) return null;
    return row(db.prepare("SELECT * FROM voucher_orders WHERE payment_intent_id = ? ORDER BY id DESC LIMIT 1").get(pi));
  },
  byPaymentRef(ref) {
    if (!ref) return null;
    return row(db.prepare("SELECT * FROM voucher_orders WHERE payment_ref = ? ORDER BY id DESC LIMIT 1").get(ref));
  },
  setPaymentIntent(id, pi) {
    db.prepare("UPDATE voucher_orders SET payment_intent_id = ? WHERE id = ?").run(pi, id);
  },
  setPaid(id, ref) {
    db.prepare("UPDATE voucher_orders SET status = 'paid', payment_ref = ?, paid_at = datetime('now') WHERE id = ? AND status = 'pending'").run(ref || "", id);
    return this.get(id);
  },
  setIssued(id, code, password, totalSeconds = 0) {
    db.prepare(
      `UPDATE voucher_orders SET status = 'issued', code = ?, password = ?, issued_at = datetime('now'),
       total_seconds = CASE WHEN ? > 0 THEN ? ELSE COALESCE(total_seconds, 0) END,
       used_seconds = COALESCE(used_seconds, 0)
       WHERE id = ?`
    ).run(code, password, totalSeconds, totalSeconds, id);
    return this.get(id);
  },
  setFailed(id, detail) {
    db.prepare("UPDATE voucher_orders SET status = 'failed' WHERE id = ?").run(id);
    return this.get(id);
  },
  isFulfilled(id) {
    const o = this.get(id);
    return o && (o.status === "issued" || o.status === "failed");
  },
  uptimeToSecs(u) {
    const x = String(u || "1h").trim().toLowerCase();
    let m = x.match(/^([0-9]+)d$/);
    if (m) return Number(m[1]) * 86400;
    m = x.match(/^([0-9]+)h$/);
    if (m) return Number(m[1]) * 3600;
    m = x.match(/^([0-9]+)m$/);
    if (m) return Number(m[1]) * 60;
    if (/^[0-9]+$/.test(x)) return Number(x);
    return 3600;
  },
  totalSeconds(order) {
    const t = Number(order && order.total_seconds) || 0;
    if (t > 0) return t;
    return this.uptimeToSecs(order && order.limit_uptime);
  },
  secsLabel(secs) {
    const s = Math.max(0, Number(secs) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m) return `${m}m ${String(sec).padStart(2, "0")}s`;
    return `${sec}s`;
  },
  listActiveForRadius() {
    return db.prepare("SELECT code, password FROM voucher_orders WHERE status = 'issued' AND code <> '' ORDER BY id DESC LIMIT 5000").all();
  },
  enrich(order) {
    if (!order) return null;
    const total = this.totalSeconds(order);
    const used = Math.max(0, Number(order.used_seconds) || 0);
    const remaining = Math.max(0, total - used);
    const acctSess = Math.max(0, Number(order.acct_session_secs) || 0);
    return {
      ...order,
      total_seconds: total,
      used_seconds: used,
      remaining_seconds: remaining,
      remaining_label: this.secsLabel(remaining),
      exhausted: remaining <= 0 && total > 0,
      connected: acctSess > 0,
      paused: remaining > 0 && acctSess <= 0,
    };
  },
  /** RADIUS Access-Request — voucher code is username. */
  authenticate({ username, password = "", chapOk = false }) {
    const order = this.byCode(username);
    if (!order || order.status !== "issued") {
      return { ok: false, reason: "unknown", message: "Unknown voucher" };
    }
    const e = this.enrich(order);
    if (e.exhausted) return { ok: false, reason: "expired", message: "Voucher time used up" };
    const stored = String(order.password || order.code || "");
    const pass = String(password || "");
    if (!chapOk && stored && stored !== pass) {
      return { ok: false, reason: "bad_password", message: "Bad password", storedPassword: stored };
    }
    return {
      ok: true,
      profile: order.profile || "Cloud-server",
      remainingSecs: e.remaining_seconds || 3600,
    };
  },
  /**
   * RADIUS accounting — only connected time burns (Kitifi-style pause on disconnect).
   * Acct-Status: 1=Start, 2=Stop, 3=Interim. Session-Time is cumulative for current session.
   */
  applyAccounting({ username, sessionSecs = 0, acctStatus = 0, nas = "" }) {
    const order = this.byCode(username);
    if (!order || order.status !== "issued") return { ok: false };
    const status = Number(acctStatus) || 0;
    const session = Math.max(0, Math.round(Number(sessionSecs) || 0));
    let lastAcct = Math.max(0, Number(order.acct_session_secs) || 0);
    let used = Math.max(0, Number(order.used_seconds) || 0);
    const total = this.totalSeconds(order);

    if (status === 1) {
      lastAcct = 0;
    } else if (status === 2 || status === 3) {
      const delta = Math.max(0, session - lastAcct);
      if (delta) used = Math.min(total, used + delta);
      lastAcct = status === 2 ? 0 : session;
    }

    let st = order.status;
    if (total > 0 && used >= total) st = "exhausted";
    db.prepare(
      "UPDATE voucher_orders SET used_seconds = ?, acct_session_secs = ?, status = ? WHERE id = ?"
    ).run(used, lastAcct, st, order.id);

    const remaining = Math.max(0, total - used);
    return {
      ok: true,
      remaining_seconds: remaining,
      connected: lastAcct > 0,
      paused: remaining > 0 && lastAcct <= 0,
      nas,
    };
  },
  list({ q = "", status = "", limit = 500 } = {}) {
    const lim = Math.min(Math.max(1, Number(limit) || 500), 5000);
    let sql = "SELECT * FROM voucher_orders WHERE 1=1";
    const args = [];
    if (status) { sql += " AND status = ?"; args.push(String(status)); }
    if (q) {
      const like = "%" + String(q).trim() + "%";
      sql += " AND (code LIKE ? OR contact LIKE ? OR plan_name LIKE ? OR payment_ref LIKE ?)";
      args.push(like, like, like, like);
    }
    sql += " ORDER BY id DESC LIMIT ?";
    args.push(lim);
    return db.prepare(sql).all(...args).map((r) => this.enrich(row(r)));
  },
  update(id, fields = {}) {
    const o = this.get(id);
    if (!o) return null;
    const contact = fields.contact != null ? String(fields.contact) : o.contact;
    const profile = fields.profile != null ? String(fields.profile) : o.profile;
    const plan_name = fields.plan_name != null ? String(fields.plan_name) : o.plan_name;
    let status = fields.status != null ? String(fields.status) : o.status;
    if (status === "active") status = "issued";
    db.prepare(
      "UPDATE voucher_orders SET contact = ?, profile = ?, plan_name = ?, status = ? WHERE id = ?"
    ).run(contact, profile, plan_name, status, id);
    const next = this.get(id);
    const total = this.totalSeconds(next);
    const used = Math.max(0, Number(next.used_seconds) || 0);
    if (next.status === "exhausted" && total > used) {
      db.prepare("UPDATE voucher_orders SET status = 'issued' WHERE id = ?").run(id);
    }
    return this.enrich(this.get(id));
  },
  adjustTime(id, { add_seconds = 0, deduct_seconds = 0 } = {}) {
    const o = this.get(id);
    if (!o) return null;
    let total = this.totalSeconds(o);
    let used = Math.max(0, Number(o.used_seconds) || 0);
    const add = Math.max(0, Number(add_seconds) || 0);
    const deduct = Math.max(0, Number(deduct_seconds) || 0);
    if (add) total += add;
    if (deduct) used = Math.min(total, used + deduct);
    let status = o.status;
    if (total > used && (status === "exhausted" || status === "issued")) status = "issued";
    if (total > 0 && used >= total) status = "exhausted";
    db.prepare(
      "UPDATE voucher_orders SET total_seconds = ?, used_seconds = ?, status = ? WHERE id = ?"
    ).run(total, used, status, id);
    return this.enrich(this.get(id));
  },
  remove(id) {
    const o = this.get(id);
    if (!o) return null;
    db.prepare("DELETE FROM voucher_orders WHERE id = ?").run(id);
    return o;
  },
};
