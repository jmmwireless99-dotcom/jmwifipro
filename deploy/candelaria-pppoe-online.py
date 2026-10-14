#!/usr/bin/env python3
"""Candelaria PPPoE shows active in Winbox but Offline on jmestre, and has no internet.

Two separate faults:

1) Paying clients (11.11.11.0/24, 12.10.10.0/24, 14.10.10.0/24, 15.10.10.0/24)
   leave via OSPF 20.12.10.1 with their own source address. That uplink only
   routes 20.12.10.0/30 back, and this router had no masquerade. Applied on
   the router by deploy/candelaria-pppoe-uplink.mjs.

2) /api/pppoe/active walked every router one by one. Dead sites (Panisijan,
   Magsay2x) held the reply past the panel's 8s limit, so Candelaria's live
   sessions never reached the Online column.

Expired clients stay on suspended-pool with no internet. Their HTTP redirect
now goes to 124.105.235.44 (jmestre.tech), not the removed jmwifi.pro VPS.
"""
from pathlib import Path

root = Path("/opt/jm-allinone")
server = root / "server.js"
html = root / "public" / "index.html"
firewall = root / "deploy" / "apply-suspend-firewall.mjs"


def sub(path, old, new, label):
    text = path.read_text()
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 match, found {n}")
    path.write_text(text.replace(old, new, 1))
    print("patched", label)


sub(
    server,
    """async function listAllPppoeActive() {
  const routers = Routers.list().filter((r) => Number(r.enabled) !== 0 && r.host);
  if (routers.length === 0) return []; // all sites paused/offline on this panel
  if (routers.length === 1) {
    try {
      const conn = connForRouter(routers[0]);
      return ((await conn.listPppoeActive()) || []).map((a) => ({ ...a, router_id: routers[0].id, router_name: routers[0].name }));
    } catch { return []; }
  }
  const all = [];
  for (const r of routers) {
    try {
      const conn = connForRouter(r);
      const act = (await conn.listPppoeActive()) || [];
      act.forEach((a) => all.push({ ...a, router_id: r.id, router_name: r.name }));
    } catch {}
  }
  return all;
}""",
    """async function listAllPppoeActive() {
  const routers = Routers.list().filter((r) => Number(r.enabled) !== 0 && r.host);
  if (routers.length === 0) return []; // all sites paused/offline on this panel
  // Ask every site at once. A dead VPN must not hold the Online column past the
  // panel timeout — sequential polls were still waiting on Panisijan/Magsay2x
  // when the browser gave up, so Candelaria sessions never showed as online.
  const one = async (r) => {
    let timer;
    try {
      const conn = connForRouter(r);
      const act = await Promise.race([
        conn.listPppoeActive(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("ppp active timeout")), 6000); }),
      ]);
      return (act || []).map((a) => ({ ...a, router_id: r.id, router_name: r.name }));
    } catch {
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const parts = await Promise.all(routers.map(one));
  return parts.flat();
}""",
    "listAllPppoeActive",
)

sub(
    html,
    '  const ppp = await api("/api/pppoe/active", { timeoutMs: 8000 });',
    '  const ppp = await api("/api/pppoe/active", { timeoutMs: 12000 });',
    "pppoe active timeout",
)

sub(
    html,
    """  if (c.status === "suspended") return { key: "suspended", label: "Suspended", cls: "suspended" };""",
    """  if (c.status === "suspended") {
    if (!isIpoe && pppClientOnline(c)) return { key: "suspended", label: "Suspended · PPPoE up, no internet", cls: "suspended" };
    return { key: "suspended", label: "Suspended", cls: "suspended" };
  }""",
    "suspended but connected label",
)

if firewall.exists():
    sub(
        firewall,
        'const PORTAL_HOST = "jmwifi.pro";',
        'const PORTAL_HOST = "jmestre.tech";',
        "portal host",
    )
    sub(
        firewall,
        """const TLS_HOSTS = [
  "jmwifi.pro",
  "*.jmwifi.pro",
""",
        """const TLS_HOSTS = [
  "jmestre.tech",
  "*.jmestre.tech",
  "jmwifi.pro",
  "*.jmwifi.pro",
""",
        "tls hosts",
    )
    sub(
        firewall,
        """  const ips = new Set();
  for (const h of [host, PORTAL_HOST, "www." + PORTAL_HOST]) {
    for (const ip of await resolveHostIps(h)) ips.add(ip);
  }
  if (!ips.size) ips.add("187.77.145.131");
""",
        """  const ips = new Set();
  // Only the live portal. jmwifi.pro still resolves at the old VPS, which is down.
  for (const ip of await resolveHostIps(host)) ips.add(ip);
  if (!ips.size) ips.add("124.105.235.44");
""",
        "portal ip resolve",
    )
    sub(
        firewall,
        '  console.log("\\nDone. Expired client should open https://jmwifi.pro/account and PayMongo/GCash checkout.");',
        '  console.log("\\nDone. Expired client should open http://jmestre.tech/account and PayMongo/GCash checkout.");',
        "done message",
    )
else:
    print("no apply-suspend-firewall.mjs on this host")
