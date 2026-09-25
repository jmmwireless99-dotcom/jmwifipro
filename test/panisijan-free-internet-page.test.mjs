import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/kitifi/free-internet.html"), "utf8");
const login = fs.readFileSync(path.join(root, "public/hotspot/panisijan-login.html"), "utf8");
const deploy = fs.readFileSync(path.join(root, "deploy/setup-panisijan-hotspot-trial.mjs"), "utf8");

test("captive portal free button is MikroTik hotspot trial, not VPS register", () => {
  assert.ok(login.includes("username=T-$(mac-esc)"));
  assert.ok(login.includes("$(link-login-only)"));
  assert.ok(login.includes(">CLAIM FREE INTERNET<"));
  assert.ok(!login.includes("/kitifi/free-internet"));
  assert.ok(!login.includes("Register And CLAIM"));
  assert.ok(login.includes("/kitifi/generator-buy"));
});

test("VPS free-internet page bounces Panisijan to hotspot trial", () => {
  assert.ok(html.includes("function startPanisijanHotspotTrial"));
  assert.ok(html.includes('username=" + encodeURIComponent("T-" + mac)'));
  assert.ok(html.includes("MikroTik hotspot trial"));
  assert.ok(html.includes("no VPS registration"));
  assert.ok(html.includes('if (isPanisijan)'));
  assert.ok(html.includes("startPanisijanHotspotTrial()"));
});

test("missing MAC on Panisijan does not open the register form", () => {
  const start = html.slice(html.indexOf("function startPanisijanHotspotTrial"));
  const body = start.slice(0, start.indexOf("location.replace"));
  assert.ok(body.includes('show("stepDisabled")'));
  assert.ok(!body.includes('show("stepRegister")'));
});

test("deploy script enables trial-uptime and daily T- user reset", () => {
  assert.ok(deploy.includes("trial-uptime="));
  assert.ok(deploy.includes('name~\\"^T-\\"') || deploy.includes('name~"^T-"'));
  assert.ok(deploy.includes("panisijan-reset-trials"));
});
