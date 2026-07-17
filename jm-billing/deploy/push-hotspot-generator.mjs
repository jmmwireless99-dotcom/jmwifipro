// Push Jeffrey's original hotspot generator to jmwifi.pro VPS and restart.
// Usage: VPS_PASS='your-password' node deploy/push-hotspot-generator.mjs
import { uploadToVps } from "./vps-config.mjs";

const FILES = [
  "lib/hotspot-generator.js",
  "server.js",
  "public/index.html",
];

console.log("Pushing original hotspot generator to jmwifi.pro VPS...\n");
uploadToVps(FILES, { restart: true }).catch((e) => {
  console.error("\nFailed:", e.message);
  process.exit(1);
});
