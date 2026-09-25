/**
 * Patch server.js + auth.js + site-scope.js for PANISIJAN free WiFi admin role.
 * Usage: cd /opt/jm-billing && node deploy/patch-panisijan-free-wifi-admin.mjs && systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function patchFile(filePath, fn, label) {
  if (!fs.existsSync(filePath)) {
    console.log("  skip", label, "— file missing");
    return false;
  }
  let src = fs.readFileSync(filePath, "utf8");
  const out = fn(src);
  if (out === src) {
    console.log("  already patched:", label);
    return false;
  }
  fs.copyFileSync(filePath, filePath + ".bak-panisijan-admin-" + Date.now());
  fs.writeFileSync(filePath, out);
  console.log("  patched:", label);
  return true;
}

// auth.js — add role
patchFile(path.join(ROOT, "lib", "auth.js"), (src) => {
  const needle = 'export const ROLES = ["admin", "site_admin", "cashier", "technician", "staff", "helper", "agent"];';
  if (src.includes("panisijan_free_admin")) return src;
  if (!src.includes(needle)) throw new Error("ROLES line not found in auth.js");
  return src.replace(needle, 'export const ROLES = ["admin", "site_admin", "panisijan_free_admin", "cashier", "technician", "staff", "helper", "agent"];');
}, "lib/auth.js");

// site-scope.js — payload for panisijan admin
patchFile(path.join(ROOT, "lib", "site-scope.js"), (src) => {
  if (src.includes("panisijan_free_admin")) return src;
  const importNeedle = 'import { Accounts, Routers, Customers, Payments, summary, kpis } from "./db.js";';
  if (!src.includes(importNeedle)) throw new Error("site-scope import not found");
  src = src.replace(
    importNeedle,
    importNeedle + '\nimport { PANISIJAN_FREE_ADMIN_ROLE, PANISIJAN_ROUTER_ID, panisijanFreeAdminPayload } from "./panisijan-free-admin.js";'
  );
  const fnNeedle = "export function userPublicPayload(user) {";
  if (!src.includes(fnNeedle)) throw new Error("userPublicPayload not found");
  src = src.replace(
    fnNeedle,
    `export function userPublicPayload(user) {
  if (user?.role === PANISIJAN_FREE_ADMIN_ROLE) return panisijanFreeAdminPayload(user);`
  );
  return src;
}, "lib/site-scope.js");

// server.js — routes + gate
patchFile(path.join(ROOT, "server.js"), (src) => {
  if (src.includes("/api/panisijan/free-admin/me")) return src;

  if (!src.includes('from "./lib/panisijan-free-admin.js"')) {
    const kitifiImport = /import \{[^}]+\} from "\.\/lib\/kitifi-server\.js";/;
    if (!kitifiImport.test(src)) throw new Error("kitifi-server import not found");
    src = src.replace(
      kitifiImport,
      (m) =>
        m +
        '\nimport { isPanisijanFreeAdmin, PANISIJAN_ROUTER_ID } from "./lib/panisijan-free-admin.js";'
    );
  }
  // Reuse imported PANISIJAN_ROUTER_ID (remove duplicate from panisijanVoucherProfile helper)
  src = src.replace(/\nconst PANISIJAN_ROUTER_ID = 51;\n/g, "\n");

  const freeInternetRoute = 'if (pathname === "/kitifi/free-internet" && req.method === "GET") {';
  const adminPageRoute = `
    if ((pathname === "/panisijan/admin" || pathname === "/panisijan/free-wifi-admin") && req.method === "GET") {
      try {
        const buf = fs.readFileSync(path.join(__dirname, "public", "panisijan", "free-wifi-admin.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(buf);
      } catch (e) {
        return send(res, 404, { ok: false, error: "PANISIJAN admin page missing." });
      }
    }

`;
  if (src.includes(freeInternetRoute) && !src.includes("/panisijan/admin")) {
    src = src.replace(freeInternetRoute, adminPageRoute + freeInternetRoute);
  }

  const gateNeedle = "    // ---- Gate: every other /api route requires a valid session ----";
  const panisijanBlock = `
    // PANISIJAN free WiFi admin — clients list only (router 51)
    if (pathname.startsWith("/api/panisijan/free-admin")) {
      if (!user || !isPanisijanFreeAdmin(user)) {
        return send(res, 403, { ok: false, error: "PANISIJAN Free WiFi admin login required." });
      }
      const q = new URL(req.url, "http://localhost").searchParams;
      if (pathname === "/api/panisijan/free-admin/me" && req.method === "GET") {
        return send(res, 200, { ok: true, user: SiteScope.userPublicPayload(user) });
      }
      if (pathname === "/api/panisijan/free-admin/clients" && req.method === "GET") {
        return send(res, 200, {
          ok: true,
          data: {
            clients: KitifiFreeClients.list({ q: q.get("q") || "", routerId: PANISIJAN_ROUTER_ID }),
            stats: KitifiFreeClients.stats(PANISIJAN_ROUTER_ID),
            settings: KitifiFreeClients.settings(PANISIJAN_ROUTER_ID),
          },
        });
      }
      const cm = pathname.match(/^\\/api\\/panisijan\\/free-admin\\/clients\\/(\\d+)$/);
      if (cm && req.method === "PATCH") {
        const b = JSON.parse((await readBody(req)) || "{}");
        const row = KitifiFreeClients.byId(Number(cm[1]));
        if (!row || Number(row.router_id) !== PANISIJAN_ROUTER_ID) {
          return send(res, 404, { ok: false, error: "Client not found." });
        }
        const updated = KitifiFreeClients.setStatus(Number(cm[1]), b.status || "active");
        Audit.add({ type: "manual", action: "panisijan-free-client", detail: user.username + " · id " + updated.id + " → " + updated.status, ok: true });
        return send(res, 200, { ok: true, client: updated });
      }
      return send(res, 404, { ok: false, error: "Not found." });
    }
    if (user && isPanisijanFreeAdmin(user) && pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/") && !pathname.startsWith("/api/panisijan/free-admin")) {
      return send(res, 403, { ok: false, error: "PANISIJAN admin can only access the Free WiFi client list." });
    }

`;
  if (!src.includes("/api/panisijan/free-admin/me")) {
    src = src.replace(gateNeedle, panisijanBlock + gateNeedle);
  }

  return src;
}, "server.js");

console.log("\nDone. Restart: systemctl restart jm-billing");
console.log("Admin URL: https://jmwifi.pro/panisijan/admin");
console.log("Create account: node deploy/create-panisijan-free-admin.mjs");
