/**
 * Patch server.js to add GET/POST /api/sales-history (JSON file store).
 */
export const API_MARKER = 'pathname === "/api/sales-history"';

export const API_SNIPPET = `    if (pathname === "/api/sales-history" && req.method === "GET") {
      try {
        const file = path.join(__dirname, "data", "sales-history.json");
        let entries = [];
        if (fs.existsSync(file)) {
          const raw = JSON.parse(fs.readFileSync(file, "utf8"));
          entries = Array.isArray(raw) ? raw : (raw.entries || []);
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ ok: true, entries }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    }
    if (pathname === "/api/sales-history" && req.method === "POST") {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const entry = {
          id: String(body.id || ("sh_" + Date.now())),
          municipality: String(body.municipality || "").toUpperCase().trim(),
          barangay: String(body.barangay || "").toUpperCase().trim(),
          vendo: String(body.vendo || "").trim(),
          month: String(body.month || "").trim(),
          date: String(body.date || "").trim(),
          amount: Number(body.amount) || 0,
          createdAt: String(body.createdAt || new Date().toISOString()),
        };
        if (!entry.municipality || !entry.barangay || !entry.vendo) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: "municipality, barangay, and vendo are required" }));
        }
        const dir = path.join(__dirname, "data");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, "sales-history.json");
        let entries = [];
        if (fs.existsSync(file)) {
          const raw = JSON.parse(fs.readFileSync(file, "utf8"));
          entries = Array.isArray(raw) ? raw : (raw.entries || []);
        }
        entries.unshift(entry);
        fs.writeFileSync(file, JSON.stringify({ entries }, null, 2));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: true, entry }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    }
`;

export function patchSalesHistoryApi(src) {
  let out = String(src || "");
  if (out.includes(API_MARKER)) return { src: out, changed: false };

  // Insert only before a full `if (...)` so we never produce `if (if (...)`.
  const pageAnchor = 'if (pathname === "/sales-history" && req.method === "GET")';
  const idx = out.indexOf(pageAnchor);
  if (idx >= 0) {
    out = out.slice(0, idx) + API_SNIPPET + "\n    " + out.slice(idx);
    return { src: out, changed: true };
  }

  const applyAnchor = 'if (pathname === "/apply" && req.method === "GET")';
  const aidx = out.indexOf(applyAnchor);
  if (aidx < 0) return { src: out, changed: false, missing: "anchor" };
  out = out.slice(0, aidx) + API_SNIPPET + "\n    " + out.slice(aidx);
  return { src: out, changed: true };
}
