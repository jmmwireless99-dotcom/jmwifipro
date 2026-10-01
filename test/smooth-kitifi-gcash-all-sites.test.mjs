import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CAWAYAN_SKIP_LINE,
  GARDEN_HOSTS,
  stripCawayanAutoconnectSkip,
  patchKitifiServerAll,
} from "../deploy/smooth-kitifi-gcash-all-sites.mjs";
import { assertResumePortalHtml } from "../deploy/resume-kitifi-gcash-mikrotik.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "public/kitifi/status-portal-5th.html");
const SCRIPT = path.join(ROOT, "deploy/smooth-kitifi-gcash-all-sites.mjs");

test("smooth deploy covers GCash garden hosts used by Candelaria", () => {
  assert.ok(GARDEN_HOSTS.includes("jmwifi.pro"));
  assert.ok(GARDEN_HOSTS.includes("paymongo.com"));
  assert.ok(GARDEN_HOSTS.includes("gcash.com"));
  assert.ok(GARDEN_HOSTS.includes("checkout.paymongo.com"));
});

test("Cawayan autoconnect skip is removed for MikroTik-direct GCash", () => {
  const dirty =
    "export async function kitifiMikrotikVoucherConnect(conn, { routerId } = {}) {\n" +
    CAWAYAN_SKIP_LINE +
    "  return { ok: true };\n}\n" +
    "export async function kitifiRedeemVoucher(conn, { routerId } = {}) {\n" +
    CAWAYAN_SKIP_LINE +
    "  return { ok: true };\n}\n";
  const { src, changed } = stripCawayanAutoconnectSkip(dirty);
  assert.equal(changed, true);
  assert.doesNotMatch(src, /cawayan excluded/);
  assert.equal(stripCawayanAutoconnectSkip(src).changed, false);
});

test("portal HTML still matches Candelaria buy + MikroTik login", () => {
  assertResumePortalHtml(fs.readFileSync(HTML, "utf8"));
});

test("smooth script wires settings, garden, portal push, Cawayan fix", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /GCASH_BUY_ENABLED_KEY/);
  assert.match(src, /stripCawayanAutoconnectSkip/);
  assert.match(src, /ensureGarden/);
  assert.match(src, /savehtmlportal/);
  assert.match(src, /kitifi_admin_pass_/);
  assert.match(src, /resolveHotspotUserProfile/);
  assert.match(src, /pushHotspotPortalRedirect/);
  assert.match(src, /hotspot-redirect/);
});

test("portal detects rid query for hotspot-redirect fallback sites", () => {
  const html = fs.readFileSync(HTML, "utf8");
  assert.match(html, /URLSearchParams\(location\.search/);
  assert.match(html, /q\.get\("rid"\)/);
  assert.match(html, /link-login-only/);
});

test("hotspot redirect helper builds Candelaria public portal URL", async () => {
  const { hotspotRedirectHtml, PUBLIC_STATUS_PORTAL } = await import(
    "../lib/kitifi-hotspot-portal-redirect.mjs"
  );
  assert.match(PUBLIC_STATUS_PORTAL, /status-portal-5th\.html/);
  const h = hotspotRedirectHtml({ rid: 57, site: "3rd", kind: "status" });
  assert.match(h, /rid=57/);
  assert.match(h, /site=3rd/);
  assert.match(h, /\$\(mac\)/);
  assert.match(h, /location\.replace/);
});

test("server.js gains public route for status-portal-5th.html", async () => {
  const { patchServerStatusPortalRoute } = await import("../lib/kitifi-status-portal-route.mjs");
  const sample =
    '    if (pathname === "/kitifi/status-portal-full.html" && req.method === "GET") {\n' +
    "      return;\n" +
    "    }\n";
  const { src, changed } = patchServerStatusPortalRoute(sample);
  assert.equal(changed, true);
  assert.match(src, /status-portal-5th\.html/);
  assert.equal(patchServerStatusPortalRoute(src).changed, false);
});

test("patchKitifiServerAll removes Cawayan skip when present", () => {
  const src =
    'export function kitifiMikrotikOnlyRouter(){return true}\n' +
    "export async function kitifiMikrotikVoucherConnect(conn, { routerId } = {}) {\n" +
    CAWAYAN_SKIP_LINE +
    "  return { ok: true };\n}\n";
  // Without OLD_ONLY bodies, generate patches may be missing — still strip Cawayan.
  const { src: out, changed } = stripCawayanAutoconnectSkip(src);
  assert.equal(changed, true);
  assert.doesNotMatch(out, /cawayan excluded/);
  assert.equal(typeof patchKitifiServerAll, "function");
});
