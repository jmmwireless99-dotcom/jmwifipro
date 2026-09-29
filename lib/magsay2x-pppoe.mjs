/**
 * MAGSAY2X-CORE PPPoE stack — same plan profiles / pools / suspend
 * pattern as CANDELARIA-PPPOE (PPPOE-JMPRO-IPOE) for jmwifi.pro billing.
 *
 * MAGSAY already terminates PPPoE on sfp-sfpplus2 (CSR switch).
 * Do not change live pool ranges or the existing service-name (ppoe).
 */

export const MAGSAY_ROUTER_NAMES = ["MAGSAY2X-CORE", "MAGSAY2X-PPPOE"];
export const CANDELARIA_ROUTER_NAME = "CANDELARIA-PPPOE";

export const PLAN_PROFILE_MAP = {
  "Home Fiber 999": { planName: /home fiber unli surf/i, pool: "Home Fiber Unli 999" },
  "Home Fiber 1299": { planName: /home fiber super surf/i, pool: "Home Fiber Unli 1299" },
  "Enterprise 2499": { planName: /^enterprise$/i, pool: "Enterprise 2499", price: 2499 },
  "Enterprise 3800": { planName: /^enterprise$/i, pool: "Enterprise 3800", price: 3800 },
};

export const REQUIRED_PROFILES = [
  {
    name: "Home Fiber 999",
    local: "11.10.10.1",
    remote: "Home Fiber Unli 999",
    rate: "12M/12M",
    dns: "8.8.8.8,8.8.4.4",
  },
  {
    name: "Home Fiber 1299",
    local: "12.10.10.1",
    remote: "Home Fiber Unli 1299",
    rate: "15M/15M",
    dns: "8.8.8.8,8.8.4.4",
  },
  {
    name: "Enterprise 2499",
    local: "13.10.10.1",
    remote: "Enterprise 2499",
    rate: "15M/15M",
    dns: "8.8.8.8,8.8.4.4",
  },
  {
    name: "Enterprise 3800",
    local: "15.10.10.1",
    remote: "Enterprise 3800",
    rate: "35M/35M",
    dns: "8.8.8.8,8.8.4.4",
  },
  {
    name: "suspended-pool",
    local: "50.0.0.1",
    remote: "suspended-pool",
    rate: "2M/2M",
    dns: "50.0.0.1",
    list: "suspended",
  },
];

export const REQUIRED_POOLS = [
  { name: "Home Fiber Unli 999", ranges: "11.10.10.5-11.10.10.254" },
  { name: "Home Fiber Unli 1299", ranges: "12.10.10.5-12.10.10.254" },
  { name: "Enterprise 2499", ranges: "14.10.10.5-14.10.10.254" },
  { name: "Enterprise 3800", ranges: "15.10.10.5-15.10.10.254" },
  { name: "suspended-pool", ranges: "50.0.0.5-50.0.0.254", comment: "JM: suspended PPPoE pool" },
];

export const PPPOE_SERVER = {
  interface: "sfp-sfpplus2",
  "service-name": "ppoe",
  authentication: "pap,chap,mschap1,mschap2",
  "one-session-per-host": "true",
  "default-profile": "default",
  disabled: "false",
};

export function profileForPlan(plan) {
  const name = String(plan?.router_profile || plan?.name || "");
  if (/3800/.test(name) || Number(plan?.price) === 3800) return "Enterprise 3800";
  if (/2499/.test(name) || Number(plan?.price) === 2499) return "Enterprise 2499";
  if (/1299/.test(name) || Number(plan?.price) === 1299) return "Home Fiber 1299";
  if (/999/.test(name) || Number(plan?.price) === 999) return "Home Fiber 999";
  return String(plan?.router_profile || "Home Fiber 999");
}

export function displayNameFromSecret(username, profile) {
  const raw = String(username || "").replace(/[_-]+/g, " ").trim();
  return raw || profile || "MAGSAY2X client";
}

export function shouldImportSecret(secret) {
  const service = String(secret?.service || "pppoe").toLowerCase();
  if (service && service !== "pppoe") return false;
  const name = String(secret?.name || "").trim();
  if (!name) return false;
  if (/^(l2tp|sstp|vpn|admin|winbox)/i.test(name)) return false;
  return true;
}
