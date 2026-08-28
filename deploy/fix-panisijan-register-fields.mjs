/**
 * PANISIJAN register list: save last name, CP #, purok (server was dropping them).
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/fix-panisijan-register-fields.mjs
 *   systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const files = [
  ["public/panisijan/free-wifi-admin.html", "public/panisijan/free-wifi-admin.html"],
];
for (const [srcRel, destRel] of files) {
  const src = path.join(ROOT, srcRel);
  const dest = path.join(ROOT, destRel);
  if (!fs.existsSync(src)) throw new Error("Missing " + src);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
  console.log("ok", destRel);
}

const serverPath = path.join(ROOT, "server.js");
if (!fs.existsSync(serverPath)) {
  console.log("server.js not in this tree (ok in git repo). Patch it on the VPS.");
  process.exit(0);
}

let src = fs.readFileSync(serverPath, "utf8");
const old = `        const client = KitifiFreeClients.register({
          name: b.name, dob: b.dob, purok: b.purok, barangay: b.barangay, municipal: b.municipal,
          mac: b.mac, routerId: b.router_id,
        });`;
const next = `        const client = KitifiFreeClients.register({
          name: b.name, last_name: b.last_name, dob: b.dob, cp_number: b.cp_number, purok: b.purok,
          barangay: b.barangay, municipal: b.municipal, province: b.province,
          mac: b.mac, routerId: b.router_id,
        });`;

if (src.includes("last_name: b.last_name") && src.includes("cp_number: b.cp_number")) {
  console.log("server.js already saves last_name and cp_number");
} else if (!src.includes(old)) {
  throw new Error("Could not find kitifi free/register payload in server.js");
} else {
  src = src.replace(old, next);
  fs.writeFileSync(serverPath, src);
  console.log("patched server.js free/register to save last_name, cp_number, purok, province");
}

console.log("Restart: systemctl restart jm-billing");
