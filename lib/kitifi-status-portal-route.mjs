/**
 * Ensure jmwifi.pro serves hotspot buy portal HTML used by hotspot-redirect fallback.
 */
export const STATUS_PORTAL_PATH = "/kitifi/hotspot-buy-portal.html";
export const LEGACY_STATUS_PORTAL_PATH = "/kitifi/status-portal-5th.html";

function routeSnippet(pathname, file) {
  return (
    '    if (pathname === "' +
    pathname +
    '" && req.method === "GET") {\n' +
    "      try {\n" +
    '        const buf = fs.readFileSync(path.join(__dirname, "public", "kitifi", "' +
    file +
    '"));\n' +
    '        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120" });\n' +
    "        return res.end(buf);\n" +
    "      } catch {\n" +
    '        res.writeHead(404, { "Content-Type": "text/plain" });\n' +
    '        return res.end("not found");\n' +
    "      }\n" +
    "    }\n"
  );
}

export const STATUS_PORTAL_ROUTE_SNIPPET =
  routeSnippet("/kitifi/hotspot-buy-portal.html", "hotspot-buy-portal.html") +
  routeSnippet("/kitifi/status-portal-5th.html", "status-portal-5th.html");

const ANCHOR =
  '    if (pathname === "/kitifi/status-portal-full.html" && req.method === "GET") {\n';

export function patchServerStatusPortalRoute(src) {
  let out = String(src || "");
  let changed = false;
  if (!out.includes(ANCHOR)) {
    return { src: out, changed: false, missing: ["status-portal-full anchor"] };
  }
  if (!out.includes('pathname === "/kitifi/hotspot-buy-portal.html"')) {
    out = out.replace(
      ANCHOR,
      routeSnippet("/kitifi/hotspot-buy-portal.html", "hotspot-buy-portal.html") + ANCHOR,
    );
    changed = true;
  }
  if (!out.includes('pathname === "/kitifi/status-portal-5th.html"')) {
    out = out.replace(
      ANCHOR,
      routeSnippet("/kitifi/status-portal-5th.html", "status-portal-5th.html") + ANCHOR,
    );
    changed = true;
  }
  return { src: out, changed };
}
