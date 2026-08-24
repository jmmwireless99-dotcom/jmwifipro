import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/kitifi/free-internet.html"), "utf8");
const login = fs.readFileSync(path.join(root, "public/hotspot/panisijan-login.html"), "utf8");

test("free-internet page skips registration for Panisijan", () => {
  assert.match(html, /function skipRegister/);
  assert.match(html, /isPanisijan \|\| !!\(data && data.skip_register\)/);
  assert.match(html, /Walang registration/);
  assert.match(html, /CLAIM FREE INTERNET/);
  assert.match(html, /show\("stepClaim"\)/);
});

test("missing MAC on Panisijan does not open the register form", () => {
  assert.match(html, /if \(isPanisijan\) \{[\s\S]*show\("stepDisabled"\)/);
  assert.doesNotMatch(
    html,
    /if \(!mac\) \{[\s\S]*show\("stepRegister"\)[\s\S]*return;\s*\}\s*var r = await api\("\/api\/kitifi\/free\/status/
  );
});

test("captive portal button is claim-only, not Register", () => {
  assert.match(login, />CLAIM FREE INTERNET</);
  assert.doesNotMatch(login, /Register And CLAIM/);
  assert.doesNotMatch(login, /while you register/);
});
