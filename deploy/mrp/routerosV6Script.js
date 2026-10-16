import { HUB, SSTP_PORT } from '../config.js';

function rosQuote(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Paste script for RouterOS v6.
 * Same SSTP user, password, and tunnel as the v7 script.
 * v6 rejects verify-server-address-from-certificate, so that property is omitted.
 *
 * Live copy: /opt/mrp/src/services/routerosV6Script.js
 * The existing routerosScript() in routes/stations.js is unchanged.
 */
export function routerosV6Script(s, cams = []) {
  const iface = 'sstp-cctv';
  const tag = 'JM TECH SOLUTION';
  const apiUser = String(s.api_user || s.apiUser || 'jmcloud').trim() || 'jmcloud';
  const apiPass = String(s.api_password || s.apiPassword || s.password || '');
  const apiUserQ = rosQuote(apiUser);
  const apiPassQ = rosQuote(apiPass);
  const sstpUserQ = rosQuote(s.username);
  const sstpPassQ = rosQuote(s.password);
  const lines = [
    `# --- ${tag}: RouterOS v6 paste para sa "${s.name}" ---`,
    `# Ito ang v6 client. Ang v7 script ay hiwalay at hindi binago.`,
    '',
    `# 1) SSTP VPN client → ${HUB()}:${SSTP_PORT()}`,
    `:do { /interface sstp-client remove [find name="${iface}"] } on-error={}`,
    `/interface sstp-client add name=${iface} connect-to=${HUB()} port=${SSTP_PORT()} \\`,
    `    user="${sstpUserQ}" password="${sstpPassQ}" profile=default \\`,
    `    authentication=pap,chap,mschap1,mschap2 \\`,
    `    verify-server-certificate=no disabled=no`,
    '',
    `# 2) Cloud API user`,
    `:if ([:len [/user find where name="${apiUserQ}"]] = 0) do={`,
    `  /user add name="${apiUserQ}" password="${apiPassQ}" group=full comment="${tag} cloud API"`,
    `} else={`,
    `  /user set [find where name="${apiUserQ}"] password="${apiPassQ}"`,
    `}`,
    '',
    `# 3) Winbox + API + www — VPN subnet only`,
    `/ip service set winbox disabled=no address=10.90.0.0/21`,
    `/ip service set api disabled=no address=10.90.0.0/21`,
    `/ip service set www disabled=no address=10.90.0.0/21`,
    `:do { /ip firewall filter remove [find where comment~"${tag}:"] } on-error={}`,
    `/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8291 src-address=10.90.0.0/21 comment="${tag}: Winbox via VPN"`,
    `/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8728 src-address=10.90.0.0/21 comment="${tag}: API via VPN"`,
    `/ip firewall filter add chain=input action=accept protocol=tcp dst-port=80 src-address=10.90.0.0/21 comment="${tag}: REST www via VPN"`,
    '',
    `# 4) Firewall — allow hub to reach cameras`,
    `/ip firewall filter add chain=forward action=accept connection-state=established,related comment="${tag}: established"`,
    `/ip firewall filter add chain=forward action=accept connection-nat-state=dstnat in-interface=${iface} comment="${tag}: hub to camera"`,
  ];
  if (cams.length) {
    lines.push('', `# NAT — camera ports`);
    for (const c of cams) {
      lines.push(
        `/ip firewall nat add chain=dstnat in-interface=${iface} protocol=tcp dst-port=${c.tunnel_port} \\`,
        `    action=dst-nat to-addresses=${c.lan_ip} to-ports=${c.rtsp_port} comment="${tag}: ${c.name}"`
      );
    }
  }
  lines.push('', `# Done. RouterOS v6 lang ang gumamit nito.`);
  return lines.join('\n');
}
