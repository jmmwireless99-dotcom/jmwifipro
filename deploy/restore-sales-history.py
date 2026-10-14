#!/usr/bin/env python3
"""Open the jmwifi.pro sales history on jmestre.tech.

The encoded rows already sit in /opt/jm-allinone/data/sales-history.json
(same file as jmwifi.pro: Jan–Sep 2026, including the hand-encoded amounts).
The page at /sales-history was up, but /api/sales-history was swallowed by the
panel login gate, so the list never loaded.

This inserts the sales-history login and read/write routes before that gate.
The password stays in lib/sales-history-auth.mjs on the server; it is not
copied into this script.
"""
from pathlib import Path

server = Path("/opt/jm-allinone/server.js")
text = server.read_text()

api_ready = "function salesHistorySessionOk(" in text and 'pathname === "/api/sales-history/login"' in text
if api_ready:
    print("sales history API already wired")

if not api_ready:
    import_old = 'import * as License from "./lib/license.js";\n'
    import_new = import_old + 'import { salesMonthLockReason } from "./lib/sales-history-lock.mjs";\n'
    if import_old not in text:
        raise SystemExit("import anchor missing")
    if "sales-history-lock.mjs" not in text:
        text = text.replace(import_old, import_new, 1)
        print("patched import")

helpers = r'''
const SALES_HISTORY_AUTH_USER = "admin";
const SALES_HISTORY_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const SALES_HISTORY_SESSIONS = globalThis.__JM_SH_SESSIONS || (globalThis.__JM_SH_SESSIONS = new Map());

function salesHistoryPass() {
  if (process.env.SALES_HISTORY_PASS) return String(process.env.SALES_HISTORY_PASS);
  try {
    const src = fs.readFileSync(path.join(__dirname, "lib", "sales-history-auth.mjs"), "utf8");
    const m = src.match(/SALES_HISTORY_AUTH_PASS = "([^"]*)"/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

function salesHistoryParseCookies(req) {
  const out = {};
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(/;\s*/)) {
    if (!part) continue;
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

function salesHistorySessionOk(req) {
  const sid = salesHistoryParseCookies(req).shsid || "";
  if (!sid) return false;
  const row = SALES_HISTORY_SESSIONS.get(sid);
  if (!row) return false;
  if (Date.now() > row.exp) {
    SALES_HISTORY_SESSIONS.delete(sid);
    return false;
  }
  return true;
}

function salesHistorySetCookie(res, sid) {
  const maxAge = Math.floor(SALES_HISTORY_SESSION_TTL_MS / 1000);
  res.setHeader(
    "Set-Cookie",
    "shsid=" + encodeURIComponent(sid) + "; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=" + maxAge
  );
}

function salesHistoryClearCookie(res) {
  res.setHeader("Set-Cookie", "shsid=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
}

'''

anchor_fn = "const requestHandler = async (req, res) => {\n"
if "function salesHistorySessionOk(" not in text:
    if anchor_fn not in text:
        raise SystemExit("requestHandler anchor missing")
    text = text.replace(anchor_fn, helpers + anchor_fn, 1)
    print("patched helpers")

