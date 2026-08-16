/**
 * Create PANISIJAN Free WiFi admin account (router 51 client list only).
 *
 * Usage:
 *   PANISIJAN_ADMIN_USER=panisijan PANISIJAN_ADMIN_PASS='YourPassword' node deploy/create-panisijan-free-admin.mjs
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const USERNAME = String(process.env.PANISIJAN_ADMIN_USER || "panisijan").trim();
const PASSWORD = String(process.env.PANISIJAN_ADMIN_PASS || "Panisijan@2026").trim();
const ROUTER_ID = 51;
const ROLE = "panisijan_free_admin";

const db = new DatabaseSync(DB);

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

const existing = db.prepare("SELECT id, username, role FROM users WHERE username=? COLLATE NOCASE").get(USERNAME);
const { salt, hash } = hashPassword(PASSWORD);

if (existing && existing.role === "admin") {
  console.error(
    `Refusing to overwrite billing super-admin "${USERNAME}" (id ${existing.id}). ` +
      "Rename that account first, or choose a different PANISIJAN_ADMIN_USER."
  );
  process.exit(1);
}

if (existing) {
  db.prepare("UPDATE users SET salt=?, hash=?, role=? WHERE id=?").run(salt, hash, ROLE, existing.id);
  db.prepare("DELETE FROM user_sites WHERE user_id=?").run(existing.id);
  db.prepare("INSERT INTO user_sites (user_id, router_id) VALUES (?,?)").run(existing.id, ROUTER_ID);
  console.log("Updated existing user:", USERNAME, "→ role", ROLE, "· router", ROUTER_ID);
} else {
  const r = db.prepare("INSERT INTO users (username, salt, hash, role) VALUES (?,?,?,?)").run(USERNAME, salt, hash, ROLE);
  db.prepare("INSERT INTO user_sites (user_id, router_id) VALUES (?,?)").run(r.lastInsertRowid, ROUTER_ID);
  console.log("Created user:", USERNAME, "· role", ROLE, "· router", ROUTER_ID);
}

console.log("\nLogin URL: https://jmwifi.pro/panisijan/admin");
console.log("Username:", USERNAME);
console.log("Password:", PASSWORD);
console.log("\nChange password anytime by re-running with PANISIJAN_ADMIN_PASS=...");
