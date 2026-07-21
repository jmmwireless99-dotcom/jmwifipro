// Central hotspot accounts — nationwide auth without touching MikroTik /ip/hotspot/user.
// MikroTik keeps local user profiles (packages); RADIUS returns profile name only.

import { Settings } from "./db.js";

const run = (db, sql, ...args) => db.prepare(sql).run(...args);
const get = (db, sql, ...args) => db.prepare(sql).get(...args);
const all = (db, sql, ...args) => db.prepare(sql).all(...args);

export function hotspotCentralEnabled() {
  return Settings.get("hotspot_central", "0") === "1";
}

/** Parse MikroTik-style uptime ("1d", "6h", "30m", "1w") to seconds. */
export function uptimeToSecs(uptime) {
  const s = String(uptime || "").trim().toLowerCase();
  if (!s || s === "0" || s === "none") return 0;
  let total = 0;
  const re = /(\d+)\s*([wdhm])/gi;
  let m;
  while ((m = re.exec(s))) {
    const n = Number(m[1]) || 0;
    const u = m[2];
    if (u === "w") total += n * 604800;
    else if (u === "d") total += n * 86400;
    else if (u === "h") total += n * 3600;
    else if (u === "m") total += n * 60;
  }
  if (total > 0) return total;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function secsToUptime(secs) {
  secs = Math.max(0, Math.round(Number(secs) || 0));
  if (!secs) return "";
  if (secs >= 86400 && secs % 86400 === 0) return `${secs / 86400}d`;
  if (secs >= 3600 && secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs >= 60 && secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}

export function initHotspotCentral(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS hotspot_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE,
  password TEXT DEFAULT '',
  profile TEXT DEFAULT 'default',
  remaining_secs INTEGER DEFAULT 0,
  limit_secs INTEGER DEFAULT 0,
  sold_router_id INTEGER,
  source TEXT DEFAULT 'voucher',
  disabled INTEGER DEFAULT 0,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_login_at TEXT,
  last_nas TEXT,
  note TEXT DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hotspot_accounts_user ON hotspot_accounts(username);
`);
  try { db.exec("ALTER TABLE hotspot_accounts ADD COLUMN acct_session_secs INTEGER DEFAULT 0"); } catch {}
}

export function HotspotCentralApi(db) {
  initHotspotCentral(db);

  return {
    create({ username, password = "", profile = "default", limitSecs = 0, source = "voucher", routerId = null, note = "" }) {
      const user = String(username || "").trim();
      if (!user) throw new Error("Username required.");
      const lim = Math.max(0, Math.round(Number(limitSecs) || 0));
      const rem = lim;
      run(
        db,
        `INSERT INTO hotspot_accounts (username,password,profile,remaining_secs,limit_secs,sold_router_id,source,note,updated_at)
         VALUES (?,?,?,?,?,?,?,?,datetime('now'))`,
        user, String(password || ""), String(profile || "default"), rem, lim, routerId || null, source || "voucher", note || ""
      );
      return get(db, "SELECT * FROM hotspot_accounts WHERE username=? COLLATE NOCASE", user);
    },

    get(username) {
      return get(db, "SELECT * FROM hotspot_accounts WHERE username=? COLLATE NOCASE AND disabled=0", String(username || "").trim());
    },

    list(limit = 200) {
      return all(db, "SELECT * FROM hotspot_accounts ORDER BY id DESC LIMIT ?", Number(limit) || 200);
    },

    /** Auth for RADIUS — password optional for user-only vouchers. */
    authenticate({ username, password = "", chapOk = false }) {
      const row = this.get(username);
      if (!row) return { ok: false, reason: "unknown", message: "Unknown user" };
      if (row.remaining_secs <= 0) return { ok: false, reason: "expired", message: "Time expired" };
      const pass = String(password || "");
      const stored = String(row.password || "");
      if (!chapOk && stored && stored !== pass) {
        return { ok: false, reason: "bad_password", message: "Bad password", storedPassword: stored };
      }
      run(db, "UPDATE hotspot_accounts SET last_login_at=datetime('now'), updated_at=datetime('now') WHERE id=?", row.id);
      return { ok: true, profile: row.profile || "default", remainingSecs: row.remaining_secs, row };
    },

    /** RADIUS accounting — only connected time burns (delta from cumulative Session-Time). */
    accounting({ username, sessionSecs = 0, acctStatus = 0, nas = "" }) {
      const row = this.get(username);
      if (!row) return { ok: false };
      const status = Number(acctStatus) || 0;
      const session = Math.max(0, Math.round(Number(sessionSecs) || 0));
      let lastAcct = Math.max(0, Number(row.acct_session_secs) || 0);
      let rem = Math.max(0, Number(row.remaining_secs) || 0);

      if (status === 1) {
        lastAcct = 0;
      } else if (status === 2 || status === 3) {
        const delta = Math.max(0, session - lastAcct);
        if (delta) rem = Math.max(0, rem - delta);
        lastAcct = status === 2 ? 0 : session;
      }

      run(
        db,
        "UPDATE hotspot_accounts SET remaining_secs=?, acct_session_secs=?, last_nas=?, updated_at=datetime('now') WHERE id=?",
        rem, lastAcct, nas || row.last_nas || "", row.id
      );
      if (rem <= 0) run(db, "UPDATE hotspot_accounts SET disabled=1 WHERE id=?", row.id);
      return { ok: true, remainingSecs: rem, paused: rem > 0 && lastAcct <= 0, connected: lastAcct > 0 };
    },

    /** Read-only copy from router user list — does NOT change MikroTik. */
    importUser({ username, password = "", profile = "default", limitSecs = 0, routerId = null, note = "" }) {
      const user = String(username || "").trim();
      if (!user) return { skipped: true };
      const exists = get(db, "SELECT id FROM hotspot_accounts WHERE username=? COLLATE NOCASE", user);
      if (exists) return { skipped: true, reason: "exists" };
      return { created: this.create({ username: user, password, profile, limitSecs, source: "import", routerId, note }) };
    },

    stats() {
      const total = get(db, "SELECT COUNT(*) n FROM hotspot_accounts");
      const active = get(db, "SELECT COUNT(*) n FROM hotspot_accounts WHERE disabled=0 AND remaining_secs>0");
      return { total: total?.n || 0, active: active?.n || 0 };
    },
  };
}

/** MikroTik commands: add RADIUS only — do NOT remove local users or user profiles. */
export function mikrotikCentralRadiusScript({ radiusHost, secret, authPort = 1812, acctPort = 1813 }) {
  const host = radiusHost || "10.0.0.1";
  const sec = secret || "jmwifi-radius";
  return [
    "# === JM WIFI central hotspot (safe — keeps existing users & packages) ===",
    "# Adds RADIUS auth. Existing /ip/hotspot/user entries are NOT deleted.",
    "# Existing /ip/hotspot/user/profile (packages) are NOT changed.",
    "",
    `/radius add address=${host} secret="${sec}" authentication-port=${authPort} accounting-port=${acctPort} service=hotspot comment="JM central"`,
    "",
    "# Enable RADIUS on each hotspot SERVER profile (login settings — not user packages):",
    `/ip hotspot profile set [find] use-radius=yes radius-accounting=yes radius-interim-update=5m`,
    "",
    "# Optional: if RADIUS is unreachable, local users still work:",
    `# /ip hotspot profile set [find] radius-local=always`,
    "",
    "# Verify:",
    "/radius print",
    "/ip hotspot profile print",
  ].join("\n");
}
