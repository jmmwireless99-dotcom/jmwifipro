/**
 * Patch / verify Sales History API routes in server.js
 * GET/POST/PUT/DELETE /api/sales-history with month lock on mutate.
 */
import { isSalesMonthEditable, salesMonthLockReason } from "./sales-history-lock.mjs";

export const API_MARKER = 'pathname === "/api/sales-history"';
export const PUT_MARKER = 'pathname === "/api/sales-history" && req.method === "PUT"';
export const DELETE_MARKER = 'pathname === "/api/sales-history" && req.method === "DELETE"';

/** Full API block (for fresh insert). */
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
        if (!entry.month && entry.date) entry.month = entry.date.slice(0, 7);
        const lockMsg = salesMonthLockServer(entry.month);
        if (lockMsg) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: lockMsg }));
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

/** PUT + DELETE block to append after existing POST. */
export const MUTATE_SNIPPET = `    if (pathname === "/api/sales-history" && req.method === "PUT") {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const id = String(body.id || "").trim();
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: "id required" }));
        }
        const file = path.join(__dirname, "data", "sales-history.json");
        let entries = [];
        if (fs.existsSync(file)) {
          const raw = JSON.parse(fs.readFileSync(file, "utf8"));
          entries = Array.isArray(raw) ? raw : (raw.entries || []);
        }
        const idx = entries.findIndex((e) => String(e.id) === id);
        if (idx < 0) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: "entry not found" }));
        }
        const prev = entries[idx];
        const nextMonth = String(body.month != null ? body.month : prev.month || "").trim();
        const nextDate = String(body.date != null ? body.date : prev.date || "").trim();
        const month = nextMonth || (nextDate ? nextDate.slice(0, 7) : "");
        const lockOld = salesMonthLockServer(prev.month || (prev.date || "").slice(0, 7));
        if (lockOld) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: lockOld }));
        }
        const lockNew = salesMonthLockServer(month);
        if (lockNew) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: lockNew }));
        }
        const entry = {
          ...prev,
          municipality: String(body.municipality != null ? body.municipality : prev.municipality || "").toUpperCase().trim(),
          barangay: String(body.barangay != null ? body.barangay : prev.barangay || "").toUpperCase().trim(),
          vendo: String(body.vendo != null ? body.vendo : prev.vendo || "").trim(),
          month,
          date: nextDate || (month ? month + "-01" : ""),
          amount: body.amount != null ? Number(body.amount) || 0 : Number(prev.amount) || 0,
          updatedAt: new Date().toISOString(),
        };
        if (!entry.municipality || !entry.barangay || !entry.vendo) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: "municipality, barangay, and vendo are required" }));
        }
        entries[idx] = entry;
        fs.writeFileSync(file, JSON.stringify({ entries }, null, 2));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: true, entry }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    }
    if (pathname === "/api/sales-history" && req.method === "DELETE") {
      try {
        const u = new URL(req.url, "http://localhost");
        const id = String(u.searchParams.get("id") || "").trim();
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: "id required" }));
        }
        const file = path.join(__dirname, "data", "sales-history.json");
        let entries = [];
        if (fs.existsSync(file)) {
          const raw = JSON.parse(fs.readFileSync(file, "utf8"));
          entries = Array.isArray(raw) ? raw : (raw.entries || []);
        }
        const idx = entries.findIndex((e) => String(e.id) === id);
        if (idx < 0) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: "entry not found" }));
        }
        const prev = entries[idx];
        const lockMsg = salesMonthLockServer(prev.month || (prev.date || "").slice(0, 7));
        if (lockMsg) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: lockMsg }));
        }
        entries.splice(idx, 1);
        fs.writeFileSync(file, JSON.stringify({ entries }, null, 2));
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: true, removed: id }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    }
`;

