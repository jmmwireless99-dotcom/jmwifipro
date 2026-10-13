#!/usr/bin/env python3
"""Bind PPPoE payments to the MikroTik that owns the secret, and settle invoices."""
from pathlib import Path

SERVER = Path("/opt/jm-allinone/server.js")
DB = Path("/opt/jm-allinone/lib/db.js")
MARK = "pppoe-billing-router-bind"

def must_replace(text, old, new, label):
    if old not in text:
        raise SystemExit("anchor missing: " + label)
    return text.replace(old, new, 1)

HELPERS = r"""
// pppoe-billing-router-bind
// Map PPPoE usernames to the site router that actually has the secret.
let _pppIndex = null;
let _pppIndexAt = 0;
async function pppoeRouterIndex(force) {
  if (!force && _pppIndex && Date.now() - _pppIndexAt < 10 * 60 * 1000) return _pppIndex;
  const map = new Map();
  const rows = await listAllPppoeSecrets();
  for (const row of rows) {
    const name = String(row.name || "").trim().toLowerCase();
    if (!name || !row._router_id) continue;
    if (!map.has(name)) map.set(name, []);
    const list = map.get(name);
    if (!list.some((h) => Number(h.routerId) === Number(row._router_id))) {
      list.push({ routerId: Number(row._router_id), profile: String(row.profile || "") });
    }
  }
  _pppIndex = map;
  _pppIndexAt = Date.now();
  return map;
}

function pickPppoeHit(c, hits) {
  if (!hits || !hits.length) return null;
  if (hits.some((h) => Number(h.routerId) === Number(c.router_id))) return null;
  const prof = String(c.plan_profile || "").trim().toLowerCase();
  const byProf = prof ? hits.filter((h) => String(h.profile || "").trim().toLowerCase() === prof) : [];
  if (byProf.length === 1) return byProf[0];
  if (hits.length === 1) return hits[0];
  return byProf[0] || hits[0];
}

async function ensurePppoeRouter(c) {
  if (!c || !c.username || (c.conn_type || "pppoe") === "ipoe") return c;
  if ((c.plan_type || "pppoe") === "hotspot") return c;
  const idx = await pppoeRouterIndex(false);
  const hit = pickPppoeHit(c, idx.get(String(c.username).trim().toLowerCase()));
  if (!hit) return Customers.get(c.id) || c;
  Customers.setRouter(c.id, hit.routerId);
  return Customers.get(c.id) || c;
}

async function bindUnassignedPppoeRouters() {
  const idx = await pppoeRouterIndex(true);
  let bound = 0, moved = 0, missing = 0, kept = 0;
  for (const c of Customers.list()) {
    if ((c.conn_type || "pppoe") === "ipoe" || !c.username) continue;
    if ((c.plan_type || "pppoe") === "hotspot") continue;
    const hits = idx.get(String(c.username).trim().toLowerCase());
    if (!hits || !hits.length) { missing++; continue; }
    const hit = pickPppoeHit(c, hits);
    if (!hit) { kept++; continue; }
    Customers.setRouter(c.id, hit.routerId);
    if (c.router_id) moved++; else bound++;
  }
  Audit.add({ type: "auto", action: "pppoe-router-bind", detail: `bound ${bound}, moved ${moved}, kept ${kept}, not on any reachable router ${missing}`, ok: true });
  return { bound, moved, kept, missing };
}

async function routerProfileNames(conn) {
  const profiles = (await conn.pppProfiles().catch(() => [])) || [];
  return profiles.map((p) => String(p.name || ""));
}

function chooseActivePppProfile(names, planProfile, currentProfile, suspProfile) {
  const has = (n) => names.some((x) => profileNamesMatch(x, n));
  if (planProfile && has(planProfile)) return planProfile;
  if (currentProfile && !profileNamesMatch(currentProfile, suspProfile)) return currentProfile;
  return "";
}

// Cash was already recorded (wallet top-up row). Close the open PPPoE invoice without a second income row.
async function settleOpenPppoeInvoice(cust, amount, ref, gateway) {
  if (!cust || typeof Invoices.markPaidNoCash !== "function") return null;
  const open = (Invoices.byCustomer(cust.id) || [])
    .filter((i) => i.status !== "paid")
    .sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")));
  if (!open.length) return null;
  const amt = Number(amount) || 0;
  const inv = open.find((i) => Math.abs(Number(i.amount) - amt) < 0.05) || open[0];
  const balance = Math.max(0, Number(inv.amount) - (Number(inv.paid_amount) || 0));
  if (amt + 0.005 < balance) return null;
  const row = Invoices.markPaidNoCash(inv.id, {
    method: gateway || "gcash",
    reference: ref || "",
    note: "Settled by online payment" + (ref ? " ref:" + ref : ""),
  });
  Audit.add({ type: "auto", customer_id: cust.id, customer_name: cust.name, action: "invoice-settled-online", detail: "invoice #" + inv.id + " ref " + (ref || ""), ok: true });
  return row;
}

"""

