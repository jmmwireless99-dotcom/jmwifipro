import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertCandelariaPortalHtml,
  patchFulfillGenerateRetry,
} from "../deploy/fix-candelaria-gcash-voucher-login.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "public/kitifi/status-portal-5th.html");
const SCRIPT = path.join(ROOT, "deploy/fix-candelaria-gcash-voucher-login.mjs");

test("Candelaria portal HTML uses MikroTik login for GCash vouchers", () => {
  assertCandelariaPortalHtml(fs.readFileSync(HTML, "utf8"));
});

test("fulfill generate retry patch inserts kitifiGenerateWithRetry", () => {
  const sample =
    "async function fulfillKitifiOrder(token, ev) {\n" +
    "  try {\n" +
    "      const v = await kitifiGenerateVoucher(conn, {\n" +
    "        planId: order.plan_id, profile: order.profile, uptime: order.uptime,\n" +
    "        seller: order.seller || kitifiSellerName(),\n" +
    "        seller_id: kitifiSellerId(rid),\n" +
    "        routerId: rid,\n" +
    "        qty: 1,\n" +
    "      });\n" +
    "  } catch {}\n" +
    "}\n";
  const { src, changed } = patchFulfillGenerateRetry(sample);
  assert.equal(changed, true);
  assert.match(src, /kitifiGenerateWithRetry/);
  assert.equal(patchFulfillGenerateRetry(src).changed, false);
});

test("deploy script recovers failed paid orders and pushes portal", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /savehtmlportal/);
  assert.match(src, /status='failed'/);
  assert.match(src, /kitifiMikrotikVoucherConnect/);
  assert.match(src, /kitifiGenerateWithRetry|patchFulfillGenerateRetry/);
});
