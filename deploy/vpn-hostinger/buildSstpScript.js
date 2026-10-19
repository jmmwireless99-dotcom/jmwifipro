function buildSstpScript({ server, username, password, ifaceName }) {
  const name = String(ifaceName || "sstp-jm").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "sstp-jm";
  let host = String(server || "").trim().replace(/^https?:\/\//, "").split("/")[0];
  const dialPort = Number(Settings.get("jm_vpn_sstp_port", "") || process.env.JM_VPN_SSTP_PORT || process.env.VPN_DIAL_PORT || 992) || 992;
  if (host && !/:\d+$/.test(host) && dialPort && dialPort !== 443) host = host + ":" + dialPort;
  const user = String(username || "").trim();
  const pass = String(password || "");
  return `# JM TECH — MikroTik SSTP VPN client (jmwifi.pro SoftEther)
# Import in Winbox / Terminal. Dial host:port for RouterOS v6.
/interface sstp-client
add name="${name}" connect-to="${host}" user="${user}" password="${pass}" disabled=no \\
    profile=default-encryption add-default-route=no use-peer-dns=no verify-server-certificate=no
/ip firewall filter
add chain=input action=accept in-interface="${name}" comment="JM VPN SSTP" place-before=0
/ip route
add comment="via-${name}" dst-address=192.168.30.0/24 gateway="${name}" distance=1
`;
}
