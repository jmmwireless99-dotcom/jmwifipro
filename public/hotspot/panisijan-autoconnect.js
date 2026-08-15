/** PANISIJAN MikroTik login — auto-connect when returning with voucher from GCash buy. */
(function () {
  var qs = new URLSearchParams(location.search);
  var code = (qs.get("voucher") || qs.get("username") || "").trim();
  if (!code) {
    try { code = (sessionStorage.getItem("kitifi_pending_voucher") || "").trim(); } catch (e) {}
  }
  if (!code) return;
  var auto = qs.get("autoconnect") === "1" || qs.get("autoconnect") === "true";
  var pass = (qs.get("password") || code).trim();
  if (!auto && !qs.get("password")) {
    try { if (sessionStorage.getItem("kitifi_pending_voucher")) auto = true; } catch (e) {}
  }
  if (!auto && !qs.get("password")) return;
  try { sessionStorage.removeItem("kitifi_pending_voucher"); } catch (e) {}
  try { sessionStorage.removeItem("panisijan_portal_music"); } catch (e) {}
  if (window.PanisijanMusic && PanisijanMusic.stop) PanisijanMusic.stop();
  var dst = qs.get("dst") || qs.get("link-orig") || "";
  var u = "/login?username=" + encodeURIComponent(code) + "&password=" + encodeURIComponent(pass);
  if (dst) u += "&dst=" + encodeURIComponent(dst);
  location.replace(u);
})();
