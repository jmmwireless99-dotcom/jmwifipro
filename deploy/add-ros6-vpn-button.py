#!/usr/bin/env python3
"""Add a RouterOS v6 VPN client button on the MikroTik site list.

The existing Add VPN Client button and its handler stay as they are.
A new client is created through the current station API, then saved as a
billing router so it shows on the site list.
"""
from pathlib import Path
import shutil
import time

INDEX = Path("/opt/jm-allinone/public/index.html")

HEADER_OLD = (
    '<button type="button" onclick="openCreateVpn()" '
    'style="margin-left:0;width:auto;padding:8px 14px;font-size:12.5px">'
    "+ Add VPN Client</button>"
)
HEADER_NEW = HEADER_OLD + (
    '\n      <button type="button" onclick="openCreateVpnV6()" '
    'style="margin-left:0;width:auto;padding:8px 14px;font-size:12.5px">'
    "+ Add VPN Client v6</button>"
)
BOTTOM_OLD = (
    '<button type="button" class="site-add-toggle" onclick="openCreateVpn()" '
    'style="flex:1;min-width:200px;margin:0">+ Add VPN Client</button>'
)
BOTTOM_NEW = BOTTOM_OLD + (
    '\n        <button type="button" class="site-add-toggle" onclick="openCreateVpnV6()" '
    'style="flex:1;min-width:200px;margin:0">+ Add VPN Client v6</button>'
)

MODAL = r'''
<div id="rt-v6-modal" class="modal hidden">
  <div class="modal-box" style="max-width:640px">
    <div class="modal-head"><span>Add VPN Client v6</span><button class="x" onclick="closeCreateVpnV6()">✕</button></div>
    <div class="modal-body">
      <div id="rt-v6-form">
        <p style="font-family:var(--sans);font-size:13px;color:var(--muted);margin:0 0 12px">Bagong RouterOS v6 client. Papasok ito sa MikroTik site list at sa billing. Hindi nito binabago ang mga VPN na online na.</p>
        <label class="fld">Client / site name<input id="rt-v6-name" class="set-in" placeholder="e.g. Cagbatang v6"></label>
        <label class="fld">SSTP username <span style="color:var(--muted);font-size:11px">(blanko = auto)</span><input id="rt-v6-user" class="set-in"></label>
        <label class="fld">SSTP password <span style="color:var(--muted);font-size:11px">(blanko = auto, min 8)</span><input id="rt-v6-pass" class="set-in" type="password"></label>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button type="button" id="rt-v6-go" onclick="submitCreateVpnV6()">Create v6 client</button>
          <button type="button" class="ghost" onclick="closeCreateVpnV6()">Cancel</button>
        </div>
        <div id="rt-v6-err" style="display:none;color:var(--bad);font-size:13px;margin-top:10px"></div>
      </div>
      <div id="rt-v6-done" style="display:none">
        <p id="rt-v6-summary" style="font-family:var(--sans);font-size:13px;margin:0 0 10px"></p>
        <table id="rt-v6-facts" style="width:100%;font-size:13px"></table>
        <div style="display:flex;align-items:center;gap:8px;margin:12px 0 6px">
          <b style="font-size:13px">RouterOS v6 script</b>
          <button type="button" class="mini" onclick="copyCreateVpnV6()">copy</button>
        </div>
        <pre id="rt-v6-script" style="white-space:pre-wrap;max-height:280px;overflow:auto;font-size:12px"></pre>
        <div style="display:flex;justify-content:flex-end;margin-top:12px">
          <button type="button" onclick="closeCreateVpnV6()">Done</button>
        </div>
      </div>
    </div>
  </div>
</div>
'''

