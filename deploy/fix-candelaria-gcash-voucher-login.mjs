/**
 * Fix Candelaria GCash vouchers "hindi pasok":
 * 1) Push status-portal with MikroTik login (KiTifi Submit returns User not found for MT-direct codes)
 * 2) Recover paid-but-failed orders (API timeout during fulfill)
 * 3) Optional: retry generate on timeout in server (patch)
 *
 * Usage: cd /opt/jm-billing && node deploy/fix-candelaria-gcash-voucher-login.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const HTML_REL = "public/kitifi/status-portal-5th.html";
const RID = 34;
const DRY = process.argv.includes("--dry-run");

export function assertCandelariaPortalHtml(html) {
  const s = String(html || "");
  if (!/BUY VOUCHER/i.test(s)) throw new Error("portal missing BUY VOUCHER");
  if (!/kitifiMikrotikLoginUrl/.test(s)) throw new Error("portal missing kitifiMikrotikLoginUrl");
  if (!/gcashBuyBtn/.test(s)) throw new Error("portal missing gcashBuyBtn");
  return true;
}

/** Retry wrapper text for fulfill generate — patch server.js before kitifiGenerateVoucher call. */
export function patchFulfillGenerateRetry(src) {
  const out = String(src || "");
  if (out.includes("kitifiGenerateWithRetry")) return { src: out, changed: false };
  const needle =
    "      const v = await kitifiGenerateVoucher(conn, {\n" +
    "        planId: order.plan_id, profile: order.profile, uptime: order.uptime,\n" +
    "        seller: order.seller || kitifiSellerName(),\n" +
    "        seller_id: kitifiSellerId(rid),\n" +
    "        routerId: rid,\n" +
    "        qty: 1,\n" +
    "      });";
  if (!out.includes(needle)) return { src: out, changed: false, missing: ["generate call"] };
  const helper =
    "async function kitifiGenerateWithRetry(conn, opts, tries = 3) {\n" +
    "  let last;\n" +
    "  for (let i = 0; i < tries; i++) {\n" +
    "    try { return await kitifiGenerateVoucher(conn, opts); }\n" +
    "    catch (e) {\n" +
    "      last = e;\n" +
    "      const msg = String(e.message || e);\n" +
    "      if (!/timed out|Cannot reach|ECONN|closed|socket/i.test(msg) || i === tries - 1) throw e;\n" +
    "      await new Promise((r) => setTimeout(r, 800 * (i + 1)));\n" +
    "    }\n" +
    "  }\n" +
    "  throw last;\n" +
    "}\n\n";
  const replacement =
    "      const v = await kitifiGenerateWithRetry(conn, {\n" +
    "        planId: order.plan_id, profile: order.profile, uptime: order.uptime,\n" +
    "        seller: order.seller || kitifiSellerName(),\n" +
    "        seller_id: kitifiSellerId(rid),\n" +
    "        routerId: rid,\n" +
    "        qty: 1,\n" +
    "      });";
  // Insert helper before fulfillKitifiOrder
  let next = out;
  if (!next.includes("async function kitifiGenerateWithRetry")) {
    const anchor = "async function fulfillKitifiOrder(token, ev) {";
    if (!next.includes(anchor)) return { src: out, changed: false, missing: ["fulfillKitifiOrder"] };
    next = next.replace(anchor, helper + anchor);
  }
  next = next.replace(needle, replacement);
  return { src: next, changed: next !== out };
}

