// RouterOS v6 SSTP client, same shape as jmfx.pro/vpnserver (SoftEther, port 992).
// connect-to is host:port. RouterOS v6 rejects a separate port= property.
import crypto from "node:crypto";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Routers } from "./db.js";

const execFileAsync = promisify(execFile);
const HUB = "JMVPN";
const DIAL_HOST = process.env.VPN_SERVER_IP || process.env.VPN_PUBLIC_HOST || "jmwifi.pro";
const DIAL_PORT = Number(process.env.JM_VPN_SSTP_PORT || process.env.VPN_DIAL_PORT || 992) || 992;
const IFACE = "SPVPN";
const GW = "192.168.30.1";

function adminPassword() {
  const text = fs.readFileSync("/etc/jm-softether.env", "utf8");
  const line = text.split(/\n/).find((l) => l.startsWith("VPN_ADMIN_PASSWORD="));
  const pass = line ? line.slice("VPN_ADMIN_PASSWORD=".length).trim() : "";
  if (!/^[A-Za-z0-9]{16,64}$/.test(pass)) throw new Error("SoftEther is not configured");
  return pass;
}

async function vpncmd(args, hub) {
  const argv = ["127.0.0.1:5555", "/SERVER", `/PASSWORD:${adminPassword()}`];
  if (hub) argv.push(`/ADMINHUB:${hub}`);
  argv.push("/CMD", ...args);
  const { stdout, stderr } = await execFileAsync("/usr/local/vpnserver/vpncmd", argv, { timeout: 20000 });
  const out = `${stdout || ""}\n${stderr || ""}`;
  if (!/completed successfully/i.test(out)) {
    const detail = out.split("\n").map((l) => l.trim()).filter((l) => l && !/^(vpncmd|Version|Compiled|Copyright|Connection |You have|The Virtual|VPN Server)/.test(l)).slice(-6).join(" ");
    const err = new Error(detail.slice(0, 280) || "vpncmd failed");
    throw err;
  }
  return out;
}

function nextTunnelIp() {
  const used = new Set();
  for (const r of Routers.list()) {
    for (const src of [r.host, r.vpn_notes]) {
      const m = String(src || "").match(/192\.168\.30\.(\d+)/);
      if (m) used.add(Number(m[1]));
    }
  }
  for (let n = 101; n <= 200; n++) {
    if (!used.has(n)) return `192.168.30.${n}`;
  }
  throw new Error("VPN IP pool is full");
}

function scriptV6({ user, pass, apiUser, apiPass, ip }) {
  const dial = `${DIAL_HOST}:${DIAL_PORT}`;
  const add =
    `/interface sstp-client add name="${IFACE}" connect-to="${dial}" ` +
    `user="${user}" password="${pass}" disabled=no ` +
    `verify-server-certificate=no verify-server-address-from-certificate=no`;
  if (/\sport=/.test(add)) throw new Error("v6 script invalid");
  const lines = [
    ':put "=== JM VPN RouterOS v6 ==="',
    `:put "Dial ${dial}"`,
    ":do { /system package enable sstp } on-error={}",
    ":delay 1s",
    `:do { /interface sstp-client remove [find name="${IFACE}"] } on-error={}`,
    add,
    `:do { /interface sstp-client enable [find name="${IFACE}"] } on-error={}`,
    `:do { /ip address remove [find interface=${IFACE}] } on-error={}`,
    `/ip address add address=${ip}/24 interface=${IFACE}`,
    `:do { /user remove [find name="${apiUser}"] } on-error={}`,
    `:do { /user add name="${apiUser}" password="${apiPass}" group=full comment="JM VPN API" } on-error={}`,
    `:do { /user set [find name="${apiUser}"] password="${apiPass}" group=full } on-error={}`,
    ':do { /ip firewall filter remove [find comment~"JM VPN"] } on-error={}',
    `:do { /ip firewall filter add chain=input action=accept in-interface=${IFACE} comment="JM VPN SSTP" place-before=0 } on-error={ /ip firewall filter add chain=input action=accept in-interface=${IFACE} comment="JM VPN SSTP" }`,
    ':do { /ip firewall filter add chain=input action=accept src-address=192.168.30.0/24 protocol=tcp dst-port=8728,8291 comment="JM VPN LAN API" place-before=0 } on-error={ /ip firewall filter add chain=input action=accept src-address=192.168.30.0/24 protocol=tcp dst-port=8728,8291 comment="JM VPN LAN API" }',
    "/ip service set api disabled=no port=8728 address=0.0.0.0/0",
    "/ip service set winbox disabled=no",
    ':do { /tool netwatch remove [find comment="JM VPN Watchdog"] } on-error={}',
    `/tool netwatch add host=${GW} interval=1m comment="JM VPN Watchdog" down-script="/interface sstp-client disable [find name=${IFACE}]" up-script="/interface sstp-client enable [find name=${IFACE}]"`,
    ':put "=== DONE — SSTP R, then the site goes online in the MikroTik list ==="',
    "/interface sstp-client print detail",
  ];
  return lines.join("\n") + "\n";
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
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18);
    user = `${slug || "ros6"}-${crypto.randomBytes(2).toString("hex")}`;
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(user)) {
    const err = new Error("SSTP username: 3-32 letters, numbers, dot, dash.");
    err.status = 400;
    throw err;
  }
  let pass = String(body?.password || "").trim();
  if (!pass) pass = crypto.randomBytes(4).toString("hex");
  if (!/^[A-Za-z0-9._@:%!+-]{8,64}$/.test(pass)) {
    const err = new Error("SSTP password: 8-64 letters, numbers, or . _ @ : % ! + -");
    err.status = 400;
    throw err;
  }
  const apiUser = "jmcloud";
  const apiPass = crypto.randomBytes(6).toString("hex");
  const ip = nextTunnelIp();
  try {
    await vpncmd(["UserCreate", user, "/GROUP:none", "/REALNAME:none", "/NOTE:ros6"], HUB);
  } catch (e) {
    const err = new Error(/already exists/i.test(e.message) ? "SSTP username ay gamit na" : e.message);
    err.status = /already exists/i.test(e.message) ? 409 : 502;
    throw err;
  }
  try {
    await vpncmd(["UserPasswordSet", user, `/PASSWORD:${pass}`], HUB);
    const script = scriptV6({ user, pass, apiUser, apiPass, ip });
    const router = Routers.create({
      name,
      host: ip,
      port: 8728,
      username: apiUser,
      password: apiPass,
      ssl: 0,
      area: "",
      vpn_notes: `RouterOS v6 · SoftEther ${DIAL_HOST}:${DIAL_PORT} · user ${user} · tunnel ${ip}`,
      enabled: 1,
    });
    return {
      name: router.name,
      username: user,
      password: pass,
      apiUser,
      apiPassword: apiPass,
      tunnelIp: ip,
      sstpServer: DIAL_HOST,
      sstpPort: DIAL_PORT,
      script,
      routerId: router.id,
    };
  } catch (e) {
    try { await vpncmd(["UserDelete", user], HUB); } catch {}
    if (!e.status) e.status = 500;
    throw e;
  }
}
