// Run on VPS: diagnose expiry suspend for BILLING1
import { DatabaseSync } from "node:sqlite";

const DB = "/opt/jm-billing/billing.db";
const db = new DatabaseSync(DB);

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const localNow = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

console.log("server_now:", localNow);

const settings = db.prepare("SELECT k,v FROM settings WHERE k IN ('mikrotik_host','mikrotik_port','mikrotik_user','suspended_profile','expiry_check_mins','expiry_grace_mins','auto_renew_credit','auto_suspend')").all();
console.log("\nsettings:", JSON.stringify(settings, null, 2));

const routers = db.prepare("SELECT id,name,host,port,username,enabled,is_default FROM routers").all();
console.log("\nrouters:", JSON.stringify(routers, null, 2));

const customers = db.prepare(`
  SELECT c.id,c.name,c.username,c.status,c.expiry,c.router_id,c.auto_suspended,p.name AS plan_name,p.router_profile
  FROM customers c LEFT JOIN plans p ON p.id=c.plan_id
  WHERE c.username LIKE '%BILLING%' OR c.name LIKE '%Joel%'
  ORDER BY c.id DESC
`).all();
console.log("\ncustomers:", JSON.stringify(customers, null, 2));

const expired = db.prepare(`
  SELECT c.id,c.name,c.username,c.status,c.expiry,c.router_id
  FROM customers c
  WHERE c.status='active' AND trim(c.expiry) <> ''
    AND datetime(replace(trim(c.expiry), 'T', ' ')) <= datetime(?)
    AND trim(c.username) <> ''
`).all(localNow);
console.log("\nexpiredAsOf(active):", JSON.stringify(expired, null, 2));

const billing1 = db.prepare("SELECT id,credit,plan_id FROM customers WHERE username='BILLING1'").get();
const plan = billing1 ? db.prepare("SELECT price FROM plans WHERE id=?").get(billing1.plan_id) : null;
console.log("\nBILLING1 wallet:", JSON.stringify({ ...billing1, plan_price: plan?.price }));

const manilaNow = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Manila" });
console.log("manila_now:", manilaNow);

const audit = db.prepare(`
  SELECT id,created_at,action,detail,ok,customer_name FROM audit
  WHERE customer_name LIKE '%Joel%' OR detail LIKE '%BILLING%' OR action IN ('suspend','reconnect')
  ORDER BY id DESC LIMIT 20
`).all();
console.log("\nrecent_audit:", JSON.stringify(audit, null, 2));
