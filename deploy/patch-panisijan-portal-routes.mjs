/**
 * Add public routes for PANISIJAN portal music on VPS (minimal server.js patch).
 * Usage: node deploy/patch-panisijan-portal-routes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = process.env.SERVER_JS || path.join(ROOT, "server.js");
const marker = 'if (pathname === "/kitifi/free-internet"';
const insert = `    if (pathname === "/hotspot/portal-music.js" && req.method === "GET") {
      try {
        const buf = fs.readFileSync(path.join(__dirname, "public", "hotspot", "portal-music.js"));
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" });
        return res.end(buf);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("not found");
      }
    }
    if (pathname === "/hotspot/audio/free-wifi-panisijan.mp3" && req.method === "GET") {
      try {
        const fp = path.join(__dirname, "public", "hotspot", "audio", "free-wifi-panisijan.mp3");
        const buf = fs.readFileSync(fp);
        res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400", "Accept-Ranges": "bytes" });
        return res.end(buf);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("not found");
      }
    }
`;

let src = fs.readFileSync(serverPath, "utf8");
if (src.includes('"/hotspot/audio/free-wifi-panisijan.mp3"')) {
  console.log("Routes already patched.");
  process.exit(0);
}
const idx = src.indexOf(marker);
if (idx < 0) {
  console.error("Could not find insertion point in server.js");
  process.exit(1);
}
src = src.slice(0, idx) + insert + src.slice(idx);
fs.writeFileSync(serverPath, src);
console.log("Patched", serverPath);
