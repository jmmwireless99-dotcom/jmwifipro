/** Set ipoe_suspend_list on billing DB. Usage: node deploy/set-ipoe-setting.mjs [db-path] */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.argv[2] || path.join(ROOT, "billing.db");
const LIST = process.argv[3] || "IPOE-EXPIRED";

const db = new DatabaseSync(DB);
db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run("ipoe_suspend_list", LIST);
console.log("ipoe_suspend_list =", LIST, "on", DB);
