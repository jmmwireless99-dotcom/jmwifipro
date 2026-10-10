// Auto-upload changed files to VPS (watches lib/, public/, server.js).
// Usage: node deploy/watch-vps.mjs
import fs from "node:fs";
import path from "node:path";
import { ROOT, relPath, shouldSyncRel, uploadToVps } from "./vps-config.mjs";

const WATCH_DIRS = ["lib", "public"].map((d) => path.join(ROOT, d));
const WATCH_FILE = path.join(ROOT, "server.js");

let pending = new Set();
let timer = null;
let busy = false;

function queue(rel) {
  if (!shouldSyncRel(rel)) return;
  pending.add(rel);
  clearTimeout(timer);
  timer = setTimeout(flush, 1200);
}

async function flush() {
  if (busy || !pending.size) return;
  busy = true;
  const batch = [...pending];
  pending.clear();
  console.log(`\n[${new Date().toLocaleTimeString()}] Uploading ${batch.length} file(s)...`);
  try {
    await uploadToVps(batch, { restart: true });
  } catch (e) {
    console.error("Upload failed:", e.message);
  }
  busy = false;
  if (pending.size) flush();
}

function watchDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.watch(dir, { recursive: true }, (_ev, name) => {
    if (!name) return;
    queue(relPath(path.join(dir, name)));
  });
  console.log("Watching", path.relative(ROOT, dir));
}

console.log("Auto-upload to VPS — save a file to deploy.\nPress Ctrl+C to stop.\n");
if (fs.existsSync(WATCH_FILE)) {
  fs.watch(WATCH_FILE, () => queue("server.js"));
  console.log("Watching server.js");
}
for (const d of WATCH_DIRS) watchDir(d);

process.stdin.resume();
