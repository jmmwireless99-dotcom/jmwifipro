/** Shared free-WiFi claim rules (no DB imports — safe to unit test). */

export const PANISIJAN_ROUTER_ID = 51;

export function kitifiFreeSkipRegister(routerId) {
  return Number(routerId) === PANISIJAN_ROUTER_ID;
}

export function kitifiFreeGuestName(mac) {
  const digits = String(mac || "").replace(/[^0-9A-Fa-f]/g, "").slice(-4);
  return digits ? "Guest " + digits.toUpperCase() : "Guest";
}

/**
 * Decide whether this device may claim free internet now.
 * skipRegister: no create-account / registration form (PANISIJAN).
 */
export function kitifiFreeCanClaim({
  enabled,
  skipRegister,
  client,
  claimsToday,
  limitPerDay,
} = {}) {
  if (!enabled) return { ok: false, reason: "disabled" };
  if (client && client.status && client.status !== "active") {
    return { ok: false, reason: "blocked" };
  }
  if (!skipRegister && !client) return { ok: false, reason: "register" };
  const limit = Math.max(1, Number(limitPerDay) || 1);
  if (Number(claimsToday) >= limit) return { ok: false, reason: "limit" };
  return { ok: true, reason: "ok" };
}

export function kitifiFreeStatusMessage({
  enabled,
  skipRegister,
  client,
  claimsToday,
  limitPerDay,
  uptime,
  routerId,
} = {}) {
  const decision = kitifiFreeCanClaim({
    enabled,
    skipRegister,
    client,
    claimsToday,
    limitPerDay,
  });
  if (decision.reason === "disabled") return "Free internet not available.";
  if (decision.reason === "register") return "Register to get free internet.";
  if (decision.reason === "blocked") return "Free internet not available. Contact admin.";
  if (decision.reason === "limit") {
    const rid = Number(routerId);
    const limit = Math.max(1, Number(limitPerDay) || 1);
    if (rid === PANISIJAN_ROUTER_ID && limit === 1) {
      return "Na-claim mo na ang libreng internet ngayong araw. Bumalik bukas.";
    }
    return "Free internet not available. Daily limit reached (" + limit + " per day).";
  }
  if (skipRegister) {
    return "Free internet available — tap to claim " + (uptime || "your free time") + ".";
  }
  return "Free internet available — " + (uptime || "your free time") + ".";
}
