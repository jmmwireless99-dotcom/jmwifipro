import http from "node:http";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { createConnection } from "node:net";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 8081);
const USER = process.env.MRP_USER || "admin";
const PASS = process.env.MRP_PASSWORD || "wireless@jmm3000";
const VPN_PUBLIC = process.env.VPN_PUBLIC || "jmwifi.pro:992";
const HUB = process.env.VPN_HUB || "JMVPN";
const tokens = new Map();

function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
  res.end(body);
}

function html(res, code, body) {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function adminPassword() {
  const text = fs.readFileSync("/etc/jm-softether.env", "utf8");
  const line = text.split(/\n/).find((l) => l.startsWith("VPN_ADMIN_PASSWORD="));
  const pass = line ? line.slice("VPN_ADMIN_PASSWORD=".length).trim() : "";
  if (!pass) throw new Error("SoftEther admin password missing");
  return pass;
}

async function vpncmd(args, hub) {
  const argv = ["127.0.0.1:5555", "/SERVER", `/PASSWORD:${adminPassword()}`];
  if (hub) argv.push(`/ADMINHUB:${hub}`);
  argv.push("/CMD", ...args);
  const { stdout, stderr } = await execFileAsync("/usr/local/vpnserver/vpncmd", argv, { timeout: 20000 });
  const out = `${stdout || ""}\n${stderr || ""}`;
  if (!/completed successfully/i.test(out)) {
    const detail = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^(vpncmd|Version|Compiled|Copyright|Connection |You have|The Virtual|VPN Server)/.test(l))
      .slice(-6)
      .join(" ");
    throw new Error(detail.slice(0, 280) || "vpncmd failed");
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw));
  });
}

