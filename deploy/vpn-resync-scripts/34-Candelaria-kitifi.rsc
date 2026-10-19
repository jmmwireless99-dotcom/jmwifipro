# Candelaria-kitifi — jmwifi.pro accel-ppp SSTP
# Paste in MikroTik terminal. Dial 187.77.145.131:4443 (ROS7: connect-to + port)
:do { /interface sstp-client remove [find name="sstp-cctv"] } on-error={}
:do { /interface sstp-client remove [find name="SPVPN"] } on-error={}
/interface sstp-client add name="sstp-cctv" connect-to="187.77.145.131" port=4443 user="candelaria-kitifi-gzi1" password="REDACTED_SEE_VPS" disabled=no verify-server-certificate=no verify-server-address-from-certificate=no
/interface sstp-client enable [find name="sstp-cctv"]
/interface sstp-client print detail
