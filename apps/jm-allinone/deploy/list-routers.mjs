import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2] || "/opt/jm-billing/billing.db");
console.log(JSON.stringify(db.prepare("SELECT id,name,host,port,username,enabled,is_default,last_status FROM routers").all(), null, 2));