OLD_SWITCH_HEAD = """async function applyProfileSwitch(c, target) {
  c = Customers.get(c.id) || c;
  if ((c.conn_type || "pppoe") === "ipoe") {
    if (target === "suspend") return ipoeSuspend(c);
    return ipoeEnable(c);
  }
  const conn = connForCustomer(c);   // send to THIS customer's router
  const isHotspot = (c.plan_type || "pppoe") === "hotspot";
  const suspProfile = suspendedProfileName();
  const activeProfile = c.plan_profile || "default";
"""

NEW_SWITCH_HEAD = """async function applyProfileSwitch(c, target) {
  c = Customers.get(c.id) || c;
  if ((c.conn_type || "pppoe") === "ipoe") {
    if (target === "suspend") return ipoeSuspend(c);
    return ipoeEnable(c);
  }
  c = await ensurePppoeRouter(c);
  const conn = connForCustomer(c);   // send to THIS customer's router
  const isHotspot = (c.plan_type || "pppoe") === "hotspot";
  const suspProfile = suspendedProfileName();
  let activeProfile = c.plan_profile || "default";
"""

OLD_ACTIVATE = """    await clearCustomerFromSuspendList(c);
    if (isHotspot) {
      await conn.updateHotspotUser(c.username, { profile: activeProfile });
      await conn.setHotspotUserDisabled(c.username, false);
    } else {
      await conn.updatePppoe(c.username, { profile: activeProfile });
      await conn.setPppoeDisabled(c.username, false);
    }
  }
  try { if (isHotspot) await conn.disconnectHotspot(c.username); else await conn.disconnectPppoe(c.username); } catch {}
}
"""

NEW_ACTIVATE = """    await clearCustomerFromSuspendList(c);
    if (!isHotspot) {
      const names = await routerProfileNames(conn);
      const current = await readPppoeProfile(conn, c.username);
      const chosen = chooseActivePppProfile(names, c.plan_profile, current, suspProfile);
      if (!chosen) {
        throw new Error(`PPP profile "${c.plan_profile || "default"}" not found on ${c.router_name || "the router"} for ${c.username}`);
      }
      activeProfile = chosen;
      if (current && profileNamesMatch(current, activeProfile)) {
        await conn.setPppoeDisabled(c.username, false);
        return;
      }
    }
    if (isHotspot) {
      await conn.updateHotspotUser(c.username, { profile: activeProfile });
      await conn.setHotspotUserDisabled(c.username, false);
    } else {
      await conn.updatePppoe(c.username, { profile: activeProfile });
      await conn.setPppoeDisabled(c.username, false);
    }
  }
  try { if (isHotspot) await conn.disconnectHotspot(c.username); else await conn.disconnectPppoe(c.username); } catch {}
}
"""

OLD_PORTAL = """      try { await applyProfileSwitch(Customers.get(cust.id), "active"); } catch (e) {
        Audit.add({ type: "auto", action: "portal-payment", detail: `renewed billing for ${cust.name} but router push pending: ${e.message}`, ok: false });
      }
"""

NEW_PORTAL = """      try { await applyProfileSwitch(Customers.get(cust.id), "active"); } catch (e) {
        Audit.add({ type: "auto", action: "portal-payment", detail: `renewed billing for ${cust.name} but router push pending: ${e.message}`, ok: false });
      }
      try { await settleOpenPppoeInvoice(Customers.get(cust.id), planPrice, ref, gateway); } catch (e) {
        Audit.add({ type: "auto", customer_id: cust.id, action: "invoice-settled-online", detail: e.message, ok: false });
      }
"""

