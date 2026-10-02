import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchMobileAppRoutes, MOBILE_ROUTE_MARKER } from "../lib/mobile-app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sample = `
    if (pathname === "/sales-history" && req.method === "GET") {
      return;
    }
    if (pathname === "/apply" && req.method === "GET") {
      return;
    }
`;

const patched = patchMobileAppRoutes(sample);
assert.equal(patched.changed, true);
assert.ok(patched.src.includes(MOBILE_ROUTE_MARKER));
assert.ok(patched.src.includes('pathname === "/app"'));
assert.ok(patched.src.includes("public\", \"mobile\""));

const again = patchMobileAppRoutes(patched.src);
assert.equal(again.changed, false);

for (const rel of [
  "public/mobile/index.html",
  "public/mobile/app.js",
  "public/mobile/app.css",
  "public/mobile/manifest.webmanifest",
  "public/mobile/sw.js",
  "public/mobile/icons/icon-192.png",
  "public/mobile/icons/icon-512.png",
]) {
  assert.ok(fs.existsSync(path.join(root, rel)), "missing " + rel);
}

const html = fs.readFileSync(path.join(root, "public/mobile/index.html"), "utf8");
assert.match(html, /manifest\.webmanifest/);
assert.match(html, /JM WIFI Sales/);
assert.match(html, /app\.js/);

console.log("ok mobile-app tests");
