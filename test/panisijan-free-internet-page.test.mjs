import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/kitifi/free-internet.html"), "utf8");
const login = fs.readFileSync(path.join(root, "public/hotspot/panisijan-login.html"), "utf8");

test("free-internet page skips registration for Panisijan", () => {
  assert.ok(html.includes("function skipRegister"));
  assert.ok(html.includes('isPanisijan || !!(data && data.skip_register)'));
  assert.ok(html.includes("Walang registration"));
  assert.ok(html.includes("CLAIM FREE INTERNET"));
  assert.ok(html.includes('show("stepClaim")'));
});

test("missing MAC on Panisijan does not open the register form", () => {
  assert.ok(html.includes('Connect to PANISIJAN WiFi and open this page from the captive portal.'));
  const load = html.slice(html.indexOf("async function loadStatus"));
  const missing = load.slice(0, load.indexOf("var r = await api"));
  assert.ok(missing.includes("if (isPanisijan)"));
  assert.ok(missing.includes('show("stepDisabled")'));
});

test("captive portal button is claim-only, not Register", () => {
  assert.ok(login.includes(">CLAIM FREE INTERNET<"));
  assert.ok(!login.includes("Register And CLAIM"));
  assert.ok(!login.includes("while you register"));
});
