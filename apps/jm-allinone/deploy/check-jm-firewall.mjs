import path from "node:path";
import { fileURLToPath } from "node:url";
import { Routers } from "../lib/db.js";
import { RouterOSAPI } from "../lib/routeros-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const r = Routers.list().find((x) => x.name === (process.argv[2] || "PPPOE-JMPRO"));
const c = new RouterOSAPI({
  host: (r.host || "").split(":")[0],
  user: r.username,
  password: r.password,
  port: Number(r.port) || 8728,
});

const nat = await c.print("/ip/firewall/nat");
const filt = await c.print("/ip/firewall/filter");
const prof = await c.print("/ppp/profile", { "?name": "suspended-pool" });

console.log("suspended-pool profile:", prof[0]?.name, "| address-list:", prof[0]?.["address-list"], "| pool:", prof[0]?.["remote-address"]);
console.log("\nNAT rules (suspend/JM/Kurifot):");
for (const x of nat) {
  const s = JSON.stringify(x);
  if (/ppp_reminder|suspended|JM WIFI|KURIFOT|GRACE|portal/i.test(s)) {
    console.log(" ", x.comment, "| src-list:", x["src-address-list"], "|", x.action, x["to-ports"] || "");
  }
}
console.log("\nFilter rules (suspend/JM/Kurifot):");
for (const x of filt) {
  const s = JSON.stringify(x);
  if (/ppp_reminder|suspended|JM WIFI|KURIFOT|GRACE|ONLINE PAYMENTS/i.test(s)) {
    console.log(" ", x.comment, "| src-list:", x["src-address-list"], "|", x.action);
  }
}
