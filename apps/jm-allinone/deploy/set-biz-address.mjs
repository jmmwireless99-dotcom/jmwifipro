// Update biz_address in billing.db. Run: node deploy/set-biz-address.mjs "Candelaria, Uson, Masbate"
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const addr = process.argv[2] || "Candelaria, Uson, Masbate";
const dbPath = process.env.DB_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "billing.db");
const db = new DatabaseSync(dbPath);
db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run("biz_address", addr);
console.log("biz_address =", addr, "in", dbPath);