routes = r'''    // Sales history (encoded on jmwifi.pro). Own login, before the panel session gate.
    if (pathname === "/api/sales-history/login" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const expect = salesHistoryPass();
        if (!expect || username !== SALES_HISTORY_AUTH_USER || password !== expect) {
          return send(res, 401, { ok: false, error: "Invalid username or password." });
        }
        const sid = crypto.randomBytes(24).toString("hex");
        SALES_HISTORY_SESSIONS.set(sid, { user: username, exp: Date.now() + SALES_HISTORY_SESSION_TTL_MS });
        salesHistorySetCookie(res, sid);
        return send(res, 200, { ok: true, user: { username, role: "admin" } });
      } catch (e) {
        return send(res, 500, { ok: false, error: String(e && e.message || e) });
      }
    }
    if (pathname === "/api/sales-history/logout" && req.method === "POST") {
      const cookiesSh = salesHistoryParseCookies(req);
      if (cookiesSh.shsid) SALES_HISTORY_SESSIONS.delete(cookiesSh.shsid);
      salesHistoryClearCookie(res);
      return send(res, 200, { ok: true });
    }
    if (pathname === "/api/sales-history/me" && req.method === "GET") {
      if (!salesHistorySessionOk(req)) return send(res, 401, { ok: false, needLogin: true });
      return send(res, 200, { ok: true, user: { username: SALES_HISTORY_AUTH_USER, role: "admin" } });
    }
    if (pathname === "/api/sales-history" && !salesHistorySessionOk(req)) {
      return send(res, 401, { ok: false, needLogin: true, error: "Login required" });
    }
    if (pathname === "/api/sales-history" && req.method === "GET") {
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
        return send(res, 500, { ok: false, error: String(e && e.message || e) });
      }
    }
    if (pathname === "/api/sales-history" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
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
        if (body.source) entry.source = String(body.source);
        if (!entry.municipality || !entry.barangay || !entry.vendo) {
          return send(res, 400, { ok: false, error: "municipality, barangay, and vendo are required" });
        }
        if (!entry.month && entry.date) entry.month = entry.date.slice(0, 7);
        const lockMsg = salesMonthLockReason(entry.month);
        if (lockMsg) return send(res, 403, { ok: false, error: lockMsg });
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
        return send(res, 200, { ok: true, entry });
      } catch (e) {
        return send(res, 500, { ok: false, error: String(e && e.message || e) });
      }
    }
    if (pathname === "/api/sales-history" && req.method === "PUT") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        const id = String(body.id || "").trim();
        if (!id) return send(res, 400, { ok: false, error: "id required" });
        const file = path.join(__dirname, "data", "sales-history.json");
        let entries = [];
        if (fs.existsSync(file)) {
          const raw = JSON.parse(fs.readFileSync(file, "utf8"));
          entries = Array.isArray(raw) ? raw : (raw.entries || []);
        }
        const idx = entries.findIndex((e) => String(e.id) === id);
        if (idx < 0) return send(res, 404, { ok: false, error: "entry not found" });
        const prev = entries[idx];
        const nextMonth = String(body.month != null ? body.month : prev.month || "").trim();
        const nextDate = String(body.date != null ? body.date : prev.date || "").trim();
        const month = nextMonth || (nextDate ? nextDate.slice(0, 7) : "");
        const lockOld = salesMonthLockReason(prev.month || (prev.date || "").slice(0, 7));
        if (lockOld) return send(res, 403, { ok: false, error: lockOld });
        const lockNew = salesMonthLockReason(month);
        if (lockNew) return send(res, 403, { ok: false, error: lockNew });
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
          return send(res, 400, { ok: false, error: "municipality, barangay, and vendo are required" });
        }
        entries[idx] = entry;
        fs.writeFileSync(file, JSON.stringify({ entries }, null, 2));
        return send(res, 200, { ok: true, entry });
      } catch (e) {
        return send(res, 500, { ok: false, error: String(e && e.message || e) });
      }
    }
    if (pathname === "/api/sales-history" && req.method === "DELETE") {
      try {
        const id = String(new URL(req.url, "http://localhost").searchParams.get("id") || "").trim();
        if (!id) return send(res, 400, { ok: false, error: "id required" });
        const file = path.join(__dirname, "data", "sales-history.json");
        let entries = [];
        if (fs.existsSync(file)) {
          const raw = JSON.parse(fs.readFileSync(file, "utf8"));
          entries = Array.isArray(raw) ? raw : (raw.entries || []);
        }
        const idx = entries.findIndex((e) => String(e.id) === id);
        if (idx < 0) return send(res, 404, { ok: false, error: "entry not found" });
        const prev = entries[idx];
        const lockMsg = salesMonthLockReason(prev.month || (prev.date || "").slice(0, 7));
        if (lockMsg) return send(res, 403, { ok: false, error: lockMsg });
        entries.splice(idx, 1);
        fs.writeFileSync(file, JSON.stringify({ entries }, null, 2));
        return send(res, 200, { ok: true, removed: id });
      } catch (e) {
        return send(res, 500, { ok: false, error: String(e && e.message || e) });
      }
    }

'''

gate = '''    // ---- Gate: every other /api route requires a valid session ----
'''
if 'pathname === "/api/sales-history/login"' not in text:
    if gate not in text:
        raise SystemExit("gate anchor missing")
    text = text.replace(gate, routes + gate, 1)
    print("patched routes")

# The page is a module. These two files must load or the login form never runs.
# Do not serve the rest of lib/ — sales-history-auth.mjs holds the password.
lib_route = '''    if (req.method === "GET" && (pathname === "/lib/apply-coverage.mjs" || pathname === "/lib/sales-history-lock.mjs")) {
      const name = path.basename(pathname);
      try {
        const buf = fs.readFileSync(path.join(__dirname, "lib", name));
        res.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(buf);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("not found");
      }
    }
'''
page_anchor = '''    if (req.method === "GET" && (pathname === "/sales-history" || pathname === "/sales-history.html")) {
      return servePublicFile(res, "sales-history.html", { maxAge: 0 });
    }
'''
if 'pathname === "/lib/apply-coverage.mjs"' not in text:
    if page_anchor not in text:
        raise SystemExit("sales-history page anchor missing")
    text = text.replace(page_anchor, page_anchor + lib_route, 1)
    print("patched sales history module files")

server.write_text(text)
print("wrote", server)
