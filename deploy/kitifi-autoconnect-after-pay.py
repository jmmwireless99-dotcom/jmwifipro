#!/usr/bin/env python3
"""After GCash voucher payment, log the phone into MikroTik like jmwifi.pro."""
from pathlib import Path

api = Path("/opt/jm-allinone/lib/kitifi-api.js")
srv = Path("/opt/jm-allinone/server.js")
js = Path("/opt/jm-allinone/public/kitifi/kitifi-connect.js")

text = api.read_text()
if "kitifi-autoconnect-after-pay" not in text:
    text = text.replace(
        "import { resolveKitifiBuyRouterId } from \"./kitifi-mikrotik-direct-voucher.mjs\";",
        "import { resolveKitifiBuyRouterId, hotspotLoginUrl } from \"./kitifi-mikrotik-direct-voucher.mjs\";",
        1,
    )
    text = text.replace(
        "  kitifiSellerName,\n} from \"./kitifi-server.js\";",
        "  kitifiSellerName,\n  kitifiHotspotLoginByMac,\n} from \"./kitifi-server.js\";",
        1,
    )
    text = text.replace(
        """  function connectUrlForRouter(voucherCode, routerId) {
    const code = String(voucherCode || "").trim();
    return kitifiHotspotLoginForRouter(routerId) + "?username=" + encodeURIComponent(code);
  }
""",
        """  function connectUrlForRouter(voucherCode, routerId) {
    return hotspotLoginUrl(kitifiHotspotLoginForRouter(routerId), voucherCode);
  }

  // kitifi-autoconnect-after-pay — MikroTik hotspot login (username + password), same as jmwifi.pro.
  async function autoConnectVoucher(conn, order) {
    const code = String(order.voucher_code || "").trim();
    const mac = String(order.client_mac || "").trim();
    if (!code || mac.replace(/[:-]/g, "").length < 10) return false;
    try {
      const login = await kitifiHotspotLoginByMac(conn, {
        mac, voucher: code, routerId: order.router_id,
      });
      if (login && login.ok) {
        try { KitifiOrders.markAutoconnected(order.id); } catch {}
        Audit.add({
          type: "auto", action: "kitifi-autoconnect",
          detail: code + " mac " + mac + (login.already ? " already" : " logged-in"),
          ok: true,
        });
        return true;
      }
      Audit.add({
        type: "auto", action: "kitifi-autoconnect",
        detail: code + " " + ((login && login.reason) || "not on wifi"),
        ok: false,
      });
    } catch (e) {
      Audit.add({ type: "auto", action: "kitifi-autoconnect", detail: code + " " + e.message, ok: false });
    }
    return false;
  }

  async function readyConnectPayload(order) {
    const routerId = resolveKitifiBuyRouterId(Number(order.router_id) || kitifiPortalRouterId());
    let connected = Number(order.autoconnected) === 1;
    if (!connected && order.voucher_code && order.client_mac) {
      try {
        const opened = routerConn(routerId);
        try {
          connected = await autoConnectVoucher(opened.conn, { ...order, router_id: routerId });
        } finally { opened.conn.close?.(); }
      } catch {}
    }
    return {
      voucher: order.voucher_code,
      connect_url: connectUrlForRouter(order.voucher_code, routerId),
      plan_name: order.plan_name || "",
      amount: order.amount,
      auto_connected: connected,
    };
  }
""",
        1,
    )
    old_ret = """      KitifiOrders.markFulfilled(order.id, result.code, order.gateway_ref || "");
      Audit.add({
        type: "auto",
        action: "kitifi-voucher",
        detail: `${result.code} plan=${order.plan_id} ₱${order.amount} · gen:${result.generator || "mikrotik-direct"} @ ${row.name}`,
        ok: true,
      });
      return result;
"""
    new_ret = """      KitifiOrders.markFulfilled(order.id, result.code, order.gateway_ref || "");
      Audit.add({
        type: "auto",
        action: "kitifi-voucher",
        detail: `${result.code} plan=${order.plan_id} ₱${order.amount} · gen:${result.generator || "mikrotik-direct"} @ ${row.name}`,
        ok: true,
      });
      const connected = await autoConnectVoucher(conn, {
        ...order, voucher_code: result.code, router_id: routerId,
      });
      return {
        ...result,
        auto_connected: connected,
        connect_url: connectUrlForRouter(result.code, routerId),
      };
"""
    if old_ret not in text:
        raise SystemExit("fulfill return anchor missing")
    text = text.replace(old_ret, new_ret, 1)

    old_redeem = """        return ok(res, {
          voucher: order.voucher_code,
          connect_url: connectUrlForRouter(order.voucher_code, order.router_id),
          plan_name: order.plan_name || "",
          amount: order.amount,
          auto_connected: false,
        });
"""
    new_redeem = """        const ready = await readyConnectPayload(order);
        return ok(res, ready);
"""
    if old_redeem not in text:
        raise SystemExit("redeem anchor missing")
    text = text.replace(old_redeem, new_redeem, 1)

    old_status = """      if (order.status === "ready" && order.voucher_code) {
        return ok(res, {
          status: "ready",
          voucher: order.voucher_code,
          connect_url: connectUrlForRouter(order.voucher_code, order.router_id),
        });
      }
"""
    new_status = """      if (order.status === "ready" && order.voucher_code) {
        const ready = await readyConnectPayload(order);
        return ok(res, { status: "ready", ...ready });
      }
"""
    if old_status not in text:
        raise SystemExit("status ready anchor missing")
    text = text.replace(old_status, new_status, 1)

    old_gen = """            return ok(res, {
              status: "ready",
              voucher: result.code,
              connect_url: connectUrlForRouter(result.code, order.router_id),
            });
"""
    new_gen = """            return ok(res, {
              status: "ready",
              voucher: result.code,
              connect_url: result.connect_url || connectUrlForRouter(result.code, order.router_id),
              auto_connected: !!result.auto_connected,
            });
"""
    if old_gen not in text:
        raise SystemExit("status generate anchor missing")
    text = text.replace(old_gen, new_gen, 1)

    old_return = "  return { handleKitifiPublic, handleHotspotGenerators, fulfillKitifiOrder, handleKitifiWebhook };"
    new_return = """  let _kitifiSweeping = false;
  async function sweepKitifiAfterPay() {
    if (_kitifiSweeping) return;
    _kitifiSweeping = true;
    try {
      try { KitifiOrders.resetStuckGenerating(90); } catch {}
      for (const row of (KitifiOrders.pendingRecent(1800, 12) || [])) {
        let order = await syncKitifiPayment(row);
        if (order && (order.status === "paid" || order.status === "generating")) {
          try { await fulfillKitifiOrder(order); } catch {}
        }
      }
      for (const order of (KitifiOrders.readyUnconnectedRecent(900, 8) || [])) {
        try { await readyConnectPayload(order); } catch {}
      }
    } finally { _kitifiSweeping = false; }
  }
  setInterval(() => { sweepKitifiAfterPay().catch(() => {}); }, 20000);
  setTimeout(() => { sweepKitifiAfterPay().catch(() => {}); }, 8000);

  return { handleKitifiPublic, handleHotspotGenerators, fulfillKitifiOrder, handleKitifiWebhook };
"""
    if old_return not in text:
        raise SystemExit("return anchor missing")
    text = text.replace(old_return, new_return, 1)
    api.write_text(text)
    print("patched kitifi-api.js")
