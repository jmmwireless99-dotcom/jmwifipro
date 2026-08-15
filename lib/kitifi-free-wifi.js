import { Settings } from "./db.js";
import { kitifiPortalRouterId } from "./kitifi-vouchers.js";
import {
  kitifiBuildGenerateOpts,
  kitifiGenerateBatch,
  kitifiConnectUrl,
  kitifiOrderConnectUrl,
  kitifiMikrotikVoucherConnect,
  kitifiHotspotLoginBase,
  kitifiUptimeToMikrotik,
} from "./kitifi-server.js";
import { kitifiGenSellerId, kitifiGenProfile } from "./kitifi-remote.js";
import { genVoucherCode } from "./hotspot-generator.js";

export function normalizeMac(mac) {
  const raw = String(mac || "").trim().toUpperCase().replace(/[^0-9A-F]/g, "");
  if (raw.length !== 12) return "";
  return raw.match(/.{1,2}/g).join(":");
}

export function kitifiFreeMode(routerId) {
  const rid = Number(routerId) || kitifiPortalRouterId();
  const per = String(Settings.get("kitifi_free_mode_" + rid, "") || "").trim().toLowerCase();
  if (per === "mikrotik" || per === "kitifi") return per;
  const list = String(Settings.get("kitifi_free_mikrotik_routers", "51") || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter(Boolean);
  return list.includes(rid) ? "mikrotik" : "kitifi";
}

export function kitifiFreeSettings(routerId) {
  const rid = Number(routerId) || kitifiPortalRouterId();
  const rateId = String(Settings.get("kitifi_free_rate_id_" + rid, Settings.get("kitifi_free_rate_id", "6")) || "6");
  const rateTime = String(
    Settings.get("kitifi_free_rate_time_" + rid, Settings.get("kitifi_free_rate_time", "5hr. 12min.")) || "5hr. 12min."
  );
  return {
    enabled: Settings.get("kitifi_free_enabled", "1") === "1",
    hours: Math.max(0.25, Number(Settings.get("kitifi_free_hours", "5")) || 5),
    limit_per_day: Math.max(
      1,
      Number(
        Settings.get("kitifi_free_limit_per_day_" + rid, "") ||
          Settings.get("kitifi_free_limit_per_day", "1")
      ) || 1
    ),
    router_id: rid,
    default_barangay: Settings.get("kitifi_free_default_barangay_" + rid, Settings.get("kitifi_free_default_barangay", "Candelaria")),
    default_municipal: Settings.get("kitifi_free_default_municipal_" + rid, Settings.get("kitifi_free_default_municipal", "Uson")),
    default_province: Settings.get("kitifi_free_default_province_" + rid, Settings.get("kitifi_free_default_province", "Masbate")),
    rate_id: rateId,
    rate_time: rateTime,
    seller_id: kitifiGenSellerId(rid),
    seller_name: Settings.get("kitifi_gen_seller_name_" + rid, Settings.get("kitifi_gen_seller_name", "VOUCHER-for-FREE")),
    profile: Settings.get("kitifi_free_profile_" + rid, Settings.get("kitifi_free_profile", kitifiGenProfile())),
    mode: kitifiFreeMode(rid),
  };
}

export function saveKitifiFreeSettings(patch = {}) {
  const ups = {};
  if (patch.enabled != null) ups.kitifi_free_enabled = patch.enabled ? "1" : "0";
  if (patch.hours != null) ups.kitifi_free_hours = String(Math.max(0.25, Number(patch.hours) || 1));
  if (patch.limit_per_day != null) {
    const n = String(Math.max(1, Number(patch.limit_per_day) || 1));
    if (patch.router_id != null) ups["kitifi_free_limit_per_day_" + Number(patch.router_id)] = n;
    else ups.kitifi_free_limit_per_day = n;
  }
  if (patch.default_barangay != null) ups.kitifi_free_default_barangay = String(patch.default_barangay || "").trim();
  if (patch.default_municipal != null) ups.kitifi_free_default_municipal = String(patch.default_municipal || "").trim();
  if (patch.default_province != null) ups.kitifi_free_default_province = String(patch.default_province || "").trim();
  if (patch.profile != null) ups.kitifi_free_profile = String(patch.profile || "KITIFI").trim();
  if (patch.router_id != null) ups.kitifi_free_router_id = String(Number(patch.router_id) || 34);
  if (patch.rate_id != null && patch.router_id != null) {
    ups["kitifi_free_rate_id_" + Number(patch.router_id)] = String(patch.rate_id || "");
  } else if (patch.rate_id != null) {
    ups.kitifi_free_rate_id = String(patch.rate_id || "");
  }
  if (patch.rate_time != null && patch.router_id != null) {
    ups["kitifi_free_rate_time_" + Number(patch.router_id)] = String(patch.rate_time || "").trim();
  } else if (patch.rate_time != null) {
    ups.kitifi_free_rate_time = String(patch.rate_time || "").trim();
  }
  if (Object.keys(ups).length) Settings.setMany(ups);
  return kitifiFreeSettings(patch.router_id);
}

function uptimeLabel(hours) {
  const h = Number(hours) || 1;
  if (h < 1) return Math.round(h * 60) + " Minutes";
  if (Number.isInteger(h)) return h + (h === 1 ? " Hour" : " Hours");
  return h + " Hours";
}

function fullName(first, last, fallback = "") {
  const f = String(first || "").trim();
  const l = String(last || "").trim();
  const combined = [f, l].filter(Boolean).join(" ").trim();
  return combined || String(fallback || "").trim();
}

function migrateKitifiFreeColumns(db) {
  for (const sql of [
    "ALTER TABLE kitifi_free_clients ADD COLUMN last_name TEXT DEFAULT ''",
    "ALTER TABLE kitifi_free_clients ADD COLUMN cp_number TEXT DEFAULT ''",
    "ALTER TABLE kitifi_free_clients ADD COLUMN province TEXT DEFAULT ''",
  ]) {
    try { db.exec(sql); } catch {}
  }
}

export function initKitifiFreeClients(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS kitifi_free_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  last_name TEXT DEFAULT '',
  dob TEXT DEFAULT '',
  cp_number TEXT DEFAULT '',
  purok TEXT DEFAULT '',
  barangay TEXT DEFAULT '',
  municipal TEXT DEFAULT '',
  province TEXT DEFAULT '',
  mac TEXT NOT NULL,
  router_id INTEGER NOT NULL DEFAULT 34,
  registered_at TEXT DEFAULT (datetime('now')),
  last_claim_at TEXT,
  claim_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kitifi_free_mac_router ON kitifi_free_clients(mac, router_id);
CREATE TABLE IF NOT EXISTS kitifi_free_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  mac TEXT NOT NULL,
  router_id INTEGER,
  voucher_code TEXT DEFAULT '',
  uptime TEXT DEFAULT '',
  claimed_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kitifi_free_claims_mac_day ON kitifi_free_claims(mac, router_id, claimed_at);
`);
  migrateKitifiFreeColumns(db);
}

export function KitifiFreeClientsApi(db) {
  initKitifiFreeClients(db);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  function byMac(mac, routerId) {
    const m = normalizeMac(mac);
    if (!m) return null;
    return get("SELECT * FROM kitifi_free_clients WHERE mac=? AND router_id=?", m, Number(routerId) || kitifiPortalRouterId());
  }

  function claimsToday(mac, routerId) {
    const m = normalizeMac(mac);
    return Number(get(
      `SELECT COUNT(*) AS n FROM kitifi_free_claims
       WHERE mac=? AND router_id=? AND date(claimed_at, '+8 hours')=date('now', '+8 hours')`,
      m, Number(routerId)
    )?.n || 0);
  }

  function clientPayload(client) {
    if (!client) return null;
    return {
      id: client.id,
      name: client.name,
      last_name: client.last_name || "",
      dob: client.dob,
      cp_number: client.cp_number || "",
      purok: client.purok,
      barangay: client.barangay,
      municipal: client.municipal,
      province: client.province || "",
      mac: client.mac,
      registered_at: client.registered_at,
      last_claim_at: client.last_claim_at,
      claim_count: client.claim_count,
    };
  }

  async function recordClaim(client, m, rid, code, timeLabel) {
    run(
      `INSERT INTO kitifi_free_claims (client_id, mac, router_id, voucher_code, uptime) VALUES (?,?,?,?,?)`,
      client.id, m, rid, code, timeLabel
    );
    run(
      `UPDATE kitifi_free_clients SET last_claim_at=datetime('now'), claim_count=COALESCE(claim_count,0)+1 WHERE id=?`,
      client.id
    );
  }

  return {
    settings: kitifiFreeSettings,
    saveSettings: saveKitifiFreeSettings,
    byMac,
    byId(id) { return get("SELECT * FROM kitifi_free_clients WHERE id=?", Number(id)); },

    list({ q = "", routerId = null, limit = 500 } = {}) {
      const like = "%" + String(q || "").trim() + "%";
      const rid = routerId != null && routerId !== "" ? Number(routerId) : null;
      if (rid) {
        return all(
          `SELECT * FROM kitifi_free_clients
           WHERE router_id=? AND status!='deleted'
             AND (name LIKE ? OR last_name LIKE ? OR cp_number LIKE ? OR mac LIKE ? OR barangay LIKE ? OR purok LIKE ? OR municipal LIKE ?)
           ORDER BY registered_at DESC LIMIT ?`,
          rid, like, like, like, like, like, like, like, limit
        );
      }
      return all(
        `SELECT * FROM kitifi_free_clients
         WHERE status!='deleted'
           AND (name LIKE ? OR last_name LIKE ? OR cp_number LIKE ? OR mac LIKE ? OR barangay LIKE ? OR purok LIKE ? OR municipal LIKE ?)
         ORDER BY registered_at DESC LIMIT ?`,
        like, like, like, like, like, like, like, limit
      );
    },

    stats(routerId = null) {
      const rid = routerId != null && routerId !== "" ? Number(routerId) : null;
      if (rid) {
        return {
          total: Number(get("SELECT COUNT(*) AS n FROM kitifi_free_clients WHERE router_id=? AND status!='deleted'", rid)?.n || 0),
          active: Number(get("SELECT COUNT(*) AS n FROM kitifi_free_clients WHERE router_id=? AND status='active'", rid)?.n || 0),
          claims_today: Number(get(
            "SELECT COUNT(*) AS n FROM kitifi_free_claims WHERE router_id=? AND date(claimed_at, '+8 hours')=date('now', '+8 hours')",
            rid
          )?.n || 0),
        };
      }
      return {
        total: Number(get("SELECT COUNT(*) AS n FROM kitifi_free_clients WHERE status!='deleted'")?.n || 0),
        active: Number(get("SELECT COUNT(*) AS n FROM kitifi_free_clients WHERE status='active'")?.n || 0),
        claims_today: Number(get("SELECT COUNT(*) AS n FROM kitifi_free_claims WHERE date(claimed_at, '+8 hours')=date('now', '+8 hours')")?.n || 0),
      };
    },

    register({ name, last_name, dob, cp_number, purok, barangay, municipal, province, mac, routerId }) {
      const m = normalizeMac(mac);
      if (!m) throw new Error("Valid device MAC is required.");
      const n = fullName(name, last_name, name);
      if (!n) throw new Error("Name is required.");
      const rid = Number(routerId) || kitifiPortalRouterId();
      const existing = byMac(m, rid);
      if (existing) return existing;
      const cfg = kitifiFreeSettings(rid);
      run(
        `INSERT INTO kitifi_free_clients (name, last_name, dob, cp_number, purok, barangay, municipal, province, mac, router_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        String(name || n).trim(),
        String(last_name || "").trim(),
        String(dob || "").trim(),
        String(cp_number || "").trim(),
        String(purok || "").trim(),
        String(barangay || cfg.default_barangay || "").trim(),
        String(municipal || cfg.default_municipal || "").trim(),
        String(province || cfg.default_province || "").trim(),
        m,
        rid
      );
      return byMac(m, rid);
    },

    setStatus(id, status) {
      run("UPDATE kitifi_free_clients SET status=? WHERE id=?", String(status || "active"), Number(id));
      return get("SELECT * FROM kitifi_free_clients WHERE id=?", Number(id));
    },

    statusForMac(mac, routerId) {
      const rid = Number(routerId) || kitifiPortalRouterId();
      const cfg = kitifiFreeSettings(rid);
      const client = byMac(mac, rid);
      const today = claimsToday(normalizeMac(mac), rid);
      const canClaim = cfg.enabled && client && client.status === "active" && today < cfg.limit_per_day;
      let message = "";
      if (!cfg.enabled) message = "Free internet not available.";
      else if (!client) message = "Register to get free internet.";
      else if (client.status !== "active") message = "Free internet not available. Contact admin.";
      else if (today >= cfg.limit_per_day) {
        message = cfg.limit_per_day === 1
          ? "Na-claim mo na ang libreng internet ngayong araw. Bumalik bukas."
          : "Free internet not available. Daily limit reached (" + cfg.limit_per_day + " per day).";
      }
      else message = "Free internet available — " + (cfg.rate_time || uptimeLabel(cfg.hours)) + ".";
      return {
        enabled: cfg.enabled,
        registered: !!client,
        can_claim: canClaim,
        client: clientPayload(client),
        claims_today: today,
        limit_per_day: cfg.limit_per_day,
        hours: cfg.hours,
        uptime: cfg.rate_time || uptimeLabel(cfg.hours),
        rate_id: cfg.rate_id,
        seller_name: cfg.seller_name,
        default_barangay: cfg.default_barangay,
        default_municipal: cfg.default_municipal,
        default_province: cfg.default_province,
        mode: cfg.mode,
        message,
        router_id: rid,
      };
    },

    async claimMikrotik(conn, { mac, routerId, routerName }) {
      const rid = Number(routerId) || kitifiPortalRouterId();
      const m = normalizeMac(mac);
      if (!m) throw new Error("Valid device MAC is required.");
      const st = this.statusForMac(m, rid);
      if (!st.enabled) throw new Error("Free internet is disabled.");
      if (!st.registered) throw new Error("Register first before claiming free WiFi.");
      if (!st.can_claim) throw new Error(st.message || "Cannot claim free WiFi now.");

      const cfg = kitifiFreeSettings(rid);
      const client = byMac(m, rid);
      const timeLabel = cfg.rate_time || uptimeLabel(cfg.hours);
      const profile = String(cfg.profile || "default").trim();
      const code = genVoucherCode(8, "FR");
      const limit = kitifiUptimeToMikrotik(timeLabel);

      const users = await conn.print("/ip/hotspot/user");
      const hit = (users || []).find((u) => String(u.name || "").toUpperCase() === code.toUpperCase());
      if (!hit) {
        await conn.talk([
          "/ip/hotspot/user/add",
          "=name=" + code,
          "=password=" + code,
          "=profile=" + profile,
          "=limit-uptime=" + limit,
          "=mac-address=" + m,
          "=comment=JM Free WiFi " + fullName(client.name, client.last_name),
        ]);
      }

      let connectUrl = kitifiHotspotLoginBase(rid) + "?username=" + encodeURIComponent(code) + "&password=" + encodeURIComponent(code);
      try {
        const mt = await kitifiMikrotikVoucherConnect(conn, {
          mac: m, voucher: code, routerId: rid, uptime: timeLabel, profile,
        });
        if (mt?.connect_url) connectUrl = mt.connect_url;
      } catch {}

      await recordClaim(client, m, rid, code, timeLabel);

      return {
        voucher: code,
        uptime: timeLabel,
        connect_url: connectUrl,
        client_id: client.id,
        router: routerName || "",
        via: "mikrotik",
      };
    },

    async claim(conn, { mac, routerId, routerName }) {
      const rid = Number(routerId) || kitifiPortalRouterId();
      if (kitifiFreeMode(rid) === "mikrotik") {
        return this.claimMikrotik(conn, { mac, routerId: rid, routerName });
      }

      const m = normalizeMac(mac);
      if (!m) throw new Error("Valid device MAC is required.");
      const st = this.statusForMac(m, rid);
      if (!st.enabled) throw new Error("Free internet is disabled.");
      if (!st.registered) throw new Error("Register first before claiming free WiFi.");
      if (!st.can_claim) throw new Error(st.message || "Cannot claim free WiFi now.");

      const cfg = kitifiFreeSettings(rid);
      const client = byMac(m, rid);
      const rateId = String(cfg.rate_id || "6");
      const timeLabel = cfg.rate_time || "5hr. 12min.";
      const plan = {
        price: 1,
        uptime: timeLabel,
        time: timeLabel,
        expiry: "1 Day",
        pause_limit: "0",
        profile: cfg.profile,
        kitifi_rate_id: rateId,
        r_id: rateId,
      };
      const genOpts = kitifiBuildGenerateOpts(plan, {
        qty: 1,
        routerId: rid,
        seller_id: kitifiGenSellerId(rid),
        type: "default",
        r_id: rateId,
        amount: "1",
        profile: cfg.profile,
      });
      genOpts.routerId = rid;
      const result = await kitifiGenerateBatch(conn, genOpts);
      const code = String((result.codes || [])[0] || "").trim();
      if (!code) throw new Error("Voucher generation failed.");

      await recordClaim(client, m, rid, code, timeLabel);

      let connectUrl = kitifiConnectUrl(code, rid, m);
      try {
        connectUrl = await kitifiOrderConnectUrl(conn, {
          voucher: code, mac: m, routerId: rid, uptime: timeLabel, profile: cfg.profile,
        });
      } catch {}

      return {
        voucher: code,
        uptime: timeLabel,
        connect_url: connectUrl,
        client_id: client.id,
        router: routerName || "",
        via: "kitifi",
      };
    },
  };
}
