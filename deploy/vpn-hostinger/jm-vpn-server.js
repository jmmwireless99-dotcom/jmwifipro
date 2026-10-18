// JM VPN Server — SoftEther SSTP hub management (built-in, no Kurifot dependency).
import fs from "node:fs";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { Settings } from "./db.js";

const DEFAULT_SCRIPT = "/opt/jm-vpn-portal/scripts/sstp-user.sh";
const VPNCMD = "/usr/local/vpnserver/vpncmd";
const POOL_START = 100;
const POOL_END = 250;
const POOL_PREFIX = "192.168.30.";
const SHELL_MS = 5000;
export const MIKROTIK_ROS_API_PORT = 8728;

function cfg() {
  const s = Settings.all();
  return {
    enabled: s.jm_vpn_enabled !== "0",
    host: (s.jm_vpn_host || process.env.VPN_SERVER_IP || process.env.PUBLIC_URL || "").replace(/^https?:\/\//, "").split("/")[0].split(":")[0] || "127.0.0.1",
    gw: s.jm_vpn_gw || "192.168.30.1",
    hub: s.jm_vpn_hub || "JMVPN",
    hubPass: s.jm_vpn_hub_pass || process.env.SSTP_HUB_PASS || "HubPass2026",
    script: s.jm_vpn_script || process.env.JM_VPN_SCRIPT || DEFAULT_SCRIPT,
    apiPort: Number(s.jm_vpn_api_port || process.env.JM_VPN_API_PORT || 20494) || 20494,
    sstpPort: Number(s.jm_vpn_sstp_port || process.env.JM_VPN_SSTP_PORT || 992) || 992,
    relayMode: s.jm_vpn_relay_mode !== "0",
    publicHost: (s.jm_vpn_host || process.env.VPN_SERVER_IP || "jmwifi.pro").replace(/^https?:\/\//, "").split("/")[0].split(":")[0],
  };
}

export function apiPort() {
  return cfg().apiPort;
}

function shell(cmd, ms = SHELL_MS) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: ms }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || "", stderr: stderr || "", timedOut: !!(err && err.killed) });
    });
  });
}

export function vpnEnabled() {
  const c = cfg();
  return c.enabled && (fs.existsSync(c.script) || fs.existsSync(VPNCMD));
}

export function genVpnPassword() {
  return crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
}

export function vpnUserForRouter(router) {
  const base = String(router.name || "SITE")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 10)
    .toUpperCase() || "SITE";
  return `JMVPN-${base}-${router.id}`;
}

