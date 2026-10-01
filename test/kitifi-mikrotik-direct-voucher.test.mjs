import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GCASH_GENERATE,
  hotspotLoginUrl,
  hotspotUserAddWords,
  kitifiUptimeToMikrotik,
  normalizeGcashGenerateMode,
  resolveHotspotUserProfile,
  shouldGenerateOnMikrotik,
} from "../lib/kitifi-mikrotik-direct-voucher.mjs";

test("GCash generate defaults to MikroTik-direct", () => {
  assert.equal(DEFAULT_GCASH_GENERATE, "mikrotik");
  assert.equal(normalizeGcashGenerateMode(""), "mikrotik");
  assert.equal(normalizeGcashGenerateMode("direct"), "mikrotik");
  assert.equal(normalizeGcashGenerateMode("kitifi"), "kitifi");
  assert.equal(normalizeGcashGenerateMode("controller"), "kitifi");
});

test("all KiTifi sites use MikroTik when gcash mode is mikrotik", () => {
  assert.equal(shouldGenerateOnMikrotik({ gcashMode: "mikrotik", routerId: 36 }), true);
  assert.equal(shouldGenerateOnMikrotik({ gcashMode: "mikrotik", routerId: 34 }), true);
  assert.equal(shouldGenerateOnMikrotik({ gcashMode: "mikrotik", routerId: 45 }), true);
  assert.equal(shouldGenerateOnMikrotik({ gcashMode: "kitifi", routerId: 36 }), false);
  assert.equal(shouldGenerateOnMikrotik({ gcashMode: "kitifi", freeMode: "mikrotik", routerId: 51 }), true);
  assert.equal(shouldGenerateOnMikrotik({ gcashMode: "kitifi", mikrotikRouterList: "51,36", routerId: 36 }), true);
});

test("10 Hours / 15 Hours map to MikroTik limit-uptime", () => {
  assert.equal(kitifiUptimeToMikrotik("10 Hours"), "10:00:00");
  assert.equal(kitifiUptimeToMikrotik("15 Hours"), "15:00:00");
  assert.equal(kitifiUptimeToMikrotik("1 Day"), "1d");
});

test("hotspot user is name=password on KITIFI profile, no KiTifi controller fields", () => {
  const words = hotspotUserAddWords({ code: "VC12345", profile: "KITIFI", uptime: "10 Hours" });
  assert.equal(words[0], "/ip/hotspot/user/add");
  assert.ok(words.includes("=name=VC12345"));
  assert.ok(words.includes("=password=VC12345"));
  assert.ok(words.includes("=profile=KITIFI"));
  assert.ok(words.includes("=limit-uptime=10:00:00"));
  assert.equal(words.some((w) => /10\.0\.0\.10|generateVoucher|seller/i.test(w)), false);
});

test("hotspot profile KITIFI resolves to live KiTiFi casing", () => {
  assert.equal(resolveHotspotUserProfile("KITIFI", ["KiTiFi", "FREE"]), "KiTiFi");
  assert.equal(resolveHotspotUserProfile("KITIFI", ["KITIFI", "FREE"]), "KITIFI");
  const words = hotspotUserAddWords({
    code: "VC99",
    profile: "KITIFI",
    uptime: "10 Hours",
    liveProfiles: ["KiTiFi", "FREE"],
  });
  assert.ok(words.includes("=profile=KiTiFi"));
});

test("auto-connect URL is the MikroTik hotspot login, not the KiTifi controller", () => {
  const url = hotspotLoginUrl("http://10.0.0.1/login", "VC99AA");
  assert.equal(url, "http://10.0.0.1/login?username=VC99AA&password=VC99AA");
  assert.equal(/10\.0\.0\.10/.test(url), false);
});

test("deploy patch flips GCash generate to MikroTik-direct", async () => {
  const { patchKitifiServerSource, OLD_ONLY } = await import("../deploy/enable-mikrotik-direct-gcash-voucher.mjs");
  const fake = "// header\n" + OLD_ONLY + "\nexport async function kitifiGenerateVoucher() {}\n";
  const { src, changed } = patchKitifiServerSource(fake);
  assert.equal(changed, true);
  assert.match(src, /kitifi_gcash_generate/);
  const again = patchKitifiServerSource(src);
  assert.equal(again.changed, false);
});
