import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/panisijan/free-wifi-admin.html"), "utf8");
const lib = fs.readFileSync(path.join(root, "lib/kitifi-free-wifi.js"), "utf8");
const deploy = fs.readFileSync(path.join(root, "deploy/fix-panisijan-register-fields.mjs"), "utf8");

test("admin list shows last name, CP #, and purok columns", () => {
  assert.ok(html.includes("<th>Last name</th>"));
  assert.ok(html.includes("<th>CP #</th>"));
  assert.ok(html.includes("<th>Purok</th>"));
  assert.ok(html.includes("c.purok"));
  assert.ok(html.includes("c.last_name"));
  assert.ok(html.includes("c.cp_number"));
  assert.ok(html.includes("Search name, last name, CP #, purok"));
});

test("register keeps last name, CP, and purok on insert and fill-empty update", () => {
  assert.ok(lib.includes("last_name=CASE WHEN last_name IS NULL OR last_name='' THEN ? ELSE last_name END"));
  assert.ok(lib.includes("cp_number=CASE WHEN cp_number IS NULL OR cp_number='' THEN ? ELSE cp_number END"));
  assert.ok(lib.includes("purok=CASE WHEN purok IS NULL OR purok='' THEN ? ELSE purok END"));
});

test("deploy patch passes last_name and cp_number into register()", () => {
  assert.ok(deploy.includes("last_name: b.last_name"));
  assert.ok(deploy.includes("cp_number: b.cp_number"));
  assert.ok(deploy.includes("purok: b.purok"));
});
