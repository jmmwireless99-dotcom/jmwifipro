/** Shared constants for cloning CANDELARIA-PPPOE → MAGSAYSAY-PPPOE (no secrets). */

export const POOL_NAMES = [
  "Home Fiber Unli 999",
  "Home Fiber Unli 1299",
  "Enterprise 2499",
  "Enterprise 3800",
  "TESTING",
  "suspended-pool",
  "IPOE-PREPAID-01",
  "IPOE-PREPAID-02",
];

export const PROFILE_NAMES = [
  "Home Fiber 999",
  "Home Fiber 1299",
  "Enterprise 2499",
  "Enterprise 3800",
  "suspended-pool",
];

/** MAGSAYSAY-PPPOE customer-facing bridge (like Candelaria ether-OUT). */
export const MAG_PPPOE_IFACE = "bridge-OUT";

export const CANDELARIA_ROUTER_NAME = "CANDELARIA-PPPOE";
export const MAGSAY_ROUTER_NAME = "MAGSAYSAY-PPPOE";
export const MAGSAY_WAN = "sfp-sfpplus1";
