import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  QR_STATUS_POLL_MS,
  autoconnectSucceeded,
  isAlreadyLoggedInError,
  patchServerJs,
  shouldCheckGateway,
} from "../deploy/speed-qr-voucher-autoconnect.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("treats already-logged-in as autoconnect success", () => {
  assert.equal(isAlreadyLoggedInError("IP 10.0.214.19 is already logged in"), true);
  assert.equal(isAlreadyLoggedInError("connection closed"), false);
  assert.equal(autoconnectSucceeded({ ok: true }), true);
  assert.equal(autoconnectSucceeded({ ok: false, reason: "IP 10.6.60.88 is already logged in" }), true);
  assert.equal(autoconnectSucceeded({ ok: false, reason: "connection closed" }), false);
});

test("PayMongo gateway checks are throttled to ~2s", () => {
  assert.equal(shouldCheckGateway(0, 1000), true);
  assert.equal(shouldCheckGateway(1000, 1500), false);
  assert.equal(shouldCheckGateway(1000, 3100), true);
});

test("buy page polls faster and auto-connects without waiting for the portal tab", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/kitifi/generator-buy.html"), "utf8");
  assert.match(html, /setInterval\(checkStatus,400\)/);
  assert.match(html, /s\.auto_connected/);
  assert.match(html, /kahit naka-close na ang portal/);
  assert.doesNotMatch(html, /setInterval\(checkStatus,1200\)/);
  const ret = fs.readFileSync(path.join(ROOT, "public/kitifi/payment-return.html"), "utf8");
  assert.match(ret, /setTimeout\(poll, 400\)/);
  assert.equal(QR_STATUS_POLL_MS, 400);
});

test("server.js patcher injects sweeper, fresh autoconnect, and auto_connected", () => {
  const fake = [
    "const kitifiFulfillLocks = new Map();",
    '      if ((order.status === "pending" || order.status === "paid") && order.payment_intent_id) {',
    "        const gw = paymentGateway();",
    '        const ref = String(order.payment_intent_id || "");',
    "        try {",
    '      if (order.status === "generating") {',
    "        await new Promise((r) => setTimeout(r, 800));",
    "        order = KitifiOrders.byToken(token) || order;",
    "      }",
    "      let connectUrl = null;",
    "      if (order.voucher_code) {",
    "        try {",
    "          const rid = order.router_id || kitifiPortalRouterId();",
    "          const { conn } = resolveRouterCtx(rid);",
    "          connectUrl = await kitifiOrderConnectUrl(conn, {",
    "            voucher: order.voucher_code, mac: order.client_mac, routerId: rid,",
    "            uptime: order.uptime, profile: order.profile,",
    "          });",
    "          conn.close?.();",
    "        } catch {",
    "          connectUrl = kitifiConnectUrl(order.voucher_code, order.router_id, order.client_mac);",
    "        }",
    "      }",
    "      return send(res, 200, {",
    "        ok: true, status: statusOut, voucher: order.voucher_code || null,",
    "        plan_name: order.plan_name, amount: order.amount, token: order.token,",
    "        connect_url: connectUrl,",
    "        seller: order.seller || kitifiSellerName(),",
    "      });",
    "        const ac = await kitifiTryAutoconnect(conn, order, order.voucher_code, rid, router);",
    "        conn.close?.();",
    '      if (order.client_mac) {',
    "        try {",
    "          await kitifiTryAutoconnect(conn, order, code, rid, router);",
    "        } catch {}",
    "      }",
    "  tgPollLoop(); // listens for Telegram approve/reject (no-op until a bot token is set)",
    "});",
    "",
  ].join("\n");
  const { src, changed, missing } = patchServerJs(fake);
  assert.equal(missing.includes("fulfill-locks"), false);
  assert.equal(missing.includes("status-response"), false);
  assert.equal(missing.includes("sweep-timer"), false);
  assert.equal(missing.includes("fulfill-autoconnect"), false);
  assert.equal(missing.includes("redeem-mark"), false);
  assert.equal(missing.includes("status-connect-url"), false);
  assert.equal(changed, true);
  assert.match(src, /sweepPendingKitifiQrPayments/);
  assert.match(src, /markAutoconnected/);
  assert.match(src, /auto_connected/);
  assert.match(src, /kitifiShouldCheckGateway/);
  assert.match(src, /readyUnconnectedRecent/);
  assert.match(src, /status === "paid"/);
});

test("live VPS server.js snippets still match the patcher", () => {
  const livePath = "/tmp/vps-live/server.js";
  if (!fs.existsSync(livePath)) return;
  const { changed, missing } = patchServerJs(fs.readFileSync(livePath, "utf8"));
  assert.deepEqual(missing, []);
  assert.equal(changed, true);
});

test("order queries retry paid fulfill and ready MAC login", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/kitifi-vouchers.js"), "utf8");
  assert.match(src, /status IN \('pending','paid'\)/);
  assert.match(src, /readyUnconnectedRecent/);
  assert.match(src, /COALESCE\(autoconnected,0\)=0/);
});

test("MikroTik login helper logs out an existing session before voucher login", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/kitifi-server.js"), "utf8");
  assert.match(src, /export async function kitifiForceHotspotLogin/);
  assert.match(src, /kitifiLogoutHotspotMac/);
  assert.match(src, /already logged in/);
});
