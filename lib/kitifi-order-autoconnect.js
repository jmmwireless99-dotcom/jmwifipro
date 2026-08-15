/**
 * Server-side WiFi login after GCash voucher — works even when the phone browser is in GCash.
 */
import {
  kitifiMikrotikOnlyRouter,
  kitifiMikrotikVoucherConnect,
  kitifiHotspotLoginByMac,
  kitifiOrderConnectUrl,
  kitifiConnectUrl,
  kitifiPaidHotspotProfile,
} from "./kitifi-server.js";
import { kitifiPlanById } from "./kitifi-vouchers.js";

function orderMac(order) {
  return String(order?.client_mac || order?.clientMac || "").trim();
}

function orderRouterId(order) {
  return Number(order?.router_id) || 0;
}

/** Log the paying device into MikroTik hotspot by MAC (no browser needed). */
export async function kitifiAutoConnectAfterOrder(conn, order, voucherCode, plan) {
  const code = String(voucherCode || order?.voucher_code || "").trim();
  const mac = orderMac(order);
  const routerId = orderRouterId(order);
  if (!code) return { ok: false, reason: "missing voucher" };
  if (!mac || mac.length < 11) return { ok: false, reason: "missing mac" };

  const p = plan || kitifiPlanById(order?.plan_id, routerId) || {};
  const uptime = order?.uptime || p.uptime || p.time || "";
  const profile = kitifiPaidHotspotProfile(routerId, order?.profile || p.profile);

  if (kitifiMikrotikOnlyRouter(routerId)) {
    return kitifiMikrotikVoucherConnect(conn, { mac, voucher: code, routerId, uptime, profile });
  }

  const mt = await kitifiHotspotLoginByMac(conn, { mac, voucher: code, routerId });
  if (mt?.ok) return mt;

  return kitifiMikrotikVoucherConnect(conn, { mac, voucher: code, routerId, uptime, profile });
}

/** Best connect URL for the order (gateway login or portal return). */
export async function kitifiConnectUrlForOrder(conn, order, voucherCode, plan) {
  const code = String(voucherCode || order?.voucher_code || "").trim();
  const routerId = orderRouterId(order);
  const mac = orderMac(order);
  const p = plan || kitifiPlanById(order?.plan_id, routerId) || {};
  if (!code) return "";

  if (conn && mac) {
    try {
      const url = await kitifiOrderConnectUrl(conn, {
        voucher: code,
        mac,
        routerId,
        uptime: order?.uptime || p.uptime || p.time,
        profile: kitifiPaidHotspotProfile(routerId, order?.profile || p.profile),
      });
      if (url) return url;
    } catch {}
  }

  return kitifiConnectUrl(code, routerId, mac);
}
