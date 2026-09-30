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

/**
 * MAGSAYSAY-PPPOE customer PPPoE interface.
 * Same L2 fabric as MAGSAY2X sfp-sfpplus2 (192.168.17.0/24) so migrated
 * clients can rediscover the concentrator after cutover.
 */
export const MAG_PPPOE_IFACE = "sfp-sfpplus1";

export const CANDELARIA_ROUTER_NAME = "CANDELARIA-PPPOE";
export const MAGSAY_ROUTER_NAME = "MAGSAYSAY-PPPOE";
/** Uplink toward MAGSAY2X / internet (same physical port as PPPoE when on shared fabric). */
export const MAGSAY_WAN = "sfp-sfpplus1";