function authOk(req) {
  const h = String(req.headers.authorization || "");
  if (h.startsWith("Bearer ")) {
    const t = h.slice(7);
    const row = tokens.get(t);
    if (row && row.exp > Date.now()) return true;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const sso = url.searchParams.get("sso");
  if (sso && tokens.has(sso)) {
    const row = tokens.get(sso);
    if (row && row.exp > Date.now()) return true;
  }
  return false;
}

async function probePort(port) {
  return new Promise((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    s.setTimeout(1000, () => {
      s.destroy();
      resolve(false);
    });
  });
}

async function vpnStatus() {
  let softether = "stopped";
  try {
    await execFileAsync("pgrep", ["-a", "vpnserver"], { timeout: 2000 });
    softether = "running";
  } catch {
    softether = "stopped";
  }
  const [p992, p4443, p5555] = await Promise.all([probePort(992), probePort(4443), probePort(5555)]);
  let users = [];
  if (softether === "running") {
    try {
      const out = await vpncmd(["UserList"], HUB);
      const names = [...out.matchAll(/User Name\s*\|\s*(\S+)/g)].map((m) => m[1]);
      users = names;
    } catch {
      users = [];
    }
  }
  return {
    ok: true,
    softether,
    hub: HUB,
    listen_992: p992,
    listen_4443: p4443,
    listen_5555: p5555,
    public_vpn: VPN_PUBLIC,
    dial: VPN_PUBLIC,
    users,
    note: "jmwifi.pro SoftEther SSTP — Create VPN Client uses hub JMVPN",
  };
}

function page(tab, action) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JM Ops — VPN</title>
<style>
:root{--bg:#0b1220;--card:#121a2b;--line:#243049;--text:#e8eefc;--muted:#9db0d0;--ok:#3ddc97;--bad:#ff6b6b;--accent:#4ea1ff}
*{box-sizing:border-box}body{font-family:system-ui,sans-serif;margin:0;background:var(--bg);color:var(--text)}
.wrap{max-width:920px;margin:0 auto;padding:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
h1{font-size:1.2rem;margin:0 0 6px}.muted{color:var(--muted);font-size:.92rem}
.ok{color:var(--ok)}.bad{color:var(--bad)}code{background:#0b1220;padding:2px 6px;border-radius:6px}
label{display:block;margin:10px 0 4px;font-size:.85rem;color:var(--muted)}
input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:#0b1220;color:var(--text)}
button{margin-top:12px;padding:10px 14px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
pre{white-space:pre-wrap;word-break:break-word;background:#0b1220;padding:12px;border-radius:8px;border:1px solid var(--line);font-size:.85rem}
.row{display:flex;gap:10px;flex-wrap:wrap}.row>*{flex:1;min-width:160px}
</style></head><body><div class="wrap">
<h1>JM Ops <span class="muted">(${tab || "vpn"})</span></h1>
<div class="card">
<p><b class="ok">jmwifi.pro SoftEther VPN</b> — tunnel server live on Hostinger.</p>
<p class="muted">Dial: <code id="dial">${VPN_PUBLIC}</code> · Hub <code>${HUB}</code> · SecureNAT <code>192.168.30.0/24</code></p>
</div>
<div class="card" id="st"><p class="muted">Loading SoftEther status…</p></div>
<div class="card" id="create">
<h1>Create VPN Client</h1>
<p class="muted">Creates SoftEther hub user + MikroTik SSTP script (same as billing Add VPN Client v6).</p>
<div class="row">
  <div><label>Site / client name</label><input id="name" placeholder="DemoSite"></div>
  <div><label>SSTP username (optional)</label><input id="user" placeholder="demosite01"></div>
</div>
<label>SSTP password (optional)</label><input id="pass" placeholder="auto-generate if blank">
<button id="go" type="button">Create VPN Client</button>
<p id="err" class="bad" style="display:none"></p>
<pre id="out" style="display:none"></pre>
</div>
<script>
const action=${JSON.stringify(action || "")};
// Under nginx /cctv/ → MRP; keep API calls on the same prefix.
const API_BASE = location.pathname.startsWith("/cctv") ? "/cctv" : "";
async function refresh(){
  const r=await fetch(API_BASE + "/api/vpn-status");
  const d=await r.json();
  document.getElementById("st").innerHTML =
    "<p>SoftEther: <b class='"+(d.softether==="running"?"ok":"bad")+"'>"+d.softether+"</b></p>"+
    "<p class='muted'>992: "+(d.listen_992?"OK":"down")+" · 4443: "+(d.listen_4443?"OK":"down")+" · 5555: "+(d.listen_5555?"OK":"down")+"</p>"+
    "<p class='muted'>Users: "+(d.users&&d.users.length?d.users.join(", "):"(none)")+"</p>"+
    "<p class='muted'>Public dial: <code>"+(d.public_vpn||"")+"</code></p>";
  if(d.public_vpn) document.getElementById("dial").textContent=d.public_vpn;
}
refresh().catch(e=>{document.getElementById("st").innerHTML="<p class=bad>"+e+"</p>";});
document.getElementById("go").onclick=async()=>{
  const err=document.getElementById("err");
  const out=document.getElementById("out");
  const go=document.getElementById("go");
  err.style.display="none"; out.style.display="none";
  const name=document.getElementById("name").value.trim();
  if(!name){err.style.display="";err.textContent="Site name required";return;}
  go.disabled=true; go.textContent="Creating…";
  try{
    const body={name};
    const u=document.getElementById("user").value.trim();
    const p=document.getElementById("pass").value;
    if(u) body.username=u;
    if(p) body.password=p;
    const r=await fetch(API_BASE + "/api/vpn/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok||!j.ok) throw new Error(j.error||("HTTP "+r.status));
    out.style.display="";
    out.textContent="Dial: "+j.data.dial+"\\nUser: "+j.data.username+"\\nPass: "+j.data.password+"\\nTunnel: "+j.data.tunnelIp+"\\n\\n"+j.data.script;
    refresh();
  }catch(e){
    err.style.display=""; err.textContent=e.message||String(e);
  }finally{
    go.disabled=false; go.textContent="Create VPN Client";
  }
};
if(action==="add") document.getElementById("name").focus();
</script>
</div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "*",
    });
    return res.end();
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {}
    const u = String(body.username || "");
    const p = String(body.password || "");
    if (u !== USER || p !== PASS) return send(res, 401, { ok: false, error: "invalid credentials" });
    const token = crypto.randomBytes(24).toString("hex");
    tokens.set(token, { exp: Date.now() + 12 * 3600 * 1000 });
    return send(res, 200, {
      token,
      role: "admin",
      displayName: "Admin",
      canPlayback: true,
      canManageAccounts: true,
    });
  }

  if (url.pathname === "/api/vpn-status") {
    try {
      return send(res, 200, await vpnStatus());
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message });
    }
  }

  if (url.pathname === "/api/vpn/create" && req.method === "POST") {
    try {
      let body = {};
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch {}
      const name = String(body.name || "").trim();
      if (!name) return send(res, 400, { ok: false, error: "Site name is required." });
      let user = String(body.username || "").trim().toLowerCase();
      if (!user) {
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 18);
        user = `${slug || "vpn"}-${crypto.randomBytes(2).toString("hex")}`;
      }
      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(user)) {
        return send(res, 400, { ok: false, error: "SSTP username: 3-32 letters, numbers, dot, dash." });
      }
      let pass = String(body.password || "").trim();
      if (!pass) pass = crypto.randomBytes(4).toString("hex");
      // Allocate next free-looking tunnel IP from DHCP range note (client gets DHCP/SecureNAT)
      const tunnelIp = `192.168.30.${100 + (crypto.randomBytes(1)[0] % 100)}`;
      try {
        await vpncmd(["UserCreate", user, "/GROUP:none", "/REALNAME:none", "/NOTE:jm-ops"], HUB);
      } catch (e) {
        if (/already exists/i.test(e.message)) return send(res, 409, { ok: false, error: "SSTP username ay gamit na" });
        throw e;
      }
      await vpncmd(["UserPasswordSet", user, `/PASSWORD:${pass}`], HUB);
      const dial = VPN_PUBLIC.includes(":") ? VPN_PUBLIC : `${VPN_PUBLIC}:992`;
      const script = [
        ':put "=== JM VPN SoftEther SSTP ==="',
        `:put "Dial ${dial}"`,
        ':do { /system package enable sstp } on-error={}',
        ':do { /interface sstp-client remove [find name="SPVPN"] } on-error={}',
        `/interface sstp-client add name="SPVPN" connect-to="${dial}" user="${user}" password="${pass}" disabled=no verify-server-certificate=no verify-server-address-from-certificate=no`,
        ':do { /interface sstp-client enable [find name="SPVPN"] } on-error={}',
        `/ip address add address=${tunnelIp}/24 interface=SPVPN`,
        ':do { /ip firewall filter add chain=input action=accept in-interface=SPVPN comment="JM VPN SSTP" place-before=0 } on-error={}',
        '/ip service set api disabled=no port=8728',
        '/interface sstp-client print detail',
      ].join("\n");
      return send(res, 200, {
        ok: true,
        data: { name, username: user, password: pass, tunnelIp, dial, hub: HUB, script },
      });
    } catch (e) {
      return send(res, 502, { ok: false, error: e.message || "create failed" });
    }
  }

  if (url.pathname.startsWith("/api/")) {
    return send(res, 200, { ok: true, note: "jm-mrp SoftEther VPN on jmwifi.pro", dial: VPN_PUBLIC });
  }

  return html(res, 200, page(url.searchParams.get("tab") || "home", url.searchParams.get("action") || ""));
});

server.listen(PORT, "127.0.0.1", () => console.log("jm-mrp SoftEther VPN on", PORT, VPN_PUBLIC));
