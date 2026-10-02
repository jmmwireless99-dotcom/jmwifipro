/**
 * Sales History dedicated login (admin / configured password).
 * Patches server.js with /api/sales-history/login|logout|me and gate on API + pages.
 */

export const AUTH_MARKER = 'pathname === "/api/sales-history/login"';

export const AUTH_HELPER_JS = `
const SALES_HISTORY_AUTH_USER = "admin";
const SALES_HISTORY_AUTH_PASS = "Father@services1985";
const SALES_HISTORY_SESSIONS = new Map();
const SALES_HISTORY_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function salesHistoryParseCookies(req) {
  const out = {};
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(/;\\s*/)) {
    if (!part) continue;
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

function salesHistorySessionOk(req) {
  const cookies = salesHistoryParseCookies(req);
  const sid = cookies.shsid || "";
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
    "shsid=" + encodeURIComponent(sid) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge
  );
}

function salesHistoryClearCookie(res) {
  res.setHeader("Set-Cookie", "shsid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}
`;

export const AUTH_ROUTES_SNIPPET = `    if (pathname === "/api/sales-history/login" && req.method === "POST") {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        if (username !== SALES_HISTORY_AUTH_USER || password !== SALES_HISTORY_AUTH_PASS) {
          res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ ok: false, error: "Invalid username or password." }));
        }
        const sid = require("crypto").randomBytes(24).toString("hex");
        SALES_HISTORY_SESSIONS.set(sid, { user: username, exp: Date.now() + SALES_HISTORY_SESSION_TTL_MS });
        salesHistorySetCookie(res, sid);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: true, user: { username, role: "admin" } }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    }
    if (pathname === "/api/sales-history/logout" && req.method === "POST") {
      const cookies = salesHistoryParseCookies(req);
      if (cookies.shsid) SALES_HISTORY_SESSIONS.delete(cookies.shsid);
      salesHistoryClearCookie(res);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (pathname === "/api/sales-history/me" && req.method === "GET") {
      if (!salesHistorySessionOk(req)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: false, needLogin: true }));
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true, user: { username: SALES_HISTORY_AUTH_USER, role: "admin" } }));
    }
    if (pathname === "/api/sales-history" && !salesHistorySessionOk(req)) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, needLogin: true, error: "Login required" }));
    }
`;

export function patchSalesHistoryAuth(src) {
  let out = String(src || "");
  let changed = false;

  if (!out.includes("function salesHistorySessionOk(")) {
    const anchor = 'if (pathname === "/api/sales-history"';
    const idx = out.indexOf(anchor);
    if (idx >= 0) {
      out = out.slice(0, idx) + AUTH_HELPER_JS + "\n    " + out.slice(idx);
      changed = true;
    } else {
      return { src: out, changed: false, missing: "sales-history-api" };
    }
  }

  if (!out.includes(AUTH_MARKER)) {
    const anchor = 'if (pathname === "/api/sales-history" && req.method === "GET")';
    const idx = out.indexOf(anchor);
    if (idx < 0) return { src: out, changed, missing: "get-route" };
    out = out.slice(0, idx) + AUTH_ROUTES_SNIPPET + "\n    " + out.slice(idx);
    changed = true;
  }

  return { src: out, changed };
}
