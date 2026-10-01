/**
 * Fallback when KiTifi admin login fails: point MikroTik hotspot HTML at the
 * public jmwifi.pro BUY + MikroTik auto-connect portal (same page as Candelaria).
 */
/** Standalone page (no KiTifi Jinja). Safe to serve from jmwifi.pro for hotspot redirects. */
export const PUBLIC_STATUS_PORTAL =
  "https://jmwifi.pro/kitifi/hotspot-buy-portal.html";

export function hotspotRedirectHtml({ rid, site, kind = "status" }) {
  const q =
    "rid=" +
    encodeURIComponent(String(rid)) +
    "&site=" +
    encodeURIComponent(String(site || "")) +
    "&mac=$(mac)&ip=$(ip)&username=$(username)" +
    "&link-login-only=$(link-login-only)&link-orig=$(link-orig)";
  const cors = '$(if http-header == "Access-Control-Allow-Origin")*$(endif)';
  const err = kind === "login" ? "$(if error)$(error)$(endif)" : "";
  const extra = kind === "alogin" ? "&connected=1" : "";
  return (
    cors +
    err +
    "<script>location.replace('" +
    PUBLIC_STATUS_PORTAL +
    "?" +
    q +
    extra +
    "');</script>"
  );
}

export async function pushHotspotPortalRedirect(conn, { rid, site, dirs = ["hotspot", "aban"] }) {
  const files = {
    "status.html": hotspotRedirectHtml({ rid, site, kind: "status" }),
    "login.html": hotspotRedirectHtml({ rid, site, kind: "login" }),
    "alogin.html": hotspotRedirectHtml({ rid, site, kind: "alogin" }),
  };
  const ok = [];
  const fail = [];
  const listing = (await conn.print("/file")) || [];
  for (const dir of dirs) {
    for (const [base, contents] of Object.entries(files)) {
      const name = dir + "/" + base;
      const f = listing.find((x) => String(x.name) === name);
      try {
        if (f?.[".id"]) {
          await conn.talk(["/file/set", "=.id=" + f[".id"], "=contents=" + contents]);
        } else {
          await conn.talk(["/file/add", "=name=" + name, "=contents=" + contents]);
        }
        ok.push(name);
      } catch (e) {
        fail.push({ name, error: String(e.message || e).slice(0, 120) });
      }
    }
  }
  return { ok, fail };
}