OLD_INV = """    try {
      const cust = Customers.get(inv.customer_id);
      if (cust && cust.status === "suspended") {
        await customerAction(cust.id, "enable");
        Audit.add({ type: "auto", customer_id: cust.id, customer_name: cust.name, action: "auto-reconnect", detail: "after online payment", ok: true });
      }
    } catch (e) {
      Audit.add({ type: "auto", customer_id: inv.customer_id, action: "auto-reconnect-failed", detail: e.message, ok: false });
    }
"""

NEW_INV = """    try {
      const cust = Customers.get(inv.customer_id);
      if (cust && (cust.conn_type || "pppoe") !== "ipoe" && cust.username) {
        const exp = await renewCustomer(cust, cust.plan_mins || 43200);
        Audit.add({ type: "auto", customer_id: cust.id, customer_name: cust.name, action: "auto-reconnect", detail: "invoice paid, expiry " + exp, ok: true });
      } else if (cust && cust.status === "suspended") {
        await customerAction(cust.id, "enable");
        Audit.add({ type: "auto", customer_id: cust.id, customer_name: cust.name, action: "auto-reconnect", detail: "after online payment", ok: true });
      }
    } catch (e) {
      Audit.add({ type: "auto", customer_id: inv.customer_id, action: "auto-reconnect-failed", detail: e.message, ok: false });
    }
"""

OLD_LISTEN = """  tgPollLoop(); // listens for Telegram approve/reject (no-op until a bot token is set)
"""

NEW_LISTEN = """  tgPollLoop(); // listens for Telegram approve/reject (no-op until a bot token is set)
  setTimeout(() => {
    bindUnassignedPppoeRouters()
      .then((r) => console.log(`  >> PPPoE router bind: ${r.bound} new, ${r.moved} corrected, ${r.missing} not on a reachable router`))
      .catch((e) => console.error("  >> PPPoE router bind failed:", e.message));
  }, 8000);
"""

DB_OLD = """    return { invoice: get("SELECT * FROM invoices WHERE id=?", id), applied, toCredit, fully };
  },
};
"""

DB_NEW = """    return { invoice: get("SELECT * FROM invoices WHERE id=?", id), applied, toCredit, fully };
  },

  // Online portal payments already insert a wallet income row. Close the invoice without a second payment.
  markPaidNoCash: (id, meta = {}) => {
    const inv = get("SELECT * FROM invoices WHERE id=?", id);
    if (!inv || inv.status === "paid") return inv;
    run("UPDATE invoices SET paid_amount=?, status='paid', paid_at=datetime('now') WHERE id=?", Number(inv.amount) || 0, id);
    const pay = get(
      "SELECT id FROM payments WHERE customer_id=? AND (invoice_id IS NULL OR invoice_id=0) ORDER BY id DESC LIMIT 1",
      inv.customer_id
    );
    const ref = meta.reference || "";
    if (pay) {
      run(
        "UPDATE payments SET invoice_id=?, method=?, reference=CASE WHEN ?<>'' THEN ? ELSE reference END, note=? WHERE id=?",
        id, meta.method || "gcash", ref, ref, meta.note || "Online payment", pay.id
      );
    }
    return get("SELECT * FROM invoices WHERE id=?", id);
  },
};
"""

def main():
    server = SERVER.read_text()
    db = DB.read_text()
    # Live file uses a unicode arrow in this comment. Match either form.
    head = OLD_SWITCH_HEAD
    if head not in server:
        head = OLD_SWITCH_HEAD.replace("   // send to THIS customer's router", "   // \u2190 send to THIS customer's router")
    if MARK not in server:
        if "async function applyProfileSwitch(c, target) {" not in server:
            raise SystemExit("anchor missing: helpers")
        server = server.replace("async function applyProfileSwitch(c, target) {", HELPERS + "async function applyProfileSwitch(c, target) {", 1)
        server = must_replace(server, head, NEW_SWITCH_HEAD, "switch-head")
        server = must_replace(server, OLD_ACTIVATE, NEW_ACTIVATE, "activate")
        server = must_replace(server, OLD_PORTAL, NEW_PORTAL, "portal")
        server = must_replace(server, OLD_INV, NEW_INV, "invoice")
        server = must_replace(server, OLD_LISTEN, NEW_LISTEN, "listen")
    else:
        print("server already has", MARK)
    if "markPaidNoCash" not in db:
        db = must_replace(db, DB_OLD, DB_NEW, "db")
    else:
        print("db already has markPaidNoCash")
    SERVER.write_text(server)
    DB.write_text(db)
    print("patched")

if __name__ == "__main__":
    main()
