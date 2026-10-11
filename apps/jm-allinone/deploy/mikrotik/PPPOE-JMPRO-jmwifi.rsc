# =============================================================================
# JM WIFI Billing — PPPOE-JMPRO (jmwifi.pro)
# Migrated from Kurifot reminder system. Paste in Terminal or import.
# Billing API moves expired users to profile "suspended-pool" automatically.
# =============================================================================

# --- Plan pools (keep as-is) ---
/ip pool
:if ([:len [/ip pool find name="Home Fiber Unli 999"]] = 0) do={
  add name="Home Fiber Unli 999" ranges=11.10.10.5-11.10.10.254
}
:if ([:len [/ip pool find name="Home Fiber Unli 1299"]] = 0) do={
  add name="Home Fiber Unli 1299" ranges=12.10.10.5-12.10.10.254
}
:if ([:len [/ip pool find name="Enterprise 2499"]] = 0) do={
  add name="Enterprise 2499" ranges=14.10.10.5-14.10.10.254
}
:if ([:len [/ip pool find name="TESTING"]] = 0) do={
  add name="TESTING" ranges=10.10.0.105-10.10.10.254
}
:set suspPoolId [/ip pool find name="suspended-pool"]
:if ($suspPoolId = "") do={
  add comment="JM WIFI: expired/suspended PPPoE pool" name=suspended-pool ranges=50.0.0.5-50.0.0.254
} else={
  set $suspPoolId comment="JM WIFI: expired/suspended PPPoE pool" ranges=50.0.0.5-50.0.0.254
}

# --- Active plan profiles (keep as-is) ---
/ppp profile
:if ([:len [/ppp profile find name="Home Fiber Unli 999"]] = 0) do={
  add dns-server=8.8.8.8,8.8.4.4 local-address=11.10.10.1 name="Home Fiber Unli 999" rate-limit=12M/12M remote-address="Home Fiber Unli 999"
}
:if ([:len [/ppp profile find name="Home Fiber Unli 1299"]] = 0) do={
  add dns-server=8.8.8.8 local-address=12.10.10.1 name="Home Fiber Unli 1299" rate-limit=15M/15M remote-address="Home Fiber Unli 1299"
}
:if ([:len [/ppp profile find name="Enterprise 2499"]] = 0) do={
  add dns-server=8.8.8.8 local-address=14.10.10.1 name="Enterprise 2499" rate-limit=20M/20M remote-address="Enterprise 2499"
}
:if ([:len [/ppp profile find name="TESTING"]] = 0) do={
  add dns-server=8.8.8.8 local-address=10.10.10.1 name=TESTING rate-limit=10M/10M remote-address=TESTING
}

# Remove old Kurifot reminder profiles (no longer used — billing syncs via API)
:foreach p in={"EXPIRED_PROFILE";"GRACE_PROFILE";"Reminder"} do={
  :local id [/ppp profile find name=$p]
  :if ($id != "") do={ remove $id }
}

# JM WIFI suspended profile — billing sets this on expiry
:set suspProfId [/ppp profile find name="suspended-pool"]
:if ($suspProfId = "") do={
  add address-list=suspended comment="JM WIFI: expired/suspended — billing API" dns-server=8.8.8.8,8.8.4.4 local-address=50.0.0.1 name=suspended-pool rate-limit=512k/512k remote-address=suspended-pool
} else={
  set $suspProfId address-list=suspended comment="JM WIFI: expired/suspended — billing API" dns-server=8.8.8.8,8.8.4.4 local-address=50.0.0.1 rate-limit=512k/512k remote-address=suspended-pool on-up="" on-down=""
}

# --- Portal domains (replaces KURIFOT_DOMAINS) ---
/ip firewall address-list
:foreach e in={"jmwifi.pro";"www.jmwifi.pro";"187.77.145.131"} do={
  :if ([:len [/ip firewall address-list find list=JMWIFI_PORTAL address=$e]] = 0) do={
    add address=$e comment="JM WIFI: billing portal" list=JMWIFI_PORTAL
  }
}
:foreach e in={"paymongo.com";"api.paymongo.com";"pm.link"} do={
  :if ([:len [/ip firewall address-list find list=PAYMENT_ALLOW address=$e]] = 0) do={
    add address=$e comment="JM WIFI: PayMongo" list=PAYMENT_ALLOW
  }
}

# --- Web proxy: HTTP redirect target for suspended users ---
/ip proxy
set anonymous=yes enabled=yes port=8080
/ip proxy access
:foreach h in={"jmwifi.pro";"www.jmwifi.pro";".jmwifi.pro";"paymongo.com";".paymongo.com"} do={
  :if ([:len [/ip proxy access find dst-host=$h]] = 0) do={
    add action=allow comment="JM WIFI: portal/payment" dst-host=$h src-address=50.0.0.0/24
  }
}

# --- Remove old Kurifot / reminder firewall rules ---
:foreach id in=[/ip firewall nat find comment~"KURIFOT"] do={ remove $id }
:foreach id in=[/ip firewall nat find comment~"GRACE PORTAL"] do={ remove $id }
:foreach id in=[/ip firewall nat find comment~"PPPOE PORTAL"] do={ remove $id }
:foreach id in=[/ip firewall nat find comment~"JM suspend"] do={ remove $id }
:foreach id in=[/ip firewall filter find comment~"KURIFOT"] do={ remove $id }
:foreach id in=[/ip firewall filter find comment~"Kurifot"] do={ remove $id }
:foreach id in=[/ip firewall filter find comment~"PPP Reminder"] do={ remove $id }
:foreach id in=[/ip firewall filter find comment~"JM suspend"] do={ remove $id }

# --- JM WIFI suspended rules (uses address-list "suspended" from profile) ---
/ip firewall nat
add action=redirect chain=dstnat comment="JM WIFI: suspended HTTP portal redirect" dst-port=80 protocol=tcp src-address-list=suspended to-ports=8080

/ip firewall filter
add action=accept chain=forward comment="JM WIFI: suspended allow DNS udp" dst-port=53 protocol=udp src-address-list=suspended
add action=accept chain=forward comment="JM WIFI: suspended allow DNS tcp" dst-port=53 protocol=tcp src-address-list=suspended
add action=accept chain=forward comment="JM WIFI: portal access" dst-address-list=JMWIFI_PORTAL dst-port=80,443 protocol=tcp src-address-list=suspended
add action=accept chain=forward comment="JM WIFI: online payments" dst-address-list=PAYMENT_ALLOW dst-port=80,443,8080 protocol=tcp src-address-list=suspended
add action=accept chain=forward comment="JM WIFI: payment UDP" dst-address-list=PAYMENT_ALLOW dst-port=443 protocol=udp src-address-list=suspended
add action=accept chain=forward comment="JM WIFI: tls jmwifi" dst-port=443 protocol=tcp src-address-list=suspended tls-host=*.jmwifi.pro
add action=accept chain=forward comment="JM WIFI: tls PayMongo" dst-port=443 protocol=tcp src-address-list=suspended tls-host=*.paymongo.com
add action=accept chain=forward comment="JM WIFI: tls GCash" dst-port=443 protocol=tcp src-address-list=suspended tls-host=*.gcash.com
add action=reject chain=forward comment="JM WIFI: suspended block internet" out-interface=ether1-ISP reject-with=icmp-network-unreachable src-address-list=suspended

# =============================================================================
# After import: Settings in JM Billing panel → suspended_profile = suspended-pool
# Expired user flow: billing API → profile suspended-pool → IP in "suspended" list
# Test: open http://neverssl.com → redirected → pay at https://jmwifi.pro/account
# =============================================================================
