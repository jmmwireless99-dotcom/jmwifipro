/**
 * KiTifi public + admin API handlers (GCash buy + Direct Seller Voucher Generator).
 */
import crypto from "node:crypto";
import { Settings, Routers, Audit, KitifiOrders } from "./db.js";
import {
  kitifiConfig,
  kitifiGenerateVoucher,
  kitifiGenerateBatch,
  kitifiTestLogin,
  kitifiGeneratorRatesDisplay,
  kitifiConnectUrl,
  kitifiDefaultProfile,
  kitifiSellerName,
} from "./kitifi-server.js";
import {
  kitifiSellerId,
  kitifiGenProfile,
  kitifiGenPrefix,
  kitifiGenChar,
  kitifiGenNameLength,
  kitifiRemoteRates,
} from "./kitifi-remote.js";
import { kitifiPlans, kitifiPlanById, kitifiPortalRouterId } from "./kitifi-vouchers.js";
import { hotspotCentralEnabled, mikrotikCentralRadiusScript } from "./hotspot-central.js";
import { genVoucherCode } from "./hotspot-generator.js";

export function createKitifiApi(deps) {
  const {
    send,
    connForRouter,
    paymentGateway,
    createGatewayPayment,
    createHotspotVoucher,
    hotspotCentralEnabled: centralEnabled = hotspotCentralEnabled,
  } = deps;

  function ok(res, data) {
    return send(res, 200, { ok: true, ...data });
  }

  function err(res, code, message) {
    return send(res, code, { ok: false, error: message });
  }

  function routerConn(routerId) {
    const rid = Number(routerId) || kitifiPortalRouterId();
    const row = Routers.get(rid);
    if (!row) throw new Error("Router #" + rid + " not found.");
    const conn = connForRouter(row);
    return { conn, row, routerId: rid };
  }

  async function fulfillKitifiOrder(order) {
    if (!order) throw new Error("Order not found.");
    if (order.status === "ready" && order.voucher_code) {
      return { code: order.voucher_code, batch: order.kitifi_batch || "" };
    }
    const routerId = Number(order.router_id) || kitifiPortalRouterId();
    const { conn, row } = routerConn(routerId);
    await conn.identity();
    if (!KitifiOrders.tryClaimFulfill(order.id, order.gateway_ref || "")) {
      const again = KitifiOrders.byToken(order.token);
      if (again?.status === "ready" && again.voucher_code) {
        return { code: again.voucher_code, batch: again.kitifi_batch || "" };
      }
      throw new Error("Voucher is already being generated. Please wait.");
    }
    try {
      const plan = kitifiPlanById(order.plan_id, routerId);
      const result = await kitifiGenerateVoucher(conn, {
        planId: order.plan_id,
        plan,
        profile: order.profile || plan?.profile || kitifiDefaultProfile(),
        uptime: order.uptime || plan?.uptime || "",
        routerId,
        seller_id: kitifiSellerId(routerId),
      });
      KitifiOrders.saveBatch(order.id, result.batch || "");
      KitifiOrders.markFulfilled(order.id, result.code, order.gateway_ref || "");
      Audit.add({
        type: "auto",
        action: "kitifi-voucher",
        detail: `${result.code} plan=${order.plan_id} ₱${order.amount} @ ${row.name}`,
        ok: true,
      });
      return result;
    } catch (e) {
      KitifiOrders.markFailed(order.id, e.message);
      throw e;
    } finally {
      conn.close?.();
    }
  }

  async function syncKitifiPayment(order) {
    if (!order?.payment_intent_id) return order;
    const gw = paymentGateway();
    if (!gw.configured || gw.name !== "paymongo" || !gw.getIntent) return order;
    try {
      const intent = await gw.getIntent(order.payment_intent_id);
      if (intent.status === "succeeded" && order.status === "pending") {
        order = KitifiOrders.markPaid(order.id, order.payment_intent_id) || order;
      }
    } catch {}
    return order;
  }

  /** Public KiTifi buy/status API — no panel login. */
  async function handleKitifiPublic(req, res, pathname, readBody) {
    const url = new URL(req.url, "http://localhost");
    const q = Object.fromEntries(url.searchParams);

    if (pathname === "/api/kitifi/config" && req.method === "GET") {
      const cfg = kitifiConfig();
      const rid = q.router_id ? Number(q.router_id) : kitifiPortalRouterId();
      const loginKey = rid ? "kitifi_hotspot_login_" + rid : "";
      const login = (loginKey && Settings.get(loginKey, "")) || cfg.hotspot_login;
      return ok(res, { data: { ...cfg, hotspot_login: login } });
    }

    if (pathname === "/api/kitifi/plans" && req.method === "GET") {
      const rid = q.router_id ? Number(q.router_id) : kitifiPortalRouterId();
      return ok(res, { plans: kitifiPlans(rid).filter((p) => Number(p.price) >= 20) });
    }

    if (pathname === "/api/kitifi/generator-rates" && req.method === "GET") {
      const rid = q.router_id ? Number(q.router_id) : kitifiPortalRouterId();
      return ok(res, { rates: kitifiGeneratorRatesDisplay(rid) });
    }

    if (pathname === "/api/kitifi/buy" && req.method === "POST") {
      const raw = (await readBody(req)) || "";
      let b;
      try { b = JSON.parse(raw || "{}"); } catch { return err(res, 400, "Bad data."); }
      const routerId = Number(b.router_id) || kitifiPortalRouterId();
      const plan = kitifiPlanById(b.plan_id, routerId);
      if (!plan) return err(res, 400, "Invalid KiTifi rate.");
      const amount = Number(plan.price) || 0;
      if (amount < 20) return err(res, 400, "GCash minimum is ₱20.");
      const gw = paymentGateway();
      if (!gw.configured) return err(res, 503, "Online payment isn't set up yet.");
      const token = crypto.randomBytes(12).toString("hex");
      const portalTag = "kitifi:" + token;
      const desc = "KiTifi voucher — " + (plan.name || plan.time || "WiFi") + " (₱" + amount + ")";
      try {
        let paymentIntentId = "";
        let qrImageUrl = "";
        if (gw.name === "paymongo" && gw.createQrph) {
          const qr = await gw.createQrph({ amountPhp: amount, description: desc, metadata: { portal: portalTag } });
          paymentIntentId = qr.payment_intent_id || "";
          qrImageUrl = qr.qr_image_url || "";
        } else {
          const pay = await createGatewayPayment(gw, { amountPhp: amount, description: desc, remarks: portalTag });
          paymentIntentId = pay.payment_intent_id || pay.id || "";
        }
        KitifiOrders.create({
          token,
          planId: plan.id,
          amount,
          profile: plan.profile || kitifiDefaultProfile(),
          uptime: plan.uptime || plan.time || "",
          routerId,
          paymentIntentId,
          clientMac: b.mac || "",
          clientPhone: b.phone || "",
          seller: kitifiSellerName(),
        });
        return ok(res, {
          token,
          amount,
          plan: plan.name || plan.time || "",
          qr_image_url: qrImageUrl,
          payment_intent_id: paymentIntentId,
        });
      } catch (e) {
        return err(res, 502, "Could not start payment: " + e.message);
      }
    }

    if (pathname === "/api/kitifi/status" && req.method === "GET") {
      const token = String(q.token || "").trim();
      if (!token) return err(res, 400, "Missing token.");
      let order = KitifiOrders.byToken(token);
      if (!order) return err(res, 404, "Order not found.");
      order = await syncKitifiPayment(order);
      if (order.status === "ready" && order.voucher_code) {
        return ok(res, {
          status: "ready",
          voucher: order.voucher_code,
          connect_url: kitifiConnectUrl(order.voucher_code) + "&autoconnect=1",
        });
      }
      if (order.status === "paid" || order.status === "generating" || (order.status === "pending" && order.payment_intent_id)) {
        if (order.status === "pending") {
          order = await syncKitifiPayment(order);
        }
        if (order.status === "paid" || order.status === "generating") {
          try {
            const result = await fulfillKitifiOrder(order);
            return ok(res, {
              status: "ready",
              voucher: result.code,
              connect_url: kitifiConnectUrl(result.code) + "&autoconnect=1",
            });
          } catch (e) {
            if (order.status === "generating") {
              return ok(res, { status: "generating", message: "Generating voucher on KiTifi…" });
            }
            return ok(res, { status: "failed", error: e.message });
          }
        }
        return ok(res, { status: "pending" });
      }
      if (order.status === "failed") return ok(res, { status: "failed", error: "KiTifi voucher generation failed." });
      return ok(res, { status: order.status || "pending" });
    }

    return null;
  }

  /** Admin hotspot generator API — requires panel login (via handleBilling). */
  async function handleHotspotGenerators(req, res, sub, method, body, q) {
    const okData = (data) => send(res, 200, { ok: true, data });

    if (sub === "/hotspot-generators/config" && method === "GET") {
      const kitifi = kitifiConfig();
      let remoteRates = [];
      let remoteError = "";
      const rid = kitifi.router_id || kitifiPortalRouterId();
      try {
        const { conn } = routerConn(rid);
        await conn.identity();
        remoteRates = await kitifiRemoteRates(conn, null, { routerId: rid });
        conn.close?.();
      } catch (e) {
        remoteError = e.message;
      }
      return okData({
        kitifi: {
          ...kitifi,
          rates: kitifiPlans(rid),
          remote_rates: remoteRates,
          remote_rates_error: remoteError || undefined,
        },
        routers: Routers.list().filter((r) => r.enabled !== 0),
        central: centralEnabled(),
      });
    }

    if (sub === "/hotspot-generators/kitifi-settings" && method === "POST") {
      const map = {
        kitifi_controller_url: body.kitifi_controller_url,
        kitifi_admin_user: body.kitifi_admin_user,
        kitifi_admin_pass: body.kitifi_admin_pass,
        kitifi_seller_name: body.kitifi_seller_name,
        kitifi_seller_id: body.kitifi_seller_id,
        kitifi_gen_profile: body.kitifi_gen_profile,
        kitifi_gen_prefix: body.kitifi_gen_prefix,
        kitifi_gen_name_length: body.kitifi_gen_name_length,
        kitifi_default_profile: body.kitifi_gen_profile || body.kitifi_default_profile,
        kitifi_router_id: body.kitifi_router_id,
      };
      for (const [k, v] of Object.entries(map)) {
        if (v != null && v !== "") Settings.set(k, String(v));
      }
      return okData({ saved: true });
    }

    if (sub === "/hotspot-generators/kitifi-test" && method === "POST") {
      const rid = Number(body.router_id) || kitifiPortalRouterId();
      const { conn, row } = routerConn(rid);
      await conn.identity();
      await kitifiTestLogin(conn);
      const rates = await kitifiRemoteRates(conn, null, { routerId: rid });
      conn.close?.();
      return okData({ router: row.name, rates: rates.length, ok: true });
    }

    if (sub === "/hotspot-generators/kitifi" && method === "POST") {
      const rid = Number(body.router_id) || kitifiPortalRouterId();
      const { conn, row } = routerConn(rid);
      await conn.identity();
      const qty = Math.min(Math.max(Number(body.count) || 1, 1), 500);
      const opts = {
        qty,
        r_id: String(body.r_id || body.rate_id || ""),
        seller_id: String(body.seller_id || kitifiSellerId(rid)),
        profile: String(body.profile || kitifiGenProfile() || kitifiDefaultProfile()),
        prefix: String(body.prefix != null ? body.prefix : kitifiGenPrefix()),
        name_length: String(body.name_length || body.length || kitifiGenNameLength()),
        char: String(body.char || kitifiGenChar()),
        type: "default",
        routerId: rid,
      };
      const result = await kitifiGenerateBatch(conn, opts);
      conn.close?.();
      Audit.add({
        type: "manual",
        action: "kitifi-generate",
        detail: `${result.count}x ${result.profile} batch ${result.batch} @ ${row.name} (seller ${opts.seller_id})`,
        ok: true,
      });
      return okData({
        created: result.codes || [],
        count: result.count || (result.codes || []).length,
        batch: result.batch || "",
        profile: result.profile || opts.profile,
        seller: body.seller || kitifiSellerName(),
        seller_id: result.seller_id || opts.seller_id,
        router: row.name,
        r_id: result.r_id || opts.r_id,
        generator: "kitifi-admin-remote",
      });
    }

    if (sub === "/hotspot-generators/radius-script" && method === "GET") {
      const host = q.host || Settings.get("radius_host", "") || "187.77.145.131";
      const secret = q.secret || Settings.get("radius_secret", "") || "jmwifi-radius";
      const script = mikrotikCentralRadiusScript({
        radiusHost: host,
        secret,
        authPort: Number(Settings.get("radius_port", "1812")) || 1812,
      });
      return okData({ script, radius_host: host });
    }

    if (sub === "/hotspot-generators/radius-settings" && method === "POST") {
      if (body.radius_host != null) Settings.set("radius_host", String(body.radius_host));
      if (body.radius_secret != null) Settings.set("radius_secret", String(body.radius_secret));
      if (body.radius_port != null) Settings.set("radius_port", String(body.radius_port));
      return okData({ saved: true });
    }

    if (sub === "/hotspot-generators/radius" && method === "POST") {
      const profile = body.profile || "VOUCHER";
      const count = Math.min(Math.max(Number(body.count) || 1, 1), 500);
      const made = [];
      const errors = [];
      for (let i = 0; i < count; i++) {
        const code = genVoucherCode(body.length, body.prefix);
        try {
          await createHotspotVoucher({
            code,
            password: body.userOnly !== false ? "" : code,
            profile,
            uptime: body.uptime || "",
            routerId: body.router_id ? Number(body.router_id) : null,
            source: "panel",
          });
          made.push(code);
        } catch (e) {
          errors.push(e.message);
        }
      }
      return okData({ created: made, count: made.length, profile, errors, central: centralEnabled() });
    }

    return null;
  }

  async function handleKitifiWebhook(portalTag) {
    const m = String(portalTag || "").match(/^kitifi:([a-f0-9]+)$/i);
    if (!m) return null;
    const order = KitifiOrders.byToken(m[1]);
    if (!order) return null;
    if (order.status === "pending") KitifiOrders.markPaid(order.id, order.payment_intent_id || "");
    if (order.status === "ready" && order.voucher_code) return { code: order.voucher_code };
    return fulfillKitifiOrder(KitifiOrders.byToken(m[1]));
  }

  return { handleKitifiPublic, handleHotspotGenerators, fulfillKitifiOrder, handleKitifiWebhook };
}
