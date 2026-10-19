// RouterOS SSTP client for jmwifi.pro accel-ppp tunnel (port 4443, pool 10.90.0.0/24).
// Create VPN Client v6 → chap-secrets + DNAT + MikroTik script. SoftEther stays on :992 for other use.
import crypto from "node:crypto";
import fs from "node:fs";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import { Routers } from "./db.js";

const execFileAsync = promisify(execFile);

const DIAL_HOST = process.env.VPN_SERVER_IP || process.env.VPN_PUBLIC_HOST || "jmwifi.pro";
const DIAL_PORT = Number(process.env.JM_VPN_SSTP_PORT || process.env.VPN_DIAL_PORT || 4443) || 4443;
const BILLING_HOST = process.env.VPN_PUBLIC_IP || "187.77.145.131";
const IFACE = "sstp-cctv";
const GW = "10.90.0.1";
const CHAP = "/etc/ppp/chap-secrets";
const NFT_FILE = "/etc/nftables-jm-vpn.nft";

function loadChap() {
  if (!fs.existsSync(CHAP)) return [];
  const rows = [];
  for (const line of fs.readFileSync(CHAP, "utf8").split("\n")) {
    const m = line.match(/^"([^"]+)"\s+\*\s+"([^"]+)"\s+(10\.90\.0\.\d+)/);
    if (m) rows.push({ user: m[1], pass: m[2], ip: m[3] });
  }
  return rows;
}

function nextTunnelIp(used) {
  const set = new Set(used);
  for (let n = 10; n <= 250; n++) {
    const ip = `10.90.0.${n}`;
    if (!set.has(ip)) return ip;
  }
  throw new Error("VPN IP pool full (10.90.0.10–250)");
}

function nextApiPort(usedPorts) {
  const set = new Set(usedPorts.map(Number));
  for (let p = 51000; p <= 59999; p++) {
    if (!set.has(p) && !set.has(p - 1)) return p; // API; Winbox = p-1
  }
  throw new Error("VPN public port pool full");
}

function appendChap(user, pass, ip) {
  const line = `"${user}" * "${pass}" ${ip}\n`;
  if (!fs.existsSync(CHAP)) {
    fs.writeFileSync(CHAP, "# MANAGED BY jm-billing (jmwifi.pro)\n" + line, { mode: 0o600 });
  } else {
    fs.appendFileSync(CHAP, line);
  }
  try {
    fs.chmodSync(CHAP, 0o600);
  } catch {}
}

function ensureNftRule(apiPort, winboxPort, tip) {
  if (!fs.existsSync(NFT_FILE)) return;
  let txt = fs.readFileSync(NFT_FILE, "utf8");
  const apiLine = `    tcp dport ${apiPort} dnat to ${tip}:8728`;
  const wbLine = `    tcp dport ${winboxPort} dnat to ${tip}:8291`;
  if (!txt.includes(`tcp dport ${apiPort} `)) {
    txt = txt.replace(
      /(chain prerouting \{[\s\S]*?)(\n  \})/,
      `$1\n${wbLine}\n${apiLine}$2`,
    );
    fs.writeFileSync(NFT_FILE, txt);
  }
  try {
    execSync("/usr/sbin/nft delete table ip jm_vpn_dnat 2>/dev/null; /usr/sbin/nft -f " + NFT_FILE, {
      stdio: "ignore",
      shell: "/bin/bash",
    });
  } catch {}
}

async function reloadAccel() {
  try {
    await execFileAsync("accel-cmd", ["reload"], { timeout: 8000 });
  } catch {
    try {
      execSync("systemctl reload accel-ppp 2>/dev/null || systemctl restart accel-ppp", {
        stdio: "ignore",
        shell: "/bin/bash",
      });
    } catch {}
  }
}

