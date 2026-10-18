# 5thserver SSTP resync -> Hostinger 187.77.145.131:4443 (accel-ppp)
# user 5thserver-mxw5 tunnel 10.90.0.22 API port 51341
:do { /interface sstp-client remove [find name="sstp-cctv"] } on-error={}
:do { /interface sstp-client remove [find name="SPVPN"] } on-error={}
/interface sstp-client add name="sstp-cctv" connect-to="187.77.145.131:4443" user="5thserver-mxw5" password="REDACTED_SEE_VPS" disabled=no verify-server-certificate=no verify-server-address-from-certificate=no
/interface sstp-client enable [find name="sstp-cctv"]
/interface sstp-client print detail
