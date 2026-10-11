import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2] || "billing.db");
const name = process.argv[3] || "";
if (name) {
  console.log("exact:", db.prepare("SELECT id,name,host,port FROM routers WHERE name=?").get(name));
  console.log("like:", db.prepare("SELECT id,name,host,port FROM routers WHERE name LIKE ?").all(`%${name}%`));
}
console.log("all:", db.prepare("SELECT id,name,host,port FROM routers ORDER BY id").all());