function scriptRos({ user, pass, apiUser, apiPass, tip }) {
  const dialHost = DIAL_HOST;
  const dialPort = DIAL_PORT;
  return [
    ':put "=== JM VPN jmwifi.pro (accel-ppp SSTP) ==="',
    `:put "Dial ${dialHost}:${dialPort}"`,
    ":do { /system package enable sstp } on-error={}",
    ":delay 1s",
    `:do { /interface sstp-client remove [find name="${IFACE}"] } on-error={}`,
    `:do { /interface sstp-client remove [find name="SPVPN"] } on-error={}`,
    `/interface sstp-client add name="${IFACE}" connect-to="${dialHost}" port=${dialPort} user="${user}" password="${pass}" disabled=no verify-server-certificate=no verify-server-address-from-certificate=no`,
    `:do { /interface sstp-client enable [find name="${IFACE}"] } on-error={}`,
    `:do { /user remove [find name="${apiUser}"] } on-error={}`,
    `:do { /user add name="${apiUser}" password="${apiPass}" group=full comment="JM VPN API" } on-error={}`,
    `:do { /user set [find name="${apiUser}"] password="${apiPass}" group=full } on-error={}`,
    ':do { /ip firewall filter remove [find comment~"JM VPN"] } on-error={}',
    `:do { /ip firewall filter add chain=input action=accept in-interface=${IFACE} comment="JM VPN SSTP" place-before=0 } on-error={ /ip firewall filter add chain=input action=accept in-interface=${IFACE} comment="JM VPN SSTP" }`,
    ':do { /ip firewall filter add chain=input action=accept src-address=10.90.0.0/24 protocol=tcp dst-port=8728,8291 comment="JM VPN LAN API" place-before=0 } on-error={}',
    "/ip service set api disabled=no port=8728 address=0.0.0.0/0",
    "/ip service set winbox disabled=no",
    ':do { /tool netwatch remove [find comment="JM VPN Watchdog"] } on-error={}',
    `/tool netwatch add host=${GW} interval=1m comment="JM VPN Watchdog" down-script="/interface sstp-client disable [find name=${IFACE}]" up-script="/interface sstp-client enable [find name=${IFACE}]"`,
    ':put "=== DONE — SSTP R; site online in billing when tunnel is up ==="',
    "/interface sstp-client print detail",
  ].join("\n") + "\n";
}

export async function createVpnRos6(body) {
  const name = String(body?.name || "").trim();
  if (!name) {
    const err = new Error("Site name is required.");
    err.status = 400;
    throw err;
  }
  let user = String(body?.username || "").trim().toLowerCase();
  if (!user) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 18);
    user = `${slug || "ros6"}-${crypto.randomBytes(2).toString("hex")}`;
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(user)) {
    const err = new Error("SSTP username: 3-32 letters, numbers, dot, dash.");
    err.status = 400;
    throw err;
  }
  const existing = loadChap();
  if (existing.some((r) => r.user === user)) {
    const err = new Error("SSTP username ay gamit na");
    err.status = 409;
    throw err;
  }
  let pass = String(body?.password || "").trim();
  if (!pass) pass = crypto.randomBytes(8).toString("base64url").slice(0, 14);
  if (!/^[A-Za-z0-9._@:%!+-]{8,64}$/.test(pass)) {
    const err = new Error("SSTP password: 8-64 letters, numbers, or . _ @ : % ! + -");
    err.status = 400;
    throw err;
  }

  const tip = nextTunnelIp(existing.map((r) => r.ip));
  const usedPorts = Routers.list().map((r) => Number(r.port) || 0);
  // also occupy ports from nft file
  if (fs.existsSync(NFT_FILE)) {
    for (const m of fs.readFileSync(NFT_FILE, "utf8").matchAll(/tcp dport (\d+)/g)) {
      usedPorts.push(Number(m[1]));
    }
  }
  const apiPort = nextApiPort(usedPorts);
  const winboxPort = apiPort - 1;
  const apiUser = "jmcloud";
  const apiPass = crypto.randomBytes(6).toString("hex");

  appendChap(user, pass, tip);
  ensureNftRule(apiPort, winboxPort, tip);
  await reloadAccel();

  const script = scriptRos({ user, pass, apiUser, apiPass, tip });
  const router = Routers.create({
    name,
    host: BILLING_HOST,
    port: apiPort,
    username: apiUser,
    password: apiPass,
    ssl: 0,
    area: "",
    vpn_notes: `SSTP→${DIAL_HOST}:${DIAL_PORT} · user ${user} · tunnel ${tip} · API ${BILLING_HOST}:${apiPort}`,
    enabled: 1,
  });

  return {
    name: router.name,
    username: user,
    password: pass,
    apiUser,
    apiPassword: apiPass,
    tunnelIp: tip,
    sstpServer: DIAL_HOST,
    sstpPort: DIAL_PORT,
    billingHost: BILLING_HOST,
    billingPort: apiPort,
    winboxPort,
    script,
    routerId: router.id,
  };
}