JS = r'''
function rosQuoteV6(v) {
  return String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function routerosV6Script(s) {
  const iface = "sstp-cctv";
  const tag = "JM TECH SOLUTION";
  const apiUser = s.apiUser || "jmcloud";
  const apiPass = s.apiPassword || "";
  const lines = [
    "# --- " + tag + ': RouterOS v6 paste para sa "' + s.name + '" ---',
    "# Bagong client. I-paste ito sa RouterOS v6 lang.",
    "",
    "# 1) SSTP VPN client -> " + s.sstpServer + ":" + s.sstpPort,
    ':do { /interface sstp-client remove [find name="' + iface + '"] } on-error={}',
    "/interface sstp-client add name=" + iface + " connect-to=" + s.sstpServer + " port=" + s.sstpPort + " \\",
    '    user="' + rosQuoteV6(s.username) + '" password="' + rosQuoteV6(s.password) + '" profile=default \\',
    "    authentication=pap,chap,mschap1,mschap2 \\",
    "    verify-server-certificate=no disabled=no",
    "",
    "# 2) Cloud API user — ito ang gamit ng billing site list",
    ':if ([:len [/user find where name="' + rosQuoteV6(apiUser) + '"]] = 0) do={',
    '  /user add name="' + rosQuoteV6(apiUser) + '" password="' + rosQuoteV6(apiPass) + '" group=full comment="' + tag + ' cloud API"',
    "} else={",
    '  /user set [find where name="' + rosQuoteV6(apiUser) + '"] password="' + rosQuoteV6(apiPass) + '"',
    "}",
    "",
    "# 3) Winbox + API + www, VPN subnet only",
    "#    Winbox: " + (s.vpnAddress || "") + " -> " + (s.vpnIp || "") + ":8291",
    "#    API:    124.105.235.44:" + (s.apiPort || "") + " -> " + (s.vpnIp || "") + ":8728",
    "/ip service set winbox disabled=no address=10.90.0.0/21",
    "/ip service set api disabled=no address=10.90.0.0/21",
    "/ip service set www disabled=no address=10.90.0.0/21",
    ':do { /ip firewall filter remove [find where comment~"' + tag + ':"] } on-error={}',
    '/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8291 src-address=10.90.0.0/21 comment="' + tag + ': Winbox via VPN"',
    '/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8728 src-address=10.90.0.0/21 comment="' + tag + ': API via VPN"',
    '/ip firewall filter add chain=input action=accept protocol=tcp dst-port=80 src-address=10.90.0.0/21 comment="' + tag + ': REST www via VPN"',
    "",
    "# Done. Nasa MikroTik site list na ang site na ito."
  ];
  const script = lines.join("\n");
  if (script.indexOf("verify-server-address-from-certificate") !== -1) throw new Error("v6 script invalid");
  return script;
}
function openCreateVpnV6() {
  const modal = $("rt-v6-modal");
  if (!modal) return;
  $("rt-v6-form").style.display = "";
  $("rt-v6-done").style.display = "none";
  $("rt-v6-err").style.display = "none";
  $("rt-v6-err").textContent = "";
  $("rt-v6-name").value = "";
  $("rt-v6-user").value = "";
  $("rt-v6-pass").value = "";
  const go = $("rt-v6-go");
  if (go) { go.disabled = false; go.textContent = "Create v6 client"; }
  modal.classList.remove("hidden");
}
function closeCreateVpnV6() {
  const modal = $("rt-v6-modal");
  if (modal) modal.classList.add("hidden");
  if (typeof loadRouters === "function") loadRouters();
}
function copyCreateVpnV6() {
  const text = ($("rt-v6-script") && $("rt-v6-script").textContent) || "";
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
}
async function submitCreateVpnV6() {
  const err = $("rt-v6-err");
  const go = $("rt-v6-go");
  const name = $("rt-v6-name").value.trim();
  err.style.display = "none";
  err.textContent = "";
  if (!name) {
    err.style.display = "";
    err.textContent = "Kailangan ang site name.";
    return;
  }
  go.disabled = true;
  go.textContent = "Creating…";
  let made = null;
  try {
    const sso = await getOpsSsoToken(true);
    const body = { name: name, apiUser: "jmcloud" };
    const u = $("rt-v6-user").value.trim();
    const p = $("rt-v6-pass").value;
    if (u) body.username = u;
    if (p) body.password = p;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch("/cctv/api/stations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + sso.token },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      made = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(made.error || ("VPN create failed (" + res.status + ")"));
    } finally {
      clearTimeout(timer);
    }
    const host = "124.105.235.44";
    const port = Number(made.apiPort) || 0;
    if (!port) throw new Error("Walang API port ang bagong client.");
    const notes = "RouterOS v6 · SSTP " + made.username + " → jmestre.tech:4443 · tunnel " + made.vpnIp
      + " · Winbox " + made.vpnAddress + " · API " + host + ":" + port;
    const saved = await api("/api/billing/routers", {
      method: "POST",
      timeoutMs: 20000,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: made.name || name,
        host: host,
        port: port,
        username: made.apiUser || "jmcloud",
        password: made.apiPassword || "",
        ssl: 0,
        area: "",
        vpn_notes: notes
      })
    });
    if (!saved.ok) throw new Error(saved.error || "Hindi na-save sa billing site list.");
    const script = routerosV6Script(made);
    $("rt-v6-form").style.display = "none";
    $("rt-v6-done").style.display = "";
    $("rt-v6-summary").textContent = "Na-add sa MikroTik site list at billing. I-paste ang script sa RouterOS v6 lang.";
    const rows = [
      ["Site", made.name || name],
      ["Billing API", host + ":" + port],
      ["API user", made.apiUser || "jmcloud"],
      ["SSTP", (made.sstpServer || "jmestre.tech") + ":" + (made.sstpPort || 4443)],
      ["SSTP user", made.username || ""],
      ["Tunnel IP", made.vpnIp || ""],
      ["Winbox", made.vpnAddress || ""]
    ];
    $("rt-v6-facts").innerHTML = rows.map(function (r) {
      return "<tr><td style=\"color:var(--muted);width:140px;padding:3px 0\">" + esc(r[0]) + "</td><td class=\"mono\">" + esc(r[1]) + "</td></tr>";
    }).join("");
    $("rt-v6-script").textContent = script;
    if (typeof loadRouters === "function") loadRouters();
  } catch (e) {
    const msg = e.name === "AbortError" ? "Timeout habang gumagawa ng VPN client." : (e.message || String(e));
    if (made && made.username) {
      const script = routerosV6Script(made);
      $("rt-v6-form").style.display = "none";
      $("rt-v6-done").style.display = "";
      $("rt-v6-summary").textContent = "Na-create ang VPN, pero hindi pumasok sa billing site list: " + msg;
      $("rt-v6-script").textContent = script;
    } else {
      err.style.display = "";
      err.textContent = msg;
      go.disabled = false;
      go.textContent = "Create v6 client";
    }
  }
}

'''

