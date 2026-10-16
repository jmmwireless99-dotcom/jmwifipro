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
        <p style="font-family:var(--sans);font-size:13px;color:var(--muted);margin:0 0 12px">Gaya ng jmfx.pro/vpnserver. SoftEther SSTP 992, connect-to=IP:992. Papasok sa MikroTik site list at billing. Ang mga online na client sa 4443 ay hindi kasama dito.</p>
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
  try {
    const body = { name: name };
    const u = $("rt-v6-user").value.trim();
    const p = $("rt-v6-pass").value;
    if (u) body.username = u;
    if (p) body.password = p;
    const saved = await api("/api/billing/vpn-ros6", {
      method: "POST",
      timeoutMs: 30000,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!saved.ok) throw new Error(saved.error || "Hindi na-create ang v6 client.");
    const made = saved.data || {};
    const script = made.script || "";
    var addLine = "";
    script.split("\n").forEach(function (l) { if (l.indexOf("sstp-client add") !== -1) addLine = l; });
    if (addLine.indexOf('connect-to="124.105.235.44:992"') === -1 || addLine.indexOf(" port=") !== -1) throw new Error("v6 script invalid");
    $("rt-v6-form").style.display = "none";
    $("rt-v6-done").style.display = "";
    $("rt-v6-summary").textContent = "Na-add sa MikroTik site list at billing. I-paste ito sa RouterOS v6. Dial " + made.sstpServer + ":" + made.sstpPort + ".";
    const rows = [
      ["Site", made.name || name],
      ["SSTP", (made.sstpServer || "") + ":" + (made.sstpPort || "")],
      ["SSTP user", made.username || ""],
      ["Tunnel IP", made.tunnelIp || ""],
      ["Billing API", (made.tunnelIp || "") + ":8728"],
      ["API user", made.apiUser || "jmcloud"]
    ];
    $("rt-v6-facts").innerHTML = rows.map(function (r) {
      return "<tr><td style=\"color:var(--muted);width:140px;padding:3px 0\">" + esc(r[0]) + "</td><td class=\"mono\">" + esc(r[1]) + "</td></tr>";
    }).join("");
    $("rt-v6-script").textContent = script;
    if (typeof loadRouters === "function") loadRouters();
  } catch (e) {
    err.style.display = "";
    err.textContent = e.name === "AbortError" ? "Timeout habang gumagawa ng VPN client." : (e.message || String(e));
    go.disabled = false;
    go.textContent = "Create v6 client";
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
        if start < 0:
            start = text.find("function openCreateVpnV6")
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
    v6_body = text.split("function submitCreateVpnV6")[1].split("async function loadCustomersPage")[0]
    if "/api/billing/vpn-ros6" not in v6_body or "/cctv/api/stations" in v6_body:
        raise SystemExit("v6 create path is wrong")
    old_blurb = "Bagong RouterOS v6 client. Papasok ito sa MikroTik site list at sa billing. Hindi nito binabago ang mga VPN na online na."
    new_blurb = "Gaya ng jmfx.pro/vpnserver. SoftEther SSTP 992, connect-to=IP:992. Papasok sa MikroTik site list at billing. Ang mga online na client sa 4443 ay hindi kasama dito."
    if old_blurb in text:
        text = text.replace(old_blurb, new_blurb, 1)
        changed = True
    if not changed:
        print("already patched")
        return
    backup = INDEX.with_name("index.html.bak-ros6-button-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    shutil.copy2(INDEX, backup)
    INDEX.write_text(text)
    print("patched", INDEX, "backup", backup.name)


if __name__ == "__main__":
    main()
