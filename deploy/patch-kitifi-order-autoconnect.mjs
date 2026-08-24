/**
 * Patch kitifi-api.js: server-side MAC auto-connect after GCash pay (PANISIJAN router 51).
 * Usage on VPS:
 *   cd /opt/jm-billing
 *   git pull   # or copy lib/kitifi-order-autoconnect.js
 *   node deploy/patch-kitifi-order-autoconnect.mjs
 *   systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiPath = process.env.KITIFI_API_JS || path.join(ROOT, "lib", "kitifi-api.js");
let src = fs.readFileSync(apiPath, "utf8");

if (src.includes("kitifiAutoConnectAfterOrder")) {
  console.log("kitifi-api.js already patched for auto-connect.");
  process.exit(0);
}

const serverImport = /import \{[^}]+\} from "\.\/kitifi-server\.js";/;
if (!serverImport.test(src)) throw new Error('Could not find kitifi-server import in kitifi-api.js');
if (!src.includes("kitifi-order-autoconnect")) {
  src = src.replace(
    serverImport,
    (m) => m + '\nimport { kitifiAutoConnectAfterOrder, kitifiConnectUrlForOrder } from "./kitifi-order-autoconnect.js";'
  );
}

const helperFn = `
  async function kitifiTryAutoConnectOrder(order, voucherCode, conn, plan) {
    if (!order) return { ok: false, reason: "no order" };
    const mac = String(order.client_mac || order.clientMac || "").trim();
    if (!mac || mac.length < 11) return { ok: false, reason: "no mac" };
    const useConn = conn;
    let ownConn = false;
    let c = useConn;
    try {
      if (!c) {
        const rc = routerConn(Number(order.router_id) || kitifiPortalRouterId());
        c = rc.conn;
        ownConn = true;
        await c.identity();
      }
      const ac = await kitifiAutoConnectAfterOrder(c, order, voucherCode, plan);
      const connect_url = await kitifiConnectUrlForOrder(c, order, voucherCode, plan);
      return { ...ac, connect_url: connect_url || ac.connect_url || "" };
    } catch (e) {
      return { ok: false, reason: e.message || String(e) };
    } finally {
      if (ownConn) c?.close?.();
    }
  }
`;

const fulfillMarker = "async function fulfillKitifiOrder(order) {";
const fulfillIdx = src.indexOf(fulfillMarker);
if (fulfillIdx < 0) throw new Error("fulfillKitifiOrder not found");
if (!src.includes("kitifiTryAutoConnectOrder")) {
  src = src.slice(0, fulfillIdx) + helperFn + src.slice(fulfillIdx);
}

const markFulfilledNeedle = "KitifiOrders.markFulfilled(order.id, result.code, order.gateway_ref || \"\");";
if (src.includes(markFulfilledNeedle) && !src.includes("kitifiTryAutoConnectOrder(order, result.code, conn, plan)")) {
  src = src.replace(
    markFulfilledNeedle,
    markFulfilledNeedle +
      "\n      try {\n        const ac = await kitifiTryAutoConnectOrder(order, result.code, conn, plan);\n        if (ac?.ok) result.auto_connected = true;\n        if (ac?.connect_url) result.connect_url = ac.connect_url;\n      } catch {}"
  );
}

const earlyReturnNeedle = "if (order.status === \"ready\" && order.voucher_code) {\n      return { code: order.voucher_code, batch: order.kitifi_batch || \"\" };";
if (src.includes(earlyReturnNeedle) && !src.includes("auto_connected: !!ac?.ok")) {
  src = src.replace(
    earlyReturnNeedle,
    `if (order.status === "ready" && order.voucher_code) {
      try {
        const plan = kitifiPlanById(order.plan_id, Number(order.router_id) || kitifiPortalRouterId());
        const ac = await kitifiTryAutoConnectOrder(order, order.voucher_code, null, plan);
        return {
          code: order.voucher_code,
          batch: order.kitifi_batch || "",
          auto_connected: !!ac?.ok,
          connect_url: ac?.connect_url || connectUrlForRouter(order.voucher_code, order.router_id),
        };
      } catch {}
      return { code: order.voucher_code, batch: order.kitifi_batch || "" };`
  );
}

const statusReadyNeedle = 'status: "ready",\n          voucher: order.voucher_code,\n          connect_url: connectUrlForRouter(order.voucher_code, order.router_id),';
if (src.includes(statusReadyNeedle) && !src.includes("auto_connected")) {
  src = src.replace(
    statusReadyNeedle,
    `status: "ready",
          voucher: order.voucher_code,
          connect_url: order.connect_url || connectUrlForRouter(order.voucher_code, order.router_id),
          auto_connected: !!order.auto_connected,`
  );
}

const statusFulfillNeedle = 'status: "ready",\n              voucher: result.code,\n              connect_url: connectUrlForRouter(result.code, order.router_id),';
if (src.includes(statusFulfillNeedle) && !src.includes("result.auto_connected")) {
  src = src.replace(
    statusFulfillNeedle,
    `status: "ready",
              voucher: result.code,
              connect_url: result.connect_url || connectUrlForRouter(result.code, order.router_id),
              auto_connected: !!result.auto_connected,`
  );
}

if (!src.includes('pathname === "/api/kitifi/redeem"')) {
  const statusBlock = 'if (pathname === "/api/kitifi/status" && req.method === "GET") {';
  const statusIdx = src.indexOf(statusBlock);
  if (statusIdx < 0) throw new Error("status route not found");

  const redeemRoute = `
    if (pathname === "/api/kitifi/redeem" && req.method === "GET") {
      const token = String(q.token || "").trim();
      if (!token) return err(res, 400, "Missing token.");
      let order = KitifiOrders.byToken(token);
      if (!order) return err(res, 404, "Order or voucher not found.");
      order = await syncKitifiPayment(order);
      if (order.status !== "ready" || !order.voucher_code) {
        if (order.status === "paid" || order.status === "generating") {
          try {
            const result = await fulfillKitifiOrder(order);
            order = KitifiOrders.byToken(token) || order;
            return ok(res, {
              voucher: result.code,
              connect_url: result.connect_url || connectUrlForRouter(result.code, order.router_id),
              auto_connected: !!result.auto_connected,
              connected: !!result.auto_connected,
            });
          } catch (e) {
            return err(res, 503, e.message || "Could not generate voucher.");
          }
        }
        return err(res, 409, "Voucher not ready yet.");
      }
      const plan = kitifiPlanById(order.plan_id, Number(order.router_id) || kitifiPortalRouterId());
      const ac = await kitifiTryAutoConnectOrder(order, order.voucher_code, null, plan);
      return ok(res, {
        voucher: order.voucher_code,
        connect_url: ac?.connect_url || connectUrlForRouter(order.voucher_code, order.router_id),
        auto_connected: !!ac?.ok,
        connected: !!ac?.ok,
        via: ac?.via || (ac?.ok ? "mikrotik-active-login" : ""),
      });
    }

`;
  src = src.slice(0, statusIdx) + redeemRoute + src.slice(statusIdx);
}

fs.writeFileSync(apiPath, src);
console.log("Patched", apiPath, "— GCash pay will auto-connect device by MAC.");
