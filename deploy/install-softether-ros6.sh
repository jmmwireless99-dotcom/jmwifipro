#!/bin/bash
# SoftEther SSTP for RouterOS v6, same layout as jmfx.pro/vpnserver.
# Listens on 992 only. Does not restart accel-ppp (existing clients stay on 4443).
set -euo pipefail
install -d -m 755 /usr/local/vpnserver
if [[ ! -x /usr/local/vpnserver/vpnserver ]]; then
  tar -C /usr/local/vpnserver -xf /tmp/vpnserver-ros6.tar
  chmod 700 /usr/local/vpnserver/vpnserver /usr/local/vpnserver/vpncmd /usr/local/vpnserver/hamcore.se2
fi
cat > /usr/local/vpnserver/tap-up.sh << 'EOF'
#!/bin/bash
for _ in $(seq 1 30); do
  if ip link show tap_tap_jmvpn >/dev/null 2>&1; then
    ip link set tap_tap_jmvpn up || true
    ip addr show tap_tap_jmvpn | grep -q '192.168.30.254/' || ip addr add 192.168.30.254/24 dev tap_tap_jmvpn || true
    exit 0
  fi
  sleep 1
done
exit 0
EOF
chmod 755 /usr/local/vpnserver/tap-up.sh
cat > /etc/systemd/system/vpnserver.service << 'EOF'
[Unit]
Description=SoftEther VPN Server (RouterOS v6 SSTP 992)
After=network.target

[Service]
Type=forking
ExecStart=/usr/local/vpnserver/vpnserver start
ExecStartPost=/usr/local/vpnserver/tap-up.sh
ExecStop=/usr/local/vpnserver/vpnserver stop
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable vpnserver
if ! ss -ltn | grep -q ':5555'; then
  systemctl start vpnserver
fi
for _ in $(seq 1 20); do
  ss -ltn | grep -q ':5555' && break
  sleep 1
done
ss -ltn | grep -q ':5555'
if [[ ! -f /etc/jm-softether.env ]]; then
  pass=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
  umask 077
  printf 'VPN_ADMIN_PASSWORD=%s\nVPN_HUB=JMVPN\nVPN_SSTP_PORT=992\n' "$pass" > /etc/jm-softether.env
  chmod 600 /etc/jm-softether.env
  /usr/local/vpnserver/vpncmd 127.0.0.1:5555 /SERVER /CMD ServerPasswordSet "$pass" >/tmp/se-init.log
fi
pass=$(python3 -c 'import re; t=open("/etc/jm-softether.env").read(); print(re.search(r"^VPN_ADMIN_PASSWORD=(.+)$", t, re.M).group(1).strip())')
vc() { /usr/local/vpnserver/vpncmd 127.0.0.1:5555 /SERVER /PASSWORD:"$pass" "$@"; }
if ! vc /CMD HubList | grep -q JMVPN; then
  vc /CMD HubCreate JMVPN "/PASSWORD:$pass" >/tmp/se-hub.log
fi
vc /ADMINHUB:JMVPN /CMD SecureNatEnable >/tmp/se-nat.log || true
if ! vc /CMD BridgeList | grep -q tap_jmvpn; then
  vc /CMD BridgeCreate JMVPN /DEVICE:tap_jmvpn /TAP:yes >/tmp/se-bridge.log
fi
vc /CMD ListenerDelete 443 >/tmp/se-l443.log || true
vc /CMD ListenerDelete 1194 >/tmp/se-l1194.log || true
vc /CMD SstpEnable yes >/tmp/se-sstp.log
/usr/local/vpnserver/tap-up.sh
echo SOFTETHER_READY
ss -ltn | awk '$4 ~ /:992$|:5555$|:443$|:4443$/ {print}'
