// lib/paymongo.js — create GCash/card payment Links and verify webhooks.
// Uses node:https only. Base URL is configurable for testing.
import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";

function request(urlStr, { method = "GET", headers = {}, body = null, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error("bad URL")); }
    const lib = u.protocol === "http:" ? http : https;
    const data = body == null ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const h = { "Content-Type": "application/json", Accept: "application/json", ...headers };
    if (data) h["Content-Length"] = data.length;
    const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443), path: u.pathname + u.search, method, headers: h, timeout }, (res) => {
      let d = ""; res.setEncoding("utf8"); res.on("data", (c) => (d += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, text: d, json: j }); });
    });
    req.on("timeout", () => req.destroy(new Error("PayMongo timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// cfg: { secret, baseUrl }   amountPhp in pesos (e.g. 500.00)
export async function createLink(cfg, { amountPhp, description, remarks, successUrl, failedUrl }) {
  if (!cfg.secret) throw new Error("PayMongo secret key not set");
  const baseUrl = (cfg.baseUrl || "https://api.paymongo.com/v1").replace(/\/$/, "");
  const auth = "Basic " + Buffer.from(cfg.secret + ":").toString("base64");
  const attrs = { amount: Math.round(Number(amountPhp) * 100), description: description || "Invoice", remarks: remarks || "" };
  // PayMongo Links don't redirect after checkout; redirect URLs are kept for API parity with Xendit.
  if (successUrl) attrs.success_url = successUrl;
  if (failedUrl) attrs.failed_url = failedUrl;
  const r = await request(baseUrl + "/links", {
    method: "POST",
    headers: { Authorization: auth },
    body: { data: { attributes: attrs } },
  });
  if (r.status < 200 || r.status >= 300 || !r.json || !r.json.data) {
    const msg = r.json && r.json.errors ? r.json.errors.map((e) => e.detail).join("; ") : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  const a = r.json.data.attributes || {};
  return { id: r.json.data.id, checkout_url: a.checkout_url, reference_number: a.reference_number, status: a.status };
}

function pmAuth(secret) {
  return "Basic " + Buffer.from(secret + ":").toString("base64");
}

function pmErr(r) {
  return r.json && r.json.errors ? r.json.errors.map((e) => e.detail).join("; ") : `HTTP ${r.status}`;
}

// QR Ph: Payment Intent → Payment Method (qrph) → attach → base64 QR image.
// metadata.portal should be "CODE:purpose" (same tag as Link remarks) for webhook matching.
export async function createQrphPayment(cfg, { amountPhp, description, metadata = {} }) {
  if (!cfg.secret) throw new Error("PayMongo secret key not set");
  const baseUrl = (cfg.baseUrl || "https://api.paymongo.com/v1").replace(/\/$/, "");
  const auth = pmAuth(cfg.secret);
  const cents = Math.round(Number(amountPhp) * 100);
  if (cents < 2000) throw new Error("Minimum QR Ph payment is ₱20");

  const pi = await request(baseUrl + "/payment_intents", {
    method: "POST",
    headers: { Authorization: auth },
    body: {
      data: {
        attributes: {
          amount: cents,
          currency: "PHP",
          payment_method_allowed: ["qrph"],
          description: description || "Payment",
          metadata: Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v ?? "")])),
        },
      },
    },
  });
  if (pi.status < 200 || pi.status >= 300 || !pi.json?.data) throw new Error(pmErr(pi));
  const piId = pi.json.data.id;
  const clientKey = pi.json.data.attributes?.client_key || "";

  const pm = await request(baseUrl + "/payment_methods", {
    method: "POST",
    headers: { Authorization: auth },
    body: { data: { attributes: { type: "qrph" } } },
  });
  if (pm.status < 200 || pm.status >= 300 || !pm.json?.data) throw new Error(pmErr(pm));
  const pmId = pm.json.data.id;

  const attachBody = { data: { attributes: { payment_method: pmId } } };
  if (clientKey) attachBody.data.attributes.client_key = clientKey;
  const att = await request(baseUrl + "/payment_intents/" + encodeURIComponent(piId) + "/attach", {
    method: "POST",
    headers: { Authorization: auth },
    body: attachBody,
  });
  if (att.status < 200 || att.status >= 300 || !att.json?.data) throw new Error(pmErr(att));
  const aa = att.json.data.attributes || {};
  let qrImageUrl = aa.next_action?.code?.image_url || "";
  if (qrImageUrl && !/^data:image\//i.test(qrImageUrl)) qrImageUrl = "data:image/png;base64," + qrImageUrl;
  return {
    id: piId,
    payment_intent_id: piId,
    client_key: clientKey,
    qr_image_url: qrImageUrl,
    status: aa.status || "awaiting_next_action",
    amount: cents,
  };
}

export async function getPaymentIntent(cfg, id) {
  if (!cfg.secret || !id) throw new Error("PayMongo secret key or intent id missing");
  const baseUrl = (cfg.baseUrl || "https://api.paymongo.com/v1").replace(/\/$/, "");
  const r = await request(baseUrl + "/payment_intents/" + encodeURIComponent(id), {
    headers: { Authorization: pmAuth(cfg.secret) },
  });
  if (r.status < 200 || r.status >= 300 || !r.json?.data) throw new Error(pmErr(r));
  const a = r.json.data.attributes || {};
  return {
    id: r.json.data.id,
    status: a.status,
    amount: a.amount,
    metadata: a.metadata || {},
    description: a.description || "",
  };
}

// Verify a PayMongo webhook signature.
// Header format: "t=<unix>,te=<test sig>,li=<live sig>"
export function verifyWebhook(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret || !signatureHeader) return false;
  const parts = {};
  for (const seg of String(signatureHeader).split(",")) {
    const i = seg.indexOf("=");
    if (i > 0) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  }
  if (!parts.t) return false;
  const expected = crypto.createHmac("sha256", webhookSecret).update(parts.t + "." + rawBody).digest("hex");
  for (const sig of [parts.te, parts.li]) {
    if (!sig) continue;
    try {
      const a = Buffer.from(expected, "hex"), b = Buffer.from(sig, "hex");
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch {}
  }
  return false;
}

// Pull the useful bits out of a webhook event body.
export function parseEvent(json) {
  const ev = json && json.data && json.data.attributes;
  if (!ev) return null;
  const resource = ev.data && ev.data.attributes ? ev.data.attributes : {};
  const meta = resource.metadata || {};
  const remarks = resource.remarks || meta.portal || meta.remarks || "";
  return {
    type: ev.type,                                  // e.g. "link.payment.paid" or "payment.paid"
    resourceId: ev.data ? ev.data.id : null,
    paymentIntentId: resource.payment_intent_id || null,
    status: resource.status,
    remarks,
    amount: resource.amount,
  };
}
