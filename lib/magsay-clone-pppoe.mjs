/** Shared constants for cloning CANDELARIA-PPPOE → MAGSAY2X-CORE (no secrets). */

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

/** Live MAGSAY PPPoE server stays on the CSR switch uplink. */
export const MAG_PPPOE_IFACE = "sfp-sfpplus2";

export const CANDELARIA_ROUTER_NAME = "CANDELARIA-PPPOE";
export const MAGSAY_ROUTER_NAME = "MAGSAY2X-CORE";
