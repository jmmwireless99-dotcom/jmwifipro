import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PANISIJAN_ROUTER_ID,
  PANISIJAN_BUY_PROFILE,
  PANISIJAN_FREE_PROFILE,
  panisijanMikrotikSettings,
  patchKitifiGenProfilePerRouter,
  patchKitifiDefaultProfilePerRouter,
  patchKitifiConfigPerRouterProfiles,
  patchServerGeneratorRatesProfile,
  patchServerBuyOrderProfileFallback,
  ensurePortalSitePanisijan,
} from "../lib/panisijan-mikrotik-claim-buy.mjs";
import { shouldGenerateOnMikrotik } from "../lib/kitifi-mikrotik-direct-voucher.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "deploy/enable-panisijan-mikrotik-claim-buy.mjs");

test("Panisijan settings force MikroTik claim + buy profiles", () => {
  assert.equal(PANISIJAN_ROUTER_ID, 51);
  assert.equal(PANISIJAN_BUY_PROFILE, "default");
  assert.equal(PANISIJAN_FREE_PROFILE, "FREE");
  const m = panisijanMikrotikSettings();
  assert.equal(m.kitifi_free_mode_51, "mikrotik");
  assert.equal(m.kitifi_gcash_generate, "mikrotik");
  assert.equal(m.kitifi_gcash_generate_51, "mikrotik");
  assert.equal(m.kitifi_gen_profile_51, "default");
  assert.equal(m.kitifi_free_profile_51, "FREE");
  assert.equal(m.kitifi_free_enabled_51, "1");
});

test("global mikrotik generate includes Panisijan router 51", () => {
  assert.equal(
    shouldGenerateOnMikrotik({ gcashMode: "mikrotik", routerId: 51 }),
    true,
  );
  assert.equal(
    shouldGenerateOnMikrotik({
      gcashMode: "kitifi",
      freeMode: "mikrotik",
      routerId: 51,
    }),
    true,
  );
});

test("patches wire per-router gen/default profile + rates/buy fallback", () => {
  const remote =
    "export function kitifiGenProfile() {\n" +
    '  return Settings.get("kitifi_gen_profile", "KITIFI");\n' +
    "}\n";
  const r = patchKitifiGenProfilePerRouter(remote);
  assert.equal(r.changed, true);
  assert.match(r.src, /kitifi_gen_profile_" \+ String\(routerId\)/);

  const server =
    "export function kitifiDefaultProfile() {\n" +
    '  return Settings.get("kitifi_default_profile", "KITIFI");\n' +
    "}\n" +
    "export function kitifiConfig(routerId) {\n" +
    "  const rid = 51;\n" +
    "  return {\n" +
    "    default_profile: kitifiDefaultProfile(),\n" +
    "    gen_profile: kitifiGenProfile(),\n" +
    "  };\n" +
    "}\n";
  const d = patchKitifiDefaultProfilePerRouter(server);
  const c = patchKitifiConfigPerRouterProfiles(d.src);
  assert.equal(d.changed, true);
  assert.equal(c.changed, true);
  assert.match(c.src, /kitifiDefaultProfile\(rid\)/);
  assert.match(c.src, /kitifiGenProfile\(rid\)/);

  const rates =
    '        profile: Settings.get("kitifi_gen_profile", "KITIFI"),\n';
  const rp = patchServerGeneratorRatesProfile(rates);
  assert.equal(rp.changed, true);
  assert.match(rp.src, /kitifi_gen_profile_" \+ \(routerId/);

  const buy = 'profile: plan.profile || "KITIFI"';
  const bp = patchServerBuyOrderProfileFallback(buy);
  assert.equal(bp.changed, true);
  assert.match(bp.src, /portalRouterId/);
});

test("portal_sites enables Panisijan", () => {
  const next = JSON.parse(ensurePortalSitePanisijan("{}"));
  assert.equal(next["51"].enabled, true);
  assert.match(String(next["51"].name), /PANISIJAN/i);
});

test("deploy script covers claim + buy MikroTik sync", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /kitifi_free_mode_51/);
  assert.match(src, /PANISIJAN_FREE_PROFILE/);
  assert.match(src, /PANISIJAN_BUY_PROFILE/);
  assert.match(src, /ensureGarden|GARDEN_HOSTS/);
  assert.match(src, /claimOk|CLAIM CHECK/);
});
