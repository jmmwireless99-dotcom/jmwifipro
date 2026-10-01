/**
 * Ensure jmwifi.pro serves /kitifi/status-portal-5th.html (used by hotspot-redirect fallback).
 */
export const STATUS_PORTAL_PATH = "/kitifi/status-portal-5th.html";

export const STATUS_PORTAL_ROUTE_SNIPPET =
  '    if (pathname === "/kitifi/status-portal-5th.html" && req.method === "GET") {\n' +
  "      try {\n" +
  '        const buf = fs.readFileSync(path.join(__dirname, "public", "kitifi", "status-portal-5th.html"));\n' +
  '        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120" });\n' +
  "        return res.end(buf);\n" +
  "      } catch {\n" +
  '        res.writeHead(404, { "Content-Type": "text/plain" });\n' +
  '        return res.end("not found");\n' +
  "      }\n" +
  "    }\n";

const ANCHOR =
  '    if (pathname === "/kitifi/status-portal-full.html" && req.method === "GET") {\n';

export function patchServerStatusPortalRoute(src) {
  const out = String(src || "");
  if (out.includes('pathname === "/kitifi/status-portal-5th.html"')) {
    return { src: out, changed: false };
  }
  if (!out.includes(ANCHOR)) {
    return { src: out, changed: false, missing: ["status-portal-full anchor"] };
  }
  return {
    src: out.replace(ANCHOR, STATUS_PORTAL_ROUTE_SNIPPET + ANCHOR),
    changed: true,
  };
}
