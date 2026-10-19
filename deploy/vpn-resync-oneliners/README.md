# SSTP reconnect one-liners (RouterOS 7)

Paste into MikroTik **New Terminal**.

**Correct ROS7 form** (IP + separate `port=`):

```
:do { /interface sstp-client remove [find name="sstp-cctv"] } on-error={}; :do { /interface sstp-client remove [find name="SPVPN"] } on-error={}; /interface sstp-client add name="sstp-cctv" connect-to="187.77.145.131" port=4443 user="USER" password="PASS" disabled=no verify-server-certificate=no verify-server-address-from-certificate=no; /interface sstp-client enable [find name="sstp-cctv"]; /interface sstp-client print detail
```

Do not use `connect-to="jmwifi.pro:4443"` (bad address on ROS7).

Passwords are redacted in git. Live copies:

- VPS: `/opt/jm-billing/deploy/vpn-resync-oneliners/`
- VPS multi-line: `/opt/jm-billing/deploy/vpn-resync-scripts/`
