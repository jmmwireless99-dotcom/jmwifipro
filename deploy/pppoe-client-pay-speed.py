#!/usr/bin/env python3
"""PPPoE client GCash: apply the payment on the status poll, and stop the account page from downloading the logo inside /api/plans.

Applied on jmestre.tech (/opt/jm-allinone) 2026-10-14.
The PayMongo webhook was also moved to https://jmestre.tech/api/billing/paymongo/webhook
because the enabled hook still pointed at a dead trycloudflare URL.
"""
from pathlib import Path

root = Path("/opt/jm-allinone")
server = root / "server.js"
paymongo = root / "lib" / "paymongo.js"
account = root / "public" / "portal" / "account.html"


def sub(path, old, new, label):
    text = path.read_text()
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 match, found {n}")
    path.write_text(text.replace(old, new, 1))
    print("patched", label)


sub(
    paymongo,
    """  return {
    id: r.json.data.id,
    status: a.status,
    amount: a.amount,
    metadata: a.metadata || {},
    description: a.description || "",
  };
""",
    """  const pays = Array.isArray(a.payments) ? a.payments : [];
  const paymentId = pays.map((p) => (p && p.id) || (typeof p === "string" ? p : "")).find(Boolean) || "";
  return {
    id: r.json.data.id,
    status: a.status,
    amount: a.amount,
    paymentId,
    metadata: a.metadata || {},
    description: a.description || "",
  };
""",
    "getPaymentIntent paymentId",
)

sub(
    server,
    """        brand_logo: s.brand_logo || "",
        gcash_name: s.gcash_name || "", gcash_number: s.gcash_number || "", gcash_qr: s.gcash_qr || "",
""",
    """        brand_logo: "",
        gcash_name: s.gcash_name || "", gcash_number: s.gcash_number || "", gcash_qr: "",
""",
    "plans payload without logo",
)

sub(
    server,
    """    if (pathname === "/portal/chat-bot.js" && req.method === "GET") {""",
    """    if (pathname === "/portal/brand-logo.png" && (req.method === "GET" || req.method === "HEAD")) {
      return servePublicFile(res, "portal/brand-logo.png", { maxAge: 86400 });
    }
    if (pathname === "/portal/chat-bot.js" && req.method === "GET") {""",
    "logo file route",
)

sub(
    server,
    """      try {
        const intent = await gw.getIntent(pi);
        return send(res, 200, { ok: true, status: intent.status, paid: intent.status === "succeeded" });
      } catch (e) {
        return send(res, 502, { ok: false, error: e.message });
      }
""",
    """      try {
        const intent = await gw.getIntent(pi);
        const paid = intent.status === "succeeded";
        if (paid) {
          await handlePaidOnlineGatewayEvent({
            type: "payment.paid",
            paymentIntentId: pi,
            resourceId: intent.paymentId || "",
            amount: intent.amount,
            remarks: (intent.metadata && intent.metadata.portal) || intent.description || "",
          }, "paymongo");
        }
        return send(res, 200, { ok: true, status: intent.status, paid });
      } catch (e) {
        return send(res, 502, { ok: false, error: e.message });
      }
""",
    "pay status applies renewal",
)

old_sweep = """    const candidates = Customers.expiredPppoeForValidation(cutoff);
    const ipoeCandidates = Customers.expiredAsOf(cutoff).filter((c) => (c.conn_type || "pppoe") === "ipoe");
    let n = 0, ipoeN = 0, skipped = 0, renewed = 0;
    const errors = [];
    for (const c of candidates) {
      if (!usesPppProfile(c)) continue;
      try {
        if (await isOnSuspendedRouterProfile(c)) {
          if (c.status !== "suspended") Customers.setStatusAndAuto(c.id, "suspended", true);
          skipped++;
          continue;
        }
"""
new_sweep = """    const candidates = Customers.expiredPppoeForValidation(cutoff);
    const ipoeCandidates = Customers.expiredAsOf(cutoff).filter((c) => (c.conn_type || "pppoe") === "ipoe");
    const snap = await sweepPppSnapshot();
    let n = 0, ipoeN = 0, skipped = 0, renewed = 0;
    const errors = [];
    for (const c of candidates) {
      if (!usesPppProfile(c)) continue;
      try {
        const slot = snap.get(Number(c.router_id) || 0);
        if (slot && slot.missingProfile) { skipped++; continue; }
        if (slot && slot.users) {
          const prof = slot.users.get(String(c.username || "").toLowerCase()) || "";
          if (prof && profileNamesMatch(prof, suspendedProfileName())) {
            if (c.status !== "suspended") Customers.setStatusAndAuto(c.id, "suspended", true);
            skipped++;
            continue;
          }
        } else if (await isOnSuspendedRouterProfile(c)) {
          if (c.status !== "suspended") Customers.setStatusAndAuto(c.id, "suspended", true);
          skipped++;
          continue;
        }
"""
sub(server, old_sweep, new_sweep, "sweep uses one secret list")

helper = '''
// One PPP secret/profile read per router per sweep. Listing secrets per customer
// blocked the client pay page while dozens of expired accounts were checked.
async function sweepPppSnapshot() {
  const out = new Map();
  const susp = suspendedProfileName().toLowerCase();
  let routers = [];
  try { routers = (Routers.list() || []).filter((r) => r && r.enabled !== 0 && String(r.host || "").trim()); } catch { routers = []; }
  for (const r of routers) {
    const id = Number(r.id) || 0;
    try {
      const conn = connForRouter(r);
      const profiles = ((await conn.pppProfiles().catch(() => [])) || []).map((p) => String(p.name || "").toLowerCase());
      const missingProfile = !profiles.includes(susp);
      const users = new Map();
      if (!missingProfile) {
        for (const row of ((await conn.listPppoe().catch(() => [])) || [])) {
          const name = String(row.name || "").trim().toLowerCase();
          if (name) users.set(name, String(row.profile || ""));
        }
      } else {
        Audit.add({ type: "auto", action: "suspend", detail: `PPP profile "${suspendedProfileName()}" missing on ${r.name} — skip this sweep`, ok: false });
      }
      out.set(id, { users, missingProfile });
    } catch (e) {
      out.set(id, { users: null, missingProfile: false, error: e.message });
    }
  }
  return out;
}

'''
text = server.read_text()
needle = "// Every N minutes: suspend expired PPPoE clients still on any non-SUSPENDED router profile.\n"
if text.count(needle) != 1:
    raise SystemExit("helper anchor missing")
server.write_text(text.replace(needle, helper + needle, 1))
print("patched sweep helper")

sub(account, 'var lg=cfg.brand_logo||"";', 'var lg=cfg.brand_logo||"/portal/brand-logo.png";', "account logo url")
print("ok")
