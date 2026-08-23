/**
 * Copy Candelaria-kitifi BUY VOUCHER setup → 5thserver (router 45).
 * Wrapper around copy-candelaria-kitifi-to-site.mjs (Candelaria read-only).
 *
 * Usage: cd /opt/jm-billing && node deploy/copy-candelaria-buy-voucher-to-5th.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "copy-candelaria-kitifi-to-site.mjs");
const r = spawnSync(process.execPath, [script, "45"], {
  stdio: "inherit",
  env: { ...process.env, KITIFI_DST_ID: "45", KITIFI_SRC_ID: "34" },
});
process.exit(r.status ?? 1);
