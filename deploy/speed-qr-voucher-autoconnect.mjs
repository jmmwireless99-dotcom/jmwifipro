/**
 * Speed up GCash QR voucher fulfill and auto-connect even if the portal tab closed.
 *
 * On VPS:
 *   cd /opt/jm-billing && node deploy/speed-qr-voucher-autoconnect.mjs
 *   systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const QR_STATUS_POLL_MS = 400;
export const QR_PAYMONGO_MIN_GAP_MS = 2000;
export const QR_SWEEP_MS = 1000;

export function isAlreadyLoggedInError(msg) {
  return /already logged in/i.test(String(msg || ""));
}

export function shouldCheckGateway(lastAt, now = Date.now(), gap = QR_PAYMONGO_MIN_GAP_MS) {
  return !lastAt || now - lastAt >= gap;
}

export function autoconnectSucceeded(result) {
  if (!result) return false;
  if (result.ok) return true;
  return isAlreadyLoggedInError(result.reason);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function patchStatusPaymongoThrottle(src) {
  const old = `      if ((order.status === "pending" || order.status === "paid") && order.payment_intent_id) {
        const gw = paymentGateway();
        const ref = String(order.payment_intent_id || "");
        try {`;
  const next = `      if ((order.status === "pending" || order.status === "paid") && order.payment_intent_id && kitifiShouldCheckGateway(token)) {
        const gw = paymentGateway();
        const ref = String(order.payment_intent_id || "");
        try {`;
  if (src.includes(next)) return { src, changed: false };
  if (!src.includes(old)) return { src, changed: false, missing: "status-throttle" };
  return { src: src.split(old).join(next), changed: true };
}

export function patchStatusGeneratingWait(src) {
  const old = `      if (order.status === "generating") {
        await new Promise((r) => setTimeout(r, 800));
        order = KitifiOrders.byToken(token) || order;
      }`;
  const next = `      if (order.status === "generating") {
        await new Promise((r) => setTimeout(r, 200));
        order = KitifiOrders.byToken(token) || order;
      }`;
  if (src.includes(next)) return { src, changed: false };
  if (!src.includes(old)) return { src, changed: false, missing: "generating-wait" };
  return { src: src.split(old).join(next), changed: true };
}

export function patchStatusResponse(src) {
  const old = `      return send(res, 200, {
        ok: true, status: statusOut, voucher: order.voucher_code || null,
        plan_name: order.plan_name, amount: order.amount, token: order.token,
        connect_url: connectUrl,
        seller: order.seller || kitifiSellerName(),
      });`;
  const next = `      return send(res, 200, {
        ok: true, status: statusOut, voucher: order.voucher_code || null,
        plan_name: order.plan_name, amount: order.amount, token: order.token,
        connect_url: connectUrl,
        auto_connected: Number(order.autoconnected) === 1,
        seller: order.seller || kitifiSellerName(),
      });`;
  if (src.includes(next)) return { src, changed: false };
  if (!src.includes(old)) return { src, changed: false, missing: "status-response" };
  return { src: src.split(old).join(next), changed: true };
}

const AUTOCONNECT_OLD = `async function kitifiTryAutoconnect(conn, order, code, rid, router) {
  if (!order?.client_mac) return { ok: false };
  const mac = order.client_mac;
  const base = { mac, voucher: code, routerId: rid, uptime: order.uptime, profile: order.profile };

  try {
    const redeem = await kitifiRedeemVoucher(conn, base);
    if (redeem.ok) {
      Audit.add({ type: "auto", action: "kitifi-autoconnect", detail: code + " · redeem · mac " + mac + " · " + router.name, ok: true });
      return { ok: true, connect_url: kitifiConnectUrl(code, rid, mac, redeem.ip) };
    }
  } catch {}

  try {
    const mk = await kitifiMikrotikVoucherConnect(conn, base);
    if (mk.ok) {
      Audit.add({ type: "auto", action: "kitifi-autoconnect", detail: code + " · mikrotik · mac " + mac + " · " + router.name, ok: true });
      return { ok: true, connect_url: mk.connect_url };
    }
    if (mk.connect_url) {
      Audit.add({ type: "auto", action: "kitifi-autoconnect", detail: code + " · gateway · mac " + mac + " · " + (mk.reason || ""), ok: false });
      return { ok: false, connect_url: mk.connect_url, reason: mk.reason };
    }
  } catch {}

  try {
    const macLogin = await kitifiHotspotLoginByMac(conn, base);
    if (macLogin.ok) {
      Audit.add({ type: "auto", action: "kitifi-autoconnect", detail: code + " · hotspot · mac " + mac + " · " + router.name, ok: true });
      return { ok: true, connect_url: await kitifiOrderConnectUrl(conn, { voucher: code, mac, routerId: rid, uptime: order.uptime, profile: order.profile }) };
    }
  } catch {}

  return {
    ok: false,
    connect_url: await kitifiOrderConnectUrl(conn, { voucher: code, mac, routerId: rid, uptime: order.uptime, profile: order.profile }),
  };
}`;

const AUTOCONNECT_NEW = `async function kitifiTryAutoconnect(conn, order, code, rid, router) {
  if (!order?.client_mac) return { ok: false };
  const mac = order.client_mac;
  const base = { mac, voucher: code, routerId: rid, uptime: order.uptime, profile: order.profile };
  const alreadyOk = (r) => !!(r && (r.ok || /already logged in/i.test(String(r.reason || ""))));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const mk = await kitifiMikrotikVoucherConnect(conn, base);
      if (alreadyOk(mk)) {
        Audit.add({ type: "auto", action: "kitifi-autoconnect", detail: code + " · mikrotik · mac " + mac + " · " + router.name, ok: true });
        return { ok: true, connect_url: mk.connect_url || kitifiConnectUrl(code, rid, mac, mk.ip) };
      }
    } catch (e) {
      if (/already logged in/i.test(String(e.message || ""))) {
        Audit.add({ type: "auto", action: "kitifi-autoconnect", detail: code + " · mikrotik · mac " + mac + " · already online", ok: true });
        return { ok: true, connect_url: kitifiConnectUrl(code, rid, mac) };
      }
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 350));
  }

  try {
    const redeem = await kitifiRedeemVoucher(conn, base);
    if (alreadyOk(redeem)) {
      Audit.add({ type: "auto", action: "kitifi-autoconnect", detail: code + " · redeem · mac " + mac + " · " + router.name, ok: true });
      return { ok: true, connect_url: kitifiConnectUrl(code, rid, mac, redeem.ip) };
    }
  } catch {}

  try {
    const macLogin = await kitifiHotspotLoginByMac(conn, base);
    if (alreadyOk(macLogin)) {
      Audit.add({ type: "auto", action: "kitifi-autoconnect", detail: code + " · hotspot · mac " + mac + " · " + router.name, ok: true });
      return { ok: true, connect_url: await kitifiOrderConnectUrl(conn, { voucher: code, mac, routerId: rid, uptime: order.uptime, profile: order.profile }) };
    }
  } catch {}

  return {
    ok: false,
    connect_url: await kitifiOrderConnectUrl(conn, { voucher: code, mac, routerId: rid, uptime: order.uptime, profile: order.profile }),
  };
}`;

export function patchTryAutoconnect(src) {
  if (src.includes("const alreadyOk = (r) => !!(r && (r.ok || /already logged in/i.test")) {
    return { src, changed: false };
  }
  if (!src.includes(AUTOCONNECT_OLD)) return { src, changed: false, missing: "try-autoconnect" };
  return { src: src.split(AUTOCONNECT_OLD).join(AUTOCONNECT_NEW), changed: true };
}

const FULFILL_AC_OLD = `      if (order.client_mac) {
        try {
          await kitifiTryAutoconnect(conn, order, code, rid, router);
        } catch {}
      }`;

const FULFILL_AC_NEW = `      if (order.client_mac) {
        try { conn.close?.(); } catch {}
        try {
          const fresh = resolveRouterCtx(rid);
          try {
            const ac = await kitifiTryAutoconnect(fresh.conn, order, code, rid, fresh.router || router);
            if (ac?.ok) KitifiOrders.markAutoconnected(order.id);
          } finally {
            fresh.conn.close?.();
          }
        } catch {}
      }`;

export function patchFulfillFreshAutoconnect(src) {
  if (src.includes(FULFILL_AC_NEW)) return { src, changed: false };
  if (!src.includes(FULFILL_AC_OLD)) return { src, changed: false, missing: "fulfill-autoconnect" };
  return { src: src.split(FULFILL_AC_OLD).join(FULFILL_AC_NEW), changed: true };
}

const REDEEM_OLD = `        const ac = await kitifiTryAutoconnect(conn, order, order.voucher_code, rid, router);
        conn.close?.();`;
const REDEEM_NEW = `        const ac = await kitifiTryAutoconnect(conn, order, order.voucher_code, rid, router);
        if (ac?.ok) try { KitifiOrders.markAutoconnected(order.id); } catch {}
        conn.close?.();`;

export function patchRedeemMarkAutoconnect(src) {
  if (src.includes(REDEEM_NEW)) return { src, changed: false };
  if (!src.includes(REDEEM_OLD)) return { src, changed: false, missing: "redeem-mark" };
  return { src: src.split(REDEEM_OLD).join(REDEEM_NEW), changed: true };
}

const STATUS_URL_OLD = `      let connectUrl = null;
      if (order.voucher_code) {
        try {
          const rid = order.router_id || kitifiPortalRouterId();
          const { conn } = resolveRouterCtx(rid);
          connectUrl = await kitifiOrderConnectUrl(conn, {
            voucher: order.voucher_code, mac: order.client_mac, routerId: rid,
            uptime: order.uptime, profile: order.profile,
          });
          conn.close?.();
        } catch {
          connectUrl = kitifiConnectUrl(order.voucher_code, order.router_id, order.client_mac);
        }
      }`;
const STATUS_URL_NEW = `      let connectUrl = null;
      if (order.voucher_code) {
        connectUrl = kitifiConnectUrl(order.voucher_code, order.router_id, order.client_mac);
        if (Number(order.router_id) === 37) {
          try {
            const rid = order.router_id || kitifiPortalRouterId();
            const { conn } = resolveRouterCtx(rid);
            connectUrl = await kitifiOrderConnectUrl(conn, {
              voucher: order.voucher_code, mac: order.client_mac, routerId: rid,
              uptime: order.uptime, profile: order.profile,
            });
            conn.close?.();
          } catch {}
        }
      }`;

export function patchStatusConnectUrlFast(src) {
  if (src.includes(STATUS_URL_NEW)) return { src, changed: false };
  if (!src.includes(STATUS_URL_OLD)) return { src, changed: false, missing: "status-connect-url" };
  return { src: src.split(STATUS_URL_OLD).join(STATUS_URL_NEW), changed: true };
}

const LOCKS_OLD = `const kitifiFulfillLocks = new Map();`;
const LOCKS_NEW = `const kitifiFulfillLocks = new Map();
const kitifiPaymongoCheckAt = new Map();
function kitifiShouldCheckGateway(token) {
  const now = Date.now();
  const key = String(token || "");
  const last = kitifiPaymongoCheckAt.get(key) || 0;
  if (now - last < 2000) return false;
  kitifiPaymongoCheckAt.set(key, now);
  return true;
}

async function sweepPendingKitifiQrPayments() {
  try { KitifiOrders.resetStuckGenerating(90); } catch {}
  const rows = KitifiOrders.pendingRecent ? KitifiOrders.pendingRecent(1200, 30) : [];
  const gw = paymentGateway();
  for (const order of rows) {
    const token = String(order.token || "");
    const ref = String(order.payment_intent_id || "");
    if (!token || !kitifiShouldCheckGateway("sweep:" + token)) continue;
    try {
      if (order.status === "paid") {
        await fulfillKitifiOrder(token, { paymentIntentId: ref, resourceId: ref });
        continue;
      }
      if (!ref) continue;
      if (ref.startsWith("link_") && gw.getLink) {
        const link = await gw.getLink(ref);
        if (link.status === "paid") {
          await fulfillKitifiOrder(token, { paymentIntentId: ref, resourceId: link.id, amount: link.amount });
        }
      } else if (gw.getIntent) {
        const pi = await gw.getIntent(ref);
        if (pi.status === "succeeded") {
          await fulfillKitifiOrder(token, { paymentIntentId: ref, resourceId: pi.id, amount: pi.amount });
        }
      }
    } catch {}
  }
  const ready = KitifiOrders.readyUnconnectedRecent ? KitifiOrders.readyUnconnectedRecent(900, 20) : [];
  for (const order of ready) {
    const token = String(order.token || "");
    const code = String(order.voucher_code || "").trim();
    if (!token || !code || !order.client_mac || !kitifiShouldCheckGateway("ac:" + token)) continue;
    try {
      const rid = order.router_id || kitifiPortalRouterId();
      const fresh = resolveRouterCtx(rid);
      try {
        const ac = await kitifiTryAutoconnect(fresh.conn, order, code, rid, fresh.router);
        if (ac?.ok) KitifiOrders.markAutoconnected(order.id);
      } finally {
        fresh.conn.close?.();
      }
    } catch {}
  }
}`;

export function patchGatewayThrottleAndSweep(src) {
  if (src.includes("async function sweepPendingKitifiQrPayments()")) return { src, changed: false };
  if (!src.includes(LOCKS_OLD)) return { src, changed: false, missing: "fulfill-locks" };
  return { src: src.split(LOCKS_OLD).join(LOCKS_NEW), changed: true };
}

const TIMER_OLD = `  tgPollLoop(); // listens for Telegram approve/reject (no-op until a bot token is set)
});`;
const TIMER_NEW = `  tgPollLoop(); // listens for Telegram approve/reject (no-op until a bot token is set)
  setInterval(() => { sweepPendingKitifiQrPayments().catch(() => {}); }, 1000);
  setTimeout(() => { sweepPendingKitifiQrPayments().catch(() => {}); }, 1500);
  console.log("  >> KiTifi QR pay sweeper every 1s (voucher + auto-connect even if portal closed)");
});`;

export function patchSweepTimer(src) {
  if (src.includes("KiTifi QR pay sweeper every 1s")) return { src, changed: false };
  if (!src.includes(TIMER_OLD)) return { src, changed: false, missing: "sweep-timer" };
  return { src: src.split(TIMER_OLD).join(TIMER_NEW), changed: true };
}

export function patchServerJs(src) {
  let out = String(src || "");
  const steps = [
    patchTryAutoconnect,
    patchFulfillFreshAutoconnect,
    patchRedeemMarkAutoconnect,
    patchGatewayThrottleAndSweep,
    patchStatusPaymongoThrottle,
    patchStatusGeneratingWait,
    patchStatusConnectUrlFast,
    patchStatusResponse,
    patchSweepTimer,
  ];
  const missing = [];
  let changed = false;
  for (const step of steps) {
    const r = step(out);
    if (r.missing) missing.push(r.missing);
    if (r.changed) {
      out = r.src;
      changed = true;
    } else {
      out = r.src;
    }
  }
  return { src: out, changed, missing };
}

function copyIfPresent(rel) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) return false;
  return true;
}

function main() {
  const serverPath = path.join(ROOT, "server.js");
  if (!fs.existsSync(serverPath)) {
    console.log("server.js not in this tree (ok on git-only checkout)");
  } else {
    const cur = fs.readFileSync(serverPath, "utf8");
    const next = patchServerJs(cur);
    if (next.missing.length) console.warn("server.js patch misses:", next.missing.join(", "));
    if (next.changed) {
      fs.writeFileSync(serverPath, next.src);
      console.log("patched server.js (fast QR fulfill + auto-connect sweeper)");
    } else {
      console.log("server.js already patched or no matching snippets");
    }
  }
  for (const rel of [
    "lib/kitifi-server.js",
    "lib/kitifi-vouchers.js",
    "public/kitifi/generator-buy.html",
    "public/kitifi/payment-return.html",
    "public/kitifi/kitifi-connect.js",
  ]) {
    console.log(copyIfPresent(rel) ? "ok " + rel : "missing " + rel);
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
