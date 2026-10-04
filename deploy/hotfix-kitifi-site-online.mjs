import { readFileSync, writeFileSync } from "node:fs";

const path = "/opt/jm-billing/server.js";
let src = readFileSync(path, "utf8");
const needle = 'from "./lib/mikrotik-site-offline.mjs";\n';
const helper =
  "function kitifiSiteIsOnline(rid) {\n" +
  "  const id = Number(rid) || 0;\n" +
  "  if (!id) return true;\n" +
  '  return isSiteOnlineFlag(Settings.get(siteOnlineKey(id), ""));\n' +
  "}\n";

if (src.includes("function kitifiSiteIsOnline(")) {
  console.log("helper already present");
} else if (!src.includes(needle)) {
  throw new Error("import needle missing");
} else {
  src = src.replace(needle, needle + helper);
  writeFileSync(path, src);
  console.log("inserted helper");
}
