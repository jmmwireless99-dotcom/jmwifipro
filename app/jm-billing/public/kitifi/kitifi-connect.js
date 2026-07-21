/* Shared GCash → auto WiFi connect for KiTifi buy pages (uses jmwifi-roam when available). */
(function (global) {
  var STORE = "kitifi_pending_voucher";

  function normCode(c) {
    return String(c || "").trim().toUpperCase();
  }

  function saveCode(c) {
    c = normCode(c);
    if (!c) return;
    try { sessionStorage.setItem(STORE, c); } catch (e) {}
    if (global.JmWifiRoam && global.JmWifiRoam.save) global.JmWifiRoam.save(c);
  }

  function ctxFromPage() {
    var qs = new URLSearchParams(global.location.search);
    return {
      gw: (qs.get("gw") || "10.0.0.1").replace(/^https?:\/\//, "").split("/")[0],
      linkLogin: qs.get("link-login") || qs.get("link_login") || "",
      back: qs.get("back") || "",
      returnUrl: qs.get("return") || qs.get("return_url") || "",
      mac: qs.get("mac") || "",
    };
  }

  function portalBack(returnUrl, code, autoconnect) {
    if (!returnUrl) return false;
    code = normCode(code);
    saveCode(code);
    var u = returnUrl;
    try {
      var url = new URL(returnUrl);
      if (code) url.searchParams.set("voucher", code);
      if (autoconnect) url.searchParams.set("autoconnect", "1");
      u = url.toString();
    } catch (e) {
      if (code) {
        u += (returnUrl.indexOf("?") >= 0 ? "&" : "?") + "voucher=" + encodeURIComponent(code);
        if (autoconnect) u += "&autoconnect=1";
      }
    }
    global.location.replace(u);
    return true;
  }

  function loginUrl(loginBase, code) {
    code = normCode(code);
    var base = String(loginBase || "http://10.0.0.1/login").replace(/\/$/, "");
    var q = new URLSearchParams({ username: code, password: code, popup: "true" });
    return base + "?" + q.toString();
  }

  /** After payment — connect phone to WiFi without manual voucher entry. */
  function autoConnectAfterPay(opts) {
    opts = opts || {};
    var code = normCode(opts.voucher || opts.code);
    if (!code) return false;
    saveCode(code);

    var ctx = ctxFromPage();
    var ret = opts.returnUrl || ctx.returnUrl;
    // Prefer portal return (Kitifi #v_code + Submit) when we have a captive portal URL.
    if (ret && portalBack(ret, code, true)) return true;

    if (opts.connect_url) {
      global.location.replace(opts.connect_url);
      return true;
    }

    if (global.JmWifiRoam && global.JmWifiRoam.autoConnectGateway) {
      global.JmWifiRoam.captureHotspotFromPage && global.JmWifiRoam.captureHotspotFromPage();
      global.JmWifiRoam.autoConnectGateway(code, ctx.gw, ctx.back, ctx.linkLogin);
      return true;
    }

    global.location.replace(loginUrl(opts.loginBase || ctx.loginBase, code));
    return true;
  }

  global.KitifiConnect = {
    normCode: normCode,
    saveCode: saveCode,
    ctxFromPage: ctxFromPage,
    portalBack: portalBack,
    loginUrl: loginUrl,
    autoConnectAfterPay: autoConnectAfterPay,
  };
})(typeof window !== "undefined" ? window : globalThis);