export function nextTunnelIp(usedIps) {
  const used = new Set((usedIps || []).filter(Boolean));
  for (let i = POOL_START; i <= POOL_END; i++) {
    const ip = `${POOL_PREFIX}${i}`;
    if (!used.has(ip)) return ip;
  }
  throw new Error("JM VPN IP pool full (10.30.97.100–250)");
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

async function vpncmd(args, ms = SHELL_MS) {
  const c = cfg();
  if (!fs.existsSync(VPNCMD)) throw new Error("SoftEther vpncmd not found");
  let admin = process.env.SSTP_ADMIN_PASS || "";
  if (!admin) {
    try {
      const envTxt = fs.readFileSync("/etc/jm-softether.env", "utf8");
      const line = envTxt.split(/\n/).find((l) => l.startsWith("VPN_ADMIN_PASSWORD="));
      admin = line ? line.slice("VPN_ADMIN_PASSWORD=".length).trim() : "";
    } catch {}
  }
  if (!admin) admin = "JMVPN@Admin2026";
  const cmd = `timeout ${Math.ceil(ms / 1000)} ${VPNCMD} 127.0.0.1:5555 /SERVER /PASSWORD:${shQuote(admin)} /ADMINHUB:${c.hub} /CMD ${args}`;
  return shell(cmd, ms + 500);
}

export async function addSstpUser(username, password) {
  const c = cfg();
  if (fs.existsSync(c.script)) {
    const r = await shell(`timeout 8 bash ${shQuote(c.script)} add ${shQuote(username)} ${shQuote(password)}`, 9000);
    if (!r.ok && !r.stdout.includes("OK")) throw new Error(r.stderr || r.stdout || "Failed to create SSTP user");
    return { ok: true };
  }
  await vpncmd(`UserCreate ${shQuote(username)} /GROUP:none /REALNAME:none /NOTE:none`, 8000);
  const r2 = await vpncmd(`UserPasswordSet ${shQuote(username)} /PASSWORD:${shQuote(password)}`, 8000);
  if (!r2.ok) throw new Error(r2.stderr || "Failed to set SSTP password");
  return { ok: true };
}

export async function delSstpUser(username) {
  if (fs.existsSync(cfg().script)) {
    await shell(`timeout 5 bash ${shQuote(cfg().script)} del ${shQuote(username)}`, 6000);
  } else {
    await vpncmd(`UserDelete ${shQuote(username)}`, 5000);
  }
  return { ok: true };
}

export async function listSessions() {
  if (!vpnEnabled()) return [];
  let out = "";
  if (fs.existsSync(cfg().script)) {
    const r = await shell(`timeout 4 bash ${shQuote(cfg().script)} list`, 5000);
    if (!r.ok) return [];
    out = r.stdout;
  } else {
    const r = await vpncmd("SessionList", 4000);
    if (!r.ok) return [];
    out = r.stdout;
  }
  const sessions = [];
  const blocks = out.split(/Session Name\s*:/i).slice(1);
  for (const block of blocks) {
    const nameM = block.match(/^\s*(\S+)/);
    const ipM = block.match(/IPv4 Address\s*:\s*(\d+\.\d+\.\d+\.\d+)/i);
    if (nameM) sessions.push({ user: nameM[1].split("@")[0], ip: ipM ? ipM[1] : "" });
  }
  if (!sessions.length) {
    for (const line of out.split("\n")) {
      const m = line.match(/(\S+)\s+.*?((?:10\.30\.97|192\.168\.30)\.\d+)/);
      if (m) sessions.push({ user: m[1].split("@")[0], ip: m[2] });
    }
  }
  return sessions;
}

export async function serverStatus(opts = {}) {
  const c = cfg();
  const includeSessions = !!opts.sessions;
  const [se, up, listen] = await Promise.all([
    shell("systemctl is-active vpnserver 2>/dev/null", 2000),
    shell("uptime -p 2>/dev/null", 2000),
    shell("ss -tlnp 2>/dev/null | grep ':443' | head -1", 2000),
  ]);
  let sessions = [];
  if (includeSessions) {
    try { sessions = await listSessions(); } catch { sessions = []; }
  }
  return {
    enabled: c.enabled,
    installed: fs.existsSync(c.script) || fs.existsSync(VPNCMD),
    host: c.host,
    gateway: c.gw,
    hub: c.hub,
    protocol: "SSTP/443",
    service: se.stdout.trim(),
    uptime: up.ok ? up.stdout.trim() : "",
    listening: listen.stdout.includes(":443"),
    online_sessions: sessions.length,
    sessions,
    api_port: c.apiPort,
  };
}

export function billingConnection(tunnelIp, port) {
  const c = cfg();
  const p = Number(port) || apiPort();
  if (c.relayMode) {
    return {
      host: c.publicHost,
      port: p,
      note: "jmwifi.pro billing: Host = VPN server IP, Port = relay port (20494). MikroTik = client lang sa VPN.",
    };
  }
  return {
    host: tunnelIp || "",
    port: p,
    note: "Billing → MikroTik Sites: VPN IP = host, API Port = port, username/password = MikroTik API user mo.",
  };
}

export function vpnPublicHost() {
  return cfg().publicHost;
}

export function vpnGateway() {
  return cfg().gw;
}

export function mikrotikSstpScript(vpnUser, vpnPassword, opts = {}) {
  const c = cfg();
  const iface = "JMVPN_VPN1";
  const portArg = c.sstpPort && c.sstpPort !== 443 ? ` port=${c.sstpPort}` : "";
  const planType = String(opts.planType || "B").toUpperCase();
  const servicePort = String(opts.servicePort || "");
  const lines = [
    `/interface sstp-client remove [find name="${iface}"]`,
    `/ip firewall filter remove [find comment="Allow JM VPN Remote Access"]`,
    `/ip firewall filter remove [find comment="JM VPN API"]`,
    `/ip firewall filter remove [find comment="JM VPN billing relay"]`,
    `/interface sstp-client add connect-to="${c.publicHost}"${portArg} disabled=no name="${iface}" user="${vpnUser}" password="${vpnPassword}" verify-server-certificate=no verify-server-address-from-certificate=no`,
    `:if ([:len [/ip firewall filter find where chain=input and action=drop]] > 0) do={`,
    `    /ip firewall filter add action=accept chain=input comment="Allow JM VPN Remote Access" in-interface="${iface}" place-before=1`,
    `} else={`,
    `    /ip firewall filter add action=accept chain=input comment="Allow JM VPN Remote Access" in-interface="${iface}"`,
    `}`,
  ];
  if (planType === "B" || planType === "C") {
    lines.push(`/ip service set winbox disabled=no`);
    lines.push(`/ip service set api disabled=no port=${MIKROTIK_ROS_API_PORT}`);
    lines.push(`/ip service set www disabled=no`);
  } else if (servicePort === "8291") {
    lines.push(`/ip service set winbox disabled=no`);
  } else if (servicePort === "80") {
    lines.push(`/ip service set www disabled=no`);
  } else {
    lines.push(`/ip service set api disabled=no port=${MIKROTIK_ROS_API_PORT}`);
  }
  lines.push(`/ip firewall filter add chain=input protocol=tcp dst-port=${MIKROTIK_ROS_API_PORT} in-interface=${iface} action=accept comment="JM VPN API"`);
  lines.push(`/ip firewall filter add chain=input src-address=192.168.30.0/24 action=accept comment="JM VPN billing relay"`);
  return lines.join("\n");
}

export function netwatchScript() {
  const c = cfg();
  return [
    `/tool netwatch remove [find comment="JM VPN Watchdog"]`,
    `/tool netwatch add host=${c.gw} interval=1m timeout=10s comment="JM VPN Watchdog" down-script=":log warning \\"JM VPN: server unreachable\\"; /interface sstp-client disable [find name=\\"JMVPN_VPN1\\"]; :delay 10s; /interface sstp-client enable [find name=\\"JMVPN_VPN1\\"]" up-script=":log warning \\"JM VPN: connectivity restored\\""`,
  ].join("\n");
}

export async function provisionRouterVpn(router, usedIps) {
  if (!vpnEnabled()) throw new Error("JM VPN server is not enabled or not installed");
  let user = router.vpn_user;
  let pass = router.vpn_password;
  let ip = router.vpn_tunnel_ip;
  if (!user) user = vpnUserForRouter(router);
  if (!pass) pass = genVpnPassword();
  if (!ip) ip = nextTunnelIp(usedIps);
  await addSstpUser(user, pass);
  return { vpn_user: user, vpn_password: pass, vpn_tunnel_ip: ip, vpn_status: "pending" };
}

export async function syncRouterVpnStatus(routers) {
  if (!vpnEnabled()) return { synced: 0, updates: [], sessions: [] };
  const c = cfg();
  const sessions = await listSessions();
  const byUser = new Map(sessions.filter((s) => s.user).map((s) => [s.user.toLowerCase(), s.ip]));
  const updates = [];
  for (const r of routers) {
    if (!r.vpn_user) continue;
    const liveIp = byUser.get((r.vpn_user || "").toLowerCase());
    const online = !!liveIp;
    const row = { id: r.id, vpn_status: online ? "online" : "offline" };
    if (online && liveIp) {
      row.vpn_tunnel_ip = liveIp;
      if (c.relayMode) {
        row.host = c.publicHost;
        if (!r.port || Number(r.port) === 8728) row.port = apiPort();
      } else if (!r.host || r.host.startsWith("10.8.") || r.host.includes("kurifot") || r.host.includes("wifree") || r.host === c.publicHost || (!r.host.startsWith("10.30.97.") && !r.host.startsWith("192.168.30."))) {
        row.host = liveIp;
      }
      if (!c.relayMode && (!r.port || Number(r.port) === 8728)) row.port = apiPort();
    }
    updates.push(row);
  }
  return { synced: updates.length, sessions, updates };
}
