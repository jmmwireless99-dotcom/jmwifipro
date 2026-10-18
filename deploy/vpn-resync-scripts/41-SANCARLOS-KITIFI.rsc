# SANCARLOS-KITIFI SSTP resync -> Hostinger 187.77.145.131:4443 (accel-ppp)
# user sancarlos-kitifi-74kd tunnel 10.90.0.18 API port 56795
:do { /interface sstp-client remove [find name="sstp-cctv"] } on-error={}
:do { /interface sstp-client remove [find name="SPVPN"] } on-error={}
/interface sstp-client add name="sstp-cctv" connect-to="187.77.145.131:4443" user="sancarlos-kitifi-74kd" password="REDACTED_SEE_VPS" disabled=no verify-server-certificate=no verify-server-address-from-certificate=no
/interface sstp-client enable [find name="sstp-cctv"]
/interface sstp-client print detail
