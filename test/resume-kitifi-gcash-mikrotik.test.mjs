import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  KITIFI_DELETED_ROUTER_ALIAS,
  remapPortalSitesJson,
  resolveKitifiBuyRouterId,
  patchServerBuyRouterAlias,
  patchMikrotikGenerateProfile,
  GENERATE_PROFILE_OLD,
  GENERATE_PROFILE_NEW,
} from "../lib/kitifi-mikrotik-direct-voucher.mjs";
import { assertResumePortalHtml } from "../deploy/resume-kitifi-gcash-mikrotik.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "public/kitifi/status-portal-5th.html");
const SCRIPT = path.join(ROOT, "deploy/resume-kitifi-gcash-mikrotik.mjs");

test("deleted 2nd/3rd/1st router ids alias to live rows", () => {
  assert.equal(KITIFI_DELETED_ROUTER_ALIAS[36], 57);
  assert.equal(KITIFI_DELETED_ROUTER_ALIAS[46], 56);
  assert.equal(KITIFI_DELETED_ROUTER_ALIAS[42], 52);
  assert.equal(resolveKitifiBuyRouterId(36), 57);
  assert.equal(resolveKitifiBuyRouterId(46), 56);
  assert.equal(resolveKitifiBuyRouterId(42), 52);
  assert.equal(resolveKitifiBuyRouterId(34), 34);
  assert.equal(resolveKitifiBuyRouterId(57), 57);
});

test("portal_sites JSON copies 3rd/2nd onto live ids", () => {
  const next = JSON.parse(
    remapPortalSitesJson(
      JSON.stringify({
        36: { name: "3rd-server", enabled: true },
        46: { name: "2nd-server", enabled: true },
        34: { name: "Candelaria-kitifi", enabled: true },
      }),
    ),
  );
  assert.equal(next["57"].name, "3rd-server");
  assert.equal(next["56"].name, "2nd-server");
  assert.equal(next["36"].enabled, false);
  assert.equal(next["36"].replaced_by, 57);
  assert.equal(next["34"].enabled, true);
});

test("resume portal HTML has BUY VOUCHER and MikroTik login, live router ids", () => {
  const html = fs.readFileSync(HTML, "utf8");
  assertResumePortalHtml(html);
  assert.match(html, /Insert Coin/);
  assert.match(html, /kitifiMikrotikLoginUrl/);
  assert.doesNotMatch(html, /generateVoucher/);
});

test("resume deploy turns GCash buy on and generates on MikroTik", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /GCASH_BUY_ENABLED_KEY, "1"/);
  assert.match(src, /GCASH_GENERATE_KEY/);
  assert.match(src, /DEFAULT_GCASH_GENERATE/);
  assert.match(src, /copySiteSettings/);
  assert.match(src, /patchServerBuyRouterAlias/);
  assert.match(src, /\/ip\/hotspot\/user/);
  assert.doesNotMatch(src, /\/api\/pay-start/);
});

test("server buy/fulfill remaps deleted router ids", () => {
  const src =
    'import { isGcashBuyEnabled } from "./lib/kitifi-gcash-buy-pause.mjs";\n' +
    "      const portalRouterId = kitifiPortalRouterId(b.router_id);\n" +
    "          routerId: kitifiPortalRouterId(b.router_id), paymentIntentId: paymentRef,\n" +
    "      const rid = order.router_id || kitifiPortalRouterId();\n" +
    '    if (pathname === "/api/kitifi/generator-rates" && req.method === "GET") {\n' +
    '      const routerId = new URL(req.url, "http://localhost").searchParams.get("router_id") || "";\n' +
    '      const gcashOn = isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, "0"));\n' +
    '    if (pathname === "/api/kitifi/config" && req.method === "GET") {\n' +
    '      const routerId = new URL(req.url, "http://localhost").searchParams.get("router_id") || "";\n' +
    "      return send(res, 200, { ok: true, ...kitifiConfig(routerId || undefined) });";
  const patched = patchServerBuyRouterAlias(src);
  assert.equal(patched.changed, true);
  assert.match(patched.src, /resolveKitifiBuyRouterId\(kitifiPortalRouterId/);
  assert.match(patched.src, /resolveKitifiBuyRouterId\(order\.router_id/);
  assert.match(patched.src, /resolveKitifiBuyRouterId\(rawRid/);
  const again = patchServerBuyRouterAlias(patched.src);
  assert.equal(again.changed, false);
});

test("MikroTik generate fallback profile is KITIFI not default", () => {
  const patched = patchMikrotikGenerateProfile("pre\n" + GENERATE_PROFILE_OLD + "\npost");
  assert.equal(patched.changed, true);
  assert.equal(patched.src.includes(GENERATE_PROFILE_NEW), true);
  assert.match(patched.src, /KITIFI/);
  assert.equal(patchMikrotikGenerateProfile(patched.src).changed, false);
});
