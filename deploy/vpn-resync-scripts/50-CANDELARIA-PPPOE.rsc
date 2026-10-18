# CANDELARIA-PPPOE SSTP resync -> Hostinger 187.77.145.131:4443 (accel-ppp)
# user pppoe-ipoe-t2y4 tunnel 10.90.0.13 API port 53099
:do { /interface sstp-client remove [find name="sstp-cctv"] } on-error={}
:do { /interface sstp-client remove [find name="SPVPN"] } on-error={}
/interface sstp-client add name="sstp-cctv" connect-to="187.77.145.131:4443" user="pppoe-ipoe-t2y4" password="REDACTED_SEE_VPS" disabled=no verify-server-certificate=no verify-server-address-from-certificate=no
/interface sstp-client enable [find name="sstp-cctv"]
/interface sstp-client print detail
