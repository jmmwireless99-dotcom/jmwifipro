// Upload all app code to VPS and restart (does NOT upload billing.db).
// Usage: node deploy/sync-vps.mjs
import { collectAppFiles, uploadToVps } from "./vps-config.mjs";

const files = collectAppFiles();
console.log(`Syncing ${files.length} files to VPS...\n`);
uploadToVps(files, { restart: true }).catch((e) => {
  console.error("\nFailed:", e.message);
  process.exit(1);
});
