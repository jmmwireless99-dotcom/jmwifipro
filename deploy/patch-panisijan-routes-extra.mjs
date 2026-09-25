import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverPath = process.env.SERVER_JS || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js");
let src = fs.readFileSync(serverPath, "utf8");
const blocks = [];

if (!src.includes('"/kitifi/kitifi-connect.js"')) {
  blocks.push(`    if (pathname === "/kitifi/kitifi-connect.js" && req.method === "GET") {
      try {
        const buf = fs.readFileSync(path.join(__dirname, "public", "kitifi", "kitifi-connect.js"));
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" });
        return res.end(buf);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("not found");
      }
    }
`);
}

if (!src.includes('"/hotspot/panisijan-autoconnect.js"')) {
  blocks.push(`    if (pathname === "/hotspot/panisijan-autoconnect.js" && req.method === "GET") {
      try {
        const buf = fs.readFileSync(path.join(__dirname, "public", "hotspot", "panisijan-autoconnect.js"));
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" });
        return res.end(buf);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("not found");
      }
    }
`);
}

if (!blocks.length) {
  console.log("Extra routes already present.");
  process.exit(0);
}

const marker = src.includes('if (pathname === "/hotspot/portal-music.js"')
  ? 'if (pathname === "/hotspot/portal-music.js"'
  : 'if (pathname === "/kitifi/free-internet"';
const idx = src.indexOf(marker);
if (idx < 0) throw new Error("Insertion point not found");
src = src.slice(0, idx) + blocks.join("") + src.slice(idx);
fs.writeFileSync(serverPath, src);
console.log("Added", blocks.length, "route block(s)");