ANCHOR_MODAL = '</div><!-- /view-routers -->\n\n<div id="rt-edit-modal"'
ANCHOR_JS = 'alert("Hindi ma-open ang Add VPN Client: " + (e.message || e));\n    }\n  })();\n}\n\n\nasync function loadCustomersPage()'
ANCHOR_JS_NEW = 'alert("Hindi ma-open ang Add VPN Client: " + (e.message || e));\n    }\n  })();\n}\n' + JS + '\nasync function loadCustomersPage()'


def main():
    text = INDEX.read_text()
    if "function openCreateVpn()" not in text:
        raise SystemExit("openCreateVpn missing; refusing to edit")
    if text.count(HEADER_OLD) != 1 or text.count(BOTTOM_OLD) != 1:
        if "+ Add VPN Client v6" not in text:
            raise SystemExit("button anchors not unique")
    changed = False
    if "+ Add VPN Client v6</button>" not in text:
        text = text.replace(HEADER_OLD, HEADER_NEW, 1).replace(BOTTOM_OLD, BOTTOM_NEW, 1)
        changed = True
    if 'id="rt-v6-modal"' not in text:
        if ANCHOR_MODAL not in text:
            raise SystemExit("modal anchor missing")
        text = text.replace(ANCHOR_MODAL, '</div><!-- /view-routers -->\n' + MODAL + '\n<div id="rt-edit-modal"', 1)
        changed = True
    if "function openCreateVpnV6()" not in text:
        if ANCHOR_JS not in text:
            raise SystemExit("js anchor missing")
        text = text.replace(ANCHOR_JS, ANCHOR_JS_NEW, 1)
        changed = True
    else:
        start = text.find("function rosQuoteV6")
        end = text.find("\nasync function loadCustomersPage()", start)
        wanted = JS.strip() + "\n"
        if start < 0 or end < 0:
            raise SystemExit("v6 script block missing")
        if text[start:end] != wanted:
            text = text[:start] + wanted + text[end + 1:]
            changed = True
    # The original handler must still open the v7 add screen.
    if 'action=add' not in text.split("function openCreateVpn()")[1].split("function openCreateVpnV6")[0]:
        raise SystemExit("existing Add VPN Client handler changed")
    v6_body = text.split("function routerosV6Script")[1].split("function openCreateVpnV6")[0]
    pasted = "\n".join(line for line in v6_body.splitlines() if "indexOf(" not in line)
    if "verify-server-address-from-certificate" in pasted:
        raise SystemExit("v6 script contains the v7-only property")
    if not changed:
        print("already patched")
        return
    backup = INDEX.with_name("index.html.bak-ros6-button-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    shutil.copy2(INDEX, backup)
    INDEX.write_text(text)
    print("patched", INDEX, "backup", backup.name)


if __name__ == "__main__":
    main()