async function main() {
  if (process.cwd() !== ROOT) process.chdir(ROOT);
  const html = fs.readFileSync(path.join(ROOT, HTML_REL), "utf8");
  assertCandelariaPortalHtml(html);
  console.log("ok", HTML_REL);

  // Patch server retry
  const serverPath = path.join(ROOT, "server.js");
  if (fs.existsSync(serverPath)) {
    const cur = fs.readFileSync(serverPath, "utf8");
    const patched = patchFulfillGenerateRetry(cur);
    if (patched.missing) console.warn("retry patch incomplete", patched.missing);
    else if (patched.changed && !DRY) {
      fs.writeFileSync(serverPath, patched.src);
      console.log("patched server.js generate retry");
    } else console.log(patched.changed ? "would patch server.js" : "server.js retry already present");
  }

  const { RouterOSAPI } = await import("../lib/routeros-api.js");
  const { kitifiLogin, kitifiAdminBase } = await import("../lib/kitifi-remote.js");
  const {
    kitifiGenerateVoucher,
    kitifiMikrotikVoucherConnect,
  } = await import("../lib/kitifi-server.js");
  const { kitifiPlanById } = await import("../lib/kitifi-vouchers.js");
  const { Audit } = await import("../lib/db.js");

  const db = new DatabaseSync(DB);
  const row = db.prepare("SELECT * FROM routers WHERE id=?").get(RID);
  if (!row) throw new Error("router 34 missing");

  const conn = new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    timeout: Number(process.env.KITIFI_TIMEOUT_MS || 90000),
  });
  await conn.identity();
  console.log("connected", row.name);

  if (!DRY) {
    const cookie = await kitifiLogin(conn, RID);
    const res = await conn.talk([
      "/tool/fetch",
      "=url=" + kitifiAdminBase(RID) + "/api/pages/settings",
      "=mode=http",
      "=http-method=post",
      "=http-header-field=Cookie: " + cookie + "\r\nContent-Type: application/json",
      "=http-data=" + JSON.stringify({ action: "savehtmlportal", html_portal: html }),
      "=output=user-with-headers",
      "=check-certificate=no",
    ]);
    const body = (res || []).map((x) => x.data || "").join("");
    if (!/"status"\s*:\s*true/i.test(body)) throw new Error("savehtmlportal failed: " + body.slice(0, 180));
    console.log("portal HTML pushed (MikroTik login + BUY)");
  }

  const failed = db
    .prepare(
      `SELECT * FROM kitifi_orders
       WHERE router_id=? AND status='failed'
         AND paid_at IS NOT NULL AND paid_at!=''
         AND (voucher_code IS NULL OR voucher_code='')
       ORDER BY id DESC LIMIT 20`,
    )
    .all(RID);
  console.log("failed_paid", failed.length);

  const recovered = [];
  for (const order of failed) {
    if (DRY) {
      recovered.push({ id: order.id, dry: true });
      continue;
    }
    try {
      const plan = kitifiPlanById(order.plan_id, RID);
      const v = await kitifiGenerateVoucher(conn, {
        planId: order.plan_id,
        plan,
        profile: order.profile || plan?.profile || "KITIFI",
        uptime: order.uptime || plan?.uptime,
        routerId: RID,
      });
      const code = String(v.code || "").trim();
      if (!code) throw new Error("empty code");
      db.prepare(
        `UPDATE kitifi_orders
         SET status='ready', voucher_code=?, fulfilled_at=datetime('now'),
             gateway_ref=COALESCE(NULLIF(gateway_ref,''), ?)
         WHERE id=?`,
      ).run(code, order.payment_intent_id || "", order.id);

      let acOk = false;
      if (order.client_mac) {
        const ac = await kitifiMikrotikVoucherConnect(conn, {
          mac: order.client_mac,
          voucher: code,
          routerId: RID,
          uptime: order.uptime,
          profile: order.profile || "KITIFI",
        });
        acOk = !!ac.ok;
        if (acOk) db.prepare(`UPDATE kitifi_orders SET autoconnected=1 WHERE id=?`).run(order.id);
        console.log("recover", order.id, code, acOk ? "autoconnect-ok" : "code-ready:" + (ac.reason || ""));
      } else {
        console.log("recover", order.id, code, "no-mac");
      }
      Audit.add({
        type: "auto",
        action: "kitifi-voucher",
        detail: code + " · recovered failed order " + order.id + " · gen:mikrotik-direct @ Candelaria-kitifi",
        ok: true,
      });
      recovered.push({ id: order.id, code, autoconnected: acOk });
    } catch (e) {
      console.log("recover FAIL", order.id, String(e.message || e).slice(0, 140));
    }
  }

  // Prove current generate still works
  if (!DRY) {
    const plan = kitifiPlanById("r9", RID);
    const v = await kitifiGenerateVoucher(conn, {
      planId: "r9",
      plan,
      routerId: RID,
      profile: "KITIFI",
      uptime: "10 Hours",
    });
    const users = (await conn.print("/ip/hotspot/user")) || [];
    const hit = users.find((u) => String(u.name) === v.code);
    console.log("prove generate", v.code, hit ? "on-mt" : "missing");
    if (hit?.[".id"]) await conn.talk(["/ip/hotspot/user/remove", "=.id=" + hit[".id"]]);
  }

  conn.close?.();
  db.close();

  // Restart if we patched server
  if (!DRY && fs.existsSync(serverPath)) {
    try {
      const { execSync } = await import("node:child_process");
      if (process.env.SKIP_RESTART !== "1") {
        execSync("systemctl restart jm-billing", { stdio: "inherit" });
        console.log("restarted jm-billing");
      }
    } catch (e) {
      console.warn("restart:", e.message);
    }
  }

  console.log(JSON.stringify({ recovered }, null, 2));
  console.log("Candelaria portal now uses MikroTik login for GCash vouchers (not KiTifi redeem).");
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
}