/** Helper source injected into server.js (no ESM import). */
export const LOCK_HELPER_JS = `
function salesMonthLockServer(saleMonth) {
  const s = String(saleMonth || "").trim();
  const m = s.match(/^(\\d{4})-(\\d{2})$/);
  if (!m) return "Invalid sales month.";
  const saleY = Number(m[1]), saleM = Number(m[2]);
  if (!saleY || saleM < 1 || saleM > 12) return "Invalid sales month.";
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  const saleIdx = saleY * 12 + (saleM - 1);
  const curIdx = curY * 12 + (curM - 1);
  if (curIdx >= saleIdx && curIdx <= saleIdx + 1) return "";
  const graceY = Math.floor((saleIdx + 1) / 12);
  const graceM = ((saleIdx + 1) % 12) + 1;
  const lockY = Math.floor((saleIdx + 2) / 12);
  const lockM = ((saleIdx + 2) % 12) + 1;
  const pad = (n) => String(n).padStart(2, "0");
  return "Locked — " + s + " sales can only be edited/deleted until end of " + graceY + "-" + pad(graceM) + ". Locked since " + lockY + "-" + pad(lockM) + "-01.";
}
`;

export function patchSalesHistoryApi(src) {
  let out = String(src || "");
  let changed = false;

  if (!out.includes("function salesMonthLockServer(")) {
    // Insert helper near top of requestHandler or before first sales-history route
    const anchor = 'if (pathname === "/api/sales-history"';
    const idx = out.indexOf(anchor);
    if (idx >= 0) {
      out = out.slice(0, idx) + LOCK_HELPER_JS + "\n    " + out.slice(idx);
      changed = true;
    } else {
      const pageAnchor = 'if (pathname === "/sales-history" && req.method === "GET")';
      const pidx = out.indexOf(pageAnchor);
      if (pidx >= 0) {
        out = out.slice(0, pidx) + LOCK_HELPER_JS + "\n    " + out.slice(pidx);
        changed = true;
      }
    }
  }

  if (!out.includes(API_MARKER)) {
    const pageAnchor = 'if (pathname === "/sales-history" && req.method === "GET")';
    const idx = out.indexOf(pageAnchor);
    if (idx >= 0) {
      out = out.slice(0, idx) + API_SNIPPET + "\n" + MUTATE_SNIPPET + "\n    " + out.slice(idx);
      return { src: out, changed: true };
    }
    const applyAnchor = 'if (pathname === "/apply" && req.method === "GET")';
    const aidx = out.indexOf(applyAnchor);
    if (aidx < 0) return { src: out, changed: false, missing: "anchor" };
    out = out.slice(0, aidx) + API_SNIPPET + "\n" + MUTATE_SNIPPET + "\n    " + out.slice(aidx);
    return { src: out, changed: true };
  }

  // Already has GET/POST — add PUT/DELETE if missing
  if (!out.includes(PUT_MARKER)) {
    // Insert after POST block: find POST marker, then find closing of that if by locating next "if (pathname"
    const post = 'if (pathname === "/api/sales-history" && req.method === "POST")';
    const pidx = out.indexOf(post);
    if (pidx < 0) return { src: out, changed, missing: "post-route" };
    // Find end of POST if-block: look for "\n    if (pathname" after pidx+post.length
    const after = out.indexOf("\n    if (pathname", pidx + post.length);
    if (after < 0) return { src: out, changed, missing: "post-end" };
    out = out.slice(0, after + 1) + MUTATE_SNIPPET + "\n" + out.slice(after + 1);
    changed = true;
  }

  // Patch POST to enforce lock if not already
  if (out.includes(API_MARKER) && !out.includes("salesMonthLockServer(entry.month)")) {
    const needle = `        if (!entry.municipality || !entry.barangay || !entry.vendo) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: "municipality, barangay, and vendo are required" }));
        }
        const dir = path.join(__dirname, "data");`;
    const repl = `        if (!entry.municipality || !entry.barangay || !entry.vendo) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: "municipality, barangay, and vendo are required" }));
        }
        if (!entry.month && entry.date) entry.month = entry.date.slice(0, 7);
        const lockMsg = salesMonthLockServer(entry.month);
        if (lockMsg) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: lockMsg }));
        }
        const dir = path.join(__dirname, "data");`;
    if (out.includes(needle)) {
      out = out.replace(needle, repl);
      changed = true;
    }
  }

  return { src: out, changed };
}

// Re-export for tests
export { isSalesMonthEditable, salesMonthLockReason };
