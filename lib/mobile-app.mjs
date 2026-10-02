/**
 * Patch server.js to serve the JM WIFI Sales mobile PWA at /mobile and /app.
 */
export const MOBILE_ROUTE_MARKER = 'pathname === "/mobile" || pathname === "/mobile/"';

export const MOBILE_ROUTE_SNIPPET = `    if ((pathname === "/mobile" || pathname === "/mobile/" || pathname === "/app" || pathname === "/app/") && req.method === "GET") {
      try {
        const buf = fs.readFileSync(path.join(__dirname, "public", "mobile", "index.html"));
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0",
        });
        return res.end(buf);
      } catch (e) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("mobile app not found");
      }
    }
    if (pathname.startsWith("/mobile/") && req.method === "GET") {
      try {
        const rel = pathname.replace(/^\\/mobile\\//, "");
        const safe = path.normalize(rel).replace(/^(\\.\\.[/\\\\])+/, "");
        const file = path.join(__dirname, "public", "mobile", safe);
        if (!file.startsWith(path.join(__dirname, "public", "mobile"))) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          return res.end("forbidden");
        }
        const buf = fs.readFileSync(file);
        const ext = path.extname(file).toLowerCase();
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".webmanifest": "application/manifest+json; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
        };
        res.writeHead(200, {
          "Content-Type": types[ext] || "application/octet-stream",
          "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300",
        });
        return res.end(buf);
      } catch (e) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("not found");
      }
    }
`;

export function patchMobileAppRoutes(src) {
  let out = String(src || "");
  if (out.includes(MOBILE_ROUTE_MARKER)) return { src: out, changed: false };

  const anchors = [
    'if (pathname === "/sales-history" && req.method === "GET")',
    'if (pathname === "/apply" && req.method === "GET")',
  ];
  for (const anchor of anchors) {
    const idx = out.indexOf(anchor);
    if (idx >= 0) {
      out = out.slice(0, idx) + MOBILE_ROUTE_SNIPPET + "\n    " + out.slice(idx);
      return { src: out, changed: true };
    }
  }
  return { src: out, changed: false, missing: "anchor" };
}
