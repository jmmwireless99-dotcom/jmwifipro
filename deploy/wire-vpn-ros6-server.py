#!/usr/bin/env python3
"""Add POST /api/billing/vpn-ros6 without changing the existing router routes."""
from pathlib import Path
import shutil
import time

SERVER = Path("/opt/jm-allinone/server.js")
text = SERVER.read_text()
imp = 'import { createVpnRos6 } from "./lib/vpn-ros6.js";\n'
anchor_imp = 'import { kpis, Naps, Olts, FiberLines, Outages, Reports, CSessions, ClientStatus, Sms, Routers } from "./lib/db.js";\n'
if "createVpnRos6" not in text:
    if anchor_imp not in text:
        raise SystemExit("import anchor missing")
    text = text.replace(anchor_imp, anchor_imp + imp, 1)
route = '''    if (sub === "/vpn-ros6" && method === "POST") {
      try {
        const data = await createVpnRos6(body);
        Audit.add({ type: "manual", action: "vpn-ros6-add", detail: data.name + " " + data.username + " " + data.tunnelIp, ok: true });
        return ok(data);
      } catch (e) {
        return send(res, e.status || 400, { ok: false, error: e.message || "v6 create failed" });
      }
    }
'''
if 'sub === "/vpn-ros6"' not in text:
    anchor = '    if (sub === "/routers" && method === "GET") {'
    if anchor not in text:
        raise SystemExit("route anchor missing")
    text = text.replace(anchor, route + anchor, 1)
if text == SERVER.read_text():
    print("server already wired")
else:
    backup = SERVER.with_name("server.js.bak-ros6-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    shutil.copy2(SERVER, backup)
    SERVER.write_text(text)
    print("server wired", backup.name)
