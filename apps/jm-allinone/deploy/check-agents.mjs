import { DatabaseSync } from "node:sqlite";

const DB = process.env.BILLING_DB || "/opt/jm-billing/billing.db";
const db = new DatabaseSync(DB);

const agents = db.prepare(
  "SELECT a.id, a.name, a.agent_code, a.user_id, u.username, u.role FROM agents a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id"
).all();
const orphanUsers = db.prepare(
  "SELECT id, username, role FROM users WHERE LOWER(role)='agent' AND id NOT IN (SELECT user_id FROM agents WHERE user_id IS NOT NULL)"
).all();

console.log("Agents:", agents.length);
for (const a of agents) {
  console.log(`  #${a.id} ${a.name} code=${a.agent_code} user=${a.username || "(none)"} user_id=${a.user_id}`);
}
console.log("Agent users without profile:", orphanUsers.length);
for (const u of orphanUsers) console.log(`  user #${u.id} ${u.username}`);
