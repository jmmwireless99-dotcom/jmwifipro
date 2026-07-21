/* KiTifi portal — auto-enter voucher after GCash buy (?voucher=VC123&autoconnect=1). */
(function (global) {
  var STORE = "kitifi_pending_voucher";
  var TRIED = "kitifi_autoconnect_tried";

  function qsVoucher() {
    try {
      var qs = new URLSearchParams(global.location.search);
      var v = qs.get("voucher") || qs.get("code") || qs.get("username") || "";
      if (!v) {
        try { v = sessionStorage.getItem(STORE) || ""; } catch (e) {}
      }
      return String(v || "").trim().toUpperCase();
    } catch (e) {
      return "";
    }
  }

  function wantsAuto() {
    try {
      var qs = new URLSearchParams(global.location.search);
      if (qs.get("autoconnect") === "1") return true;
      if (qs.get("paid") === "1" && qsVoucher()) return true;
    } catch (e) {}
    return false;
  }

  function kitifiPortalLogin(code) {
    var input = global.document.getElementById("v_code");
    var btn = global.document.getElementById("submit");
    if (!input || !btn) return false;
    try { sessionStorage.setItem(STORE, code); } catch (e) {}
    input.value = code;
    try { sessionStorage.setItem(TRIED, "1"); } catch (e2) {}
    setTimeout(function () {
      try { btn.click(); } catch (e3) {}
    }, 350);
    return true;
  }

  function run() {
    if (sessionStorage.getItem(TRIED)) return;
    if (!wantsAuto()) return;
    var code = qsVoucher();
    if (!code) return;
    if (kitifiPortalLogin(code)) return;
    if (global.JmWifiRoam) {
      global.JmWifiRoam.save(code);
      if (global.JmWifiRoam.tryAutoLoginKitifi && global.JmWifiRoam.tryAutoLoginKitifi()) return;
      var gw = "10.0.0.1";
      if (typeof global.hs_address === "string" && global.hs_address.trim()) {
        gw = global.hs_address.trim().split("/")[0];
      }
      global.JmWifiRoam.autoConnectGateway(code, gw, "", "");
    }
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", run);
  } else {
    setTimeout(run, 200);
  }
  global.document.addEventListener("visibilitychange", function () {
    if (global.document.visibilityState === "visible") run();
  });
})(typeof window !== "undefined" ? window : globalThis);