else:
    print("kitifi-api already patched")

st = srv.read_text()
old_tag = "tagSrc = pi.metadata?.portal || pi.description || tagSrc;"
new_tag = "tagSrc = pi.metadata?.portal || (pi.metadata?.kitifi ? (\"kitifi:\" + pi.metadata.kitifi) : \"\") || pi.description || tagSrc;"
if old_tag in st:
    srv.write_text(st.replace(old_tag, new_tag, 1))
    print("patched webhook metadata")
elif "metadata?.kitifi" in st:
    print("webhook already reads kitifi metadata")
else:
    raise SystemExit("webhook tag anchor missing")

cj = js.read_text()
old_js = """    var ctx = ctxFromPage();
    var ret = opts.returnUrl || ctx.returnUrl;
    // Prefer portal return (Kitifi #v_code + Submit) when we have a captive portal URL.
    if (ret && portalBack(ret, code, true)) return true;

    if (opts.connect_url) {
      global.location.replace(opts.connect_url);
      return true;
    }
"""
new_js = """    var ctx = ctxFromPage();
    var ret = opts.returnUrl || ctx.returnUrl;
    // jmwifi.pro style: hop straight to MikroTik login (username + password).
    if (opts.connect_url) {
      global.location.replace(opts.connect_url);
      return true;
    }
    if (ret && portalBack(ret, code, true)) return true;
"""
if old_js in cj:
    js.write_text(cj.replace(old_js, new_js, 1))
    print("patched kitifi-connect.js")
elif "hop straight to MikroTik login" in cj:
    print("connect js already patched")
else:
    raise SystemExit("connect js anchor missing")
