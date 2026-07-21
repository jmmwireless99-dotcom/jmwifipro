/* JM WIFI — roam + global time pool (remaining follows you across all sites). */
(function (global) {
  var KEY = "jmwifi_cloud_voucher";
  var TRY_KEY = "jmwifi_auto_tried";
  var POLL_KEY = "jmwifi_remain_poll";
  var PENDING_PI_KEY = "jmwifi_pending_pi";
  var PENDING_GW_KEY = "jmwifi_pending_gw";
  var PENDING_AT_KEY = "jmwifi_pending_at";
  var PAY_POLL_KEY = "jmwifi_pay_poll";
  var HOTSPOT_CTX_KEY = "jmwifi_hotspot_ctx";
  var API = "https://jmwifi.pro/api/voucher/remaining";
  var RESULT_API = "/api/voucher/result";

  function saveHotspotContext(ctx) {
    if (!ctx) return;
    try {
      var prev = getHotspotContext() || {};
      localStorage.setItem(HOTSPOT_CTX_KEY, JSON.stringify({
        gw: String(ctx.gw || prev.gw || "").replace(/^https?:\/\//, "").split("/")[0],
        linkLogin: String(ctx.linkLogin || ctx.link_login || prev.linkLogin || ""),
        back: String(ctx.back || prev.back || ""),
        savedAt: Date.now(),
      }));
    } catch (e) {}
  }

  function getHotspotContext() {
    try {
      var raw = localStorage.getItem(HOTSPOT_CTX_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.savedAt || Date.now() - Number(o.savedAt) > 60 * 60 * 1000) return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  function resolveConnectCtx(gw, dst, linkLogin) {
    var ctx = getHotspotContext() || {};
    return {
      gw: String(gw || ctx.gw || "10.0.0.1").replace(/^https?:\/\//, "").split("/")[0],
      linkLogin: String(linkLogin || ctx.linkLogin || ""),
      back: String(dst || ctx.back || ""),
    };
  }

  function loginActionUrl(ctx) {
    ctx = ctx || {};
    var ll = String(ctx.linkLogin || "").trim();
    if (ll && ll.indexOf("$(") !== 0) {
      if (/^https?:\/\//i.test(ll)) return ll;
      return "http://" + (ctx.gw || "10.0.0.1") + (ll.charAt(0) === "/" ? ll : "/" + ll);
    }
    return "http://" + (ctx.gw || "10.0.0.1") + "/login";
  }

  function save(code) {
    code = String(code || "").trim();
    if (!code) return;
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          code: code,
          password: code,
          savedAt: Date.now(),
        })
      );
    } catch (e) {}
    startRemainingPoll();
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.code) return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {}
    stopRemainingPoll();
  }

  function formatSecs(secs) {
    secs = Math.max(0, parseInt(secs, 10) || 0);
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var s = secs % 60;
    if (h) return h + "h " + String(m).padStart(2, "0") + "m";
    if (m) return m + "m " + String(s).padStart(2, "0") + "s";
    return s + "s";
  }

  function renderRemaining(data) {
    if (!data || !data.ok) return;
    var label = data.remaining_label || formatSecs(data.remaining_seconds);
    var remain = document.getElementById("remainTime");
    if (remain) {
      remain.textContent = label;
      remain.setAttribute("data-session-time-left", String(data.remaining_seconds || 0));
    }
    var cloud = document.getElementById("jmwifi-cloud-remaining");
    if (cloud) {
      if (data.exhausted || data.remaining_seconds <= 0) {
        cloud.textContent = "☁️ Voucher time used up";
      } else if (data.paused || (!data.connected && data.remaining_seconds > 0)) {
        cloud.textContent = "⏸ Paused — " + label + " left (resumes when you reconnect)";
        cloud.setAttribute("data-force-show", "1");
      } else if (data.connected) {
        cloud.textContent = "☁️ Connected — " + label + " left (all sites)";
        cloud.removeAttribute("data-force-show");
      } else {
        cloud.textContent = "☁️ Cloud time left (all sites): " + label;
        cloud.removeAttribute("data-force-show");
      }
      cloud.style.display = "block";
    }
    var badge = document.getElementById("jmwifi-remain-badge");
    if (badge) {
      var prefix = data.paused ? "⏸ Paused · " : (data.connected ? "▶ " : "⏱ ");
      badge.textContent = prefix + label + " left on all JM WIFI sites";
      badge.style.display = "block";
    }
    if (data.exhausted) clear();
  }

  function fetchRemaining() {
    var v = load();
    if (!v || !v.code) return;
    fetch(API + "?code=" + encodeURIComponent(v.code), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(renderRemaining)
      .catch(function () {});
  }

  function startRemainingPoll() {
    if (global[POLL_KEY]) return;
    fetchRemaining();
    global[POLL_KEY] = setInterval(fetchRemaining, 15000);
  }

  function stopRemainingPoll() {
    if (global[POLL_KEY]) {
      clearInterval(global[POLL_KEY]);
      global[POLL_KEY] = null;
    }
  }

  function syncFromQuery() {
    var qs = new URLSearchParams(global.location.search);
    var code =
      qs.get("jmwifi_code") || qs.get("username") || qs.get("voucher") || qs.get("code");
    if (code) save(String(code).trim());
  }

  function hasLoginError() {
    var err = document.querySelector(".err");
    if (err && err.textContent && err.textContent.trim()) return true;
    return /\$\(error\)/.test(document.body.innerHTML);
  }

  function gatewayLoginUrl(code, gw, dst, linkLogin) {
    code = String(code || "").trim();
    var ctx = resolveConnectCtx(gw, dst, linkLogin);
    var ll = ctx.linkLogin;
    if (ll && ll.indexOf("$(") !== 0) {
      try {
        var base = /^https?:\/\//i.test(ll) ? ll : ("http://" + ctx.gw + (ll.charAt(0) === "/" ? ll : "/" + ll));
        var u = new URL(base);
        u.searchParams.set("username", code);
        u.searchParams.set("password", code);
        u.searchParams.set("popup", "true");
        if (ctx.back) u.searchParams.set("dst", ctx.back);
        return u.toString();
      } catch (e) {}
    }
    var q = new URLSearchParams();
    q.set("username", code);
    q.set("password", code);
    q.set("popup", "true");
    if (ctx.back) q.set("dst", ctx.back);
    return "http://" + ctx.gw + "/login?" + q.toString();
  }

  function goGatewayLogin(code, gw, dst, linkLogin) {
    save(code);
    var ctx = resolveConnectCtx(gw, dst, linkLogin);
    saveHotspotContext(ctx);
    global.location.assign(gatewayLoginUrl(code, ctx.gw, ctx.back, ctx.linkLogin));
    return true;
  }

  /** Hidden iframe POST — starts hotspot login without waiting for user tap. */
  function silentGatewayLogin(code, gw, dst, linkLogin) {
    save(code);
    var ctx = resolveConnectCtx(gw, dst, linkLogin);
    saveHotspotContext(ctx);
    var action = loginActionUrl(ctx);
    var frameName = "jmwifi_hlogin_" + Date.now();
    var iframe = global.document.createElement("iframe");
    iframe.name = frameName;
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none";
    global.document.body.appendChild(iframe);
    var form = global.document.createElement("form");
    form.method = "POST";
    form.action = action;
    form.target = frameName;
    form.style.display = "none";
    function field(name, val) {
      var inp = global.document.createElement("input");
      inp.type = "hidden";
      inp.name = name;
      inp.value = val;
      form.appendChild(inp);
    }
    field("username", code);
    field("password", code);
    field("popup", "true");
    if (ctx.back) field("dst", ctx.back);
    global.document.body.appendChild(form);
    try { form.submit(); } catch (e) {}
    setTimeout(function () {
      try { form.remove(); iframe.remove(); } catch (e2) {}
    }, 10000);
    return true;
  }

  /** Silent iframe login + main-window redirect (best for GCash auto-connect on JM WIFI). */
  function autoConnectGateway(code, gw, dst, linkLogin) {
    code = String(code || "").trim();
    if (!code) return false;
    var ctx = resolveConnectCtx(gw, dst, linkLogin);
    saveHotspotContext(ctx);
    save(code);
    silentGatewayLogin(code, ctx.gw, ctx.back, ctx.linkLogin);
    setTimeout(function () {
      goGatewayLogin(code, ctx.gw, ctx.back, ctx.linkLogin);
    }, 300);
    return true;
  }

  function savePendingPayment(pi, gw, linkLogin, back) {
    if (!pi) return;
    var ctx = resolveConnectCtx(gw, back, linkLogin);
    saveHotspotContext(ctx);
    try {
      localStorage.setItem(PENDING_PI_KEY, String(pi));
      localStorage.setItem(PENDING_GW_KEY, ctx.gw);
      localStorage.setItem(PENDING_AT_KEY, String(Date.now()));
    } catch (e) {}
  }

  function clearPendingPayment() {
    try {
      localStorage.removeItem(PENDING_PI_KEY);
      localStorage.removeItem(PENDING_GW_KEY);
      localStorage.removeItem(PENDING_AT_KEY);
    } catch (e) {}
  }

  function getPendingPayment() {
    try {
      var pi = localStorage.getItem(PENDING_PI_KEY);
      if (!pi) return null;
      var at = Number(localStorage.getItem(PENDING_AT_KEY) || 0);
      if (at && Date.now() - at > 30 * 60 * 1000) {
        clearPendingPayment();
        return null;
      }
      return { pi: pi, gw: localStorage.getItem(PENDING_GW_KEY) || "10.0.0.1", ctx: getHotspotContext() };
    } catch (e) {
      return null;
    }
  }

  function stopPaymentPoll() {
    if (global[PAY_POLL_KEY]) {
      clearInterval(global[PAY_POLL_KEY]);
      global[PAY_POLL_KEY] = null;
    }
  }

  /** Poll PayMongo until voucher is issued, then auto-connect to hotspot gateway. */
  function watchVoucherPayment(pi, gw, onPaid, linkLogin, back) {
    stopPaymentPoll();
    if (!pi) return;
    var ctx = resolveConnectCtx(gw, back, linkLogin);
    savePendingPayment(pi, ctx.gw, ctx.linkLogin, ctx.back);
    var tries = 0;
    function tick() {
      tries++;
      fetch(RESULT_API + "?pi=" + encodeURIComponent(pi), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok && d.paid && d.code) {
            stopPaymentPoll();
            clearPendingPayment();
            save(d.code);
            if (typeof onPaid === "function") onPaid(d.code, ctx.gw, ctx.linkLogin, ctx.back);
            else autoConnectGateway(d.code, ctx.gw, ctx.back, ctx.linkLogin);
            return;
          }
          if (tries > 120) stopPaymentPoll();
        })
        .catch(function () {});
    }
    tick();
    global[PAY_POLL_KEY] = setInterval(tick, 2000);
  }

  function resumePendingPayment(onPaid) {
    var pending = getPendingPayment();
    if (!pending) return false;
    var ctx = pending.ctx || getHotspotContext() || { gw: pending.gw };
    watchVoucherPayment(pending.pi, ctx.gw, onPaid, ctx.linkLogin, ctx.back);
    return true;
  }

  function captureHotspotFromPage() {
    try {
      var qs = new URLSearchParams(global.location.search);
      var gw = qs.get("gw") || "";
      var linkLogin = qs.get("link-login") || qs.get("link_login") || qs.get("login") || "";
      var back = qs.get("back") || "";
      if (gw || linkLogin || back) saveHotspotContext({ gw: gw, linkLogin: linkLogin, back: back });
    } catch (e) {}
  }

  /** URL for captive portal → GCash voucher shop (Kitifi / MikroTik). */
  function buildVoucherShopUrl(base, ctx) {
    base = String(base || "https://jmwifi.pro/voucher").replace(/\/$/, "");
    ctx = ctx || getHotspotContext() || {};
    var qs = new URLSearchParams(global.location.search);
    var gw = ctx.gw || qs.get("gw") || global.location.hostname || "";
    var linkLogin = ctx.linkLogin || qs.get("link-login") || qs.get("link_login") || "";
    var back = ctx.back || qs.get("back") || "";
    var params = new URLSearchParams();
    if (gw) params.set("gw", String(gw).replace(/^https?:\/\//, "").split("/")[0]);
    if (linkLogin) params.set("link-login", linkLogin);
    if (back) params.set("back", back);
    params.set("from", "hotspot");
    var q = params.toString();
    return q ? base + "?" + q : base;
  }

  function goVoucherShop(base) {
    captureHotspotFromPage();
    global.location.href = buildVoucherShopUrl(base || "https://jmwifi.pro/voucher");
    return true;
  }

  function tryAutoLoginMikrotik(opts) {
    opts = opts || {};
    if (sessionStorage.getItem(TRY_KEY)) return false;
    if (!opts.force && hasLoginError()) return false;
    var v = load();
    if (!v || !v.code) return false;
    fetch(API + "?code=" + encodeURIComponent(v.code))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok || data.exhausted || data.remaining_seconds <= 0) {
          clear();
          return;
        }
        var u =
          opts.userField ||
          document.getElementById("u") ||
          document.querySelector('input[name="username"]');
        var p =
          opts.passField ||
          document.getElementById("p") ||
          document.querySelector('input[name="password"]');
        var f =
          opts.form ||
          document.forms.login ||
          document.querySelector('form[name="login"]');
        if (!u || !p || !f) return;
        if (!opts.force && u.value && String(u.value).trim()) return;
        sessionStorage.setItem(TRY_KEY, "1");
        u.value = v.code;
        p.value = v.password || v.code;
        var note = document.getElementById("jmwifi-roam-note");
        if (note) note.style.display = "block";
        setTimeout(function () {
          var dstInp = f.querySelector('input[name="dst"]');
          var dst = dstInp && dstInp.value ? dstInp.value : "";
          var host = global.location.hostname || "10.0.0.10";
          goGatewayLogin(v.code, host, dst);
        }, opts.delay || 350);
      })
      .catch(function () {});
    return true;
  }

  function kitifiConnected() {
    var cloud = document.getElementById("jmwifi-cloud-remaining");
    if (cloud && cloud.getAttribute("data-force-show") === "1") return false;
    var remain = document.getElementById("remainTime");
    var left = remain && parseInt(remain.getAttribute("data-session-time-left") || "0", 10);
    if (left > 90 && !load()) return true;
    if (typeof global.int_status !== "undefined" && global.int_status === 2 && !load()) return true;
    return false;
  }

  function kitifiCloudLogin(code) {
    var gw = "10.0.0.10";
    if (typeof global.hs_address === "string" && global.hs_address.trim()) {
      gw = global.hs_address.trim().split("/")[0];
    }
    return goGatewayLogin(code, gw, "");
  }

  function wireKitifiCloudSubmit() {
    var btn = document.getElementById("submit");
    var input = document.getElementById("v_code");
    if (!btn || !input) return;
    btn.addEventListener(
      "click",
      function (e) {
        var c = String(input.value || "").trim();
        if (!/^JM[A-Z0-9]{4,16}$/i.test(c)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        kitifiCloudLogin(c.toUpperCase());
      },
      true
    );
  }

  function kitifiAutoConnectFromUrl() {
    if (sessionStorage.getItem(TRY_KEY)) return false;
    var qs = new URLSearchParams(global.location.search);
    var voucher = qs.get("voucher") || qs.get("code") || "";
    try {
      if (!voucher) voucher = sessionStorage.getItem("kitifi_pending_voucher") || "";
    } catch (e) {}
    voucher = String(voucher || "").trim();
    if (!voucher) return false;
    if (qs.get("autoconnect") !== "1" && qs.get("paid") !== "1") return false;
    save(voucher);
    var input = global.document.getElementById("v_code");
    var btn = global.document.getElementById("submit");
    if (input && btn) {
      sessionStorage.setItem(TRY_KEY, "1");
      input.value = voucher.toUpperCase();
      setTimeout(function () { btn.click(); }, 400);
      return true;
    }
    return tryAutoLoginKitifi();
  }

  function tryAutoLoginKitifi() {
    if (sessionStorage.getItem(TRY_KEY)) return false;
    var v = load();
    if (!v || !v.code) return false;
    fetch(API + "?code=" + encodeURIComponent(v.code))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok || data.exhausted || data.remaining_seconds <= 0) {
          clear();
          return;
        }
        renderRemaining(data);
        if (kitifiConnected()) {
          startRemainingPoll();
          return;
        }
        var input = document.getElementById("v_code");
        var btn = document.getElementById("submit");
        if (!input || !btn) return;
        sessionStorage.setItem(TRY_KEY, "1");
        kitifiCloudLogin(v.code.toUpperCase());
      })
      .catch(function () {});
    return true;
  }

  function wireKitifiSave() {
    var btn = document.getElementById("submit");
    var input = document.getElementById("v_code");
    if (!btn || !input) return;
    btn.addEventListener("click", function () {
      var c = String(input.value || "").trim();
      if (c) save(c);
    });
  }

  function wireMikrotikSave() {
    var f = document.forms.login;
    if (!f) return;
    f.addEventListener("submit", function () {
      var u = document.getElementById("u");
      var c = u && String(u.value || "").trim();
      if (c) save(c);
    });
  }

  function init() {
    syncFromQuery();
    captureHotspotFromPage();
    wireKitifiCloudSubmit();
    kitifiAutoConnectFromUrl();
    var v = load();
    if (v && v.code) startRemainingPoll();
  }

  global.JmWifiRoam = {
    KEY: KEY,
    save: save,
    load: load,
    clear: clear,
    syncFromQuery: syncFromQuery,
    saveHotspotContext: saveHotspotContext,
    getHotspotContext: getHotspotContext,
    captureHotspotFromPage: captureHotspotFromPage,
    buildVoucherShopUrl: buildVoucherShopUrl,
    goVoucherShop: goVoucherShop,
    gatewayLoginUrl: gatewayLoginUrl,
    goGatewayLogin: goGatewayLogin,
    silentGatewayLogin: silentGatewayLogin,
    autoConnectGateway: autoConnectGateway,
    savePendingPayment: savePendingPayment,
    clearPendingPayment: clearPendingPayment,
    getPendingPayment: getPendingPayment,
    watchVoucherPayment: watchVoucherPayment,
    resumePendingPayment: resumePendingPayment,
    stopPaymentPoll: stopPaymentPoll,
    tryAutoLoginMikrotik: tryAutoLoginMikrotik,
    tryAutoLoginKitifi: tryAutoLoginKitifi,
    kitifiAutoConnectFromUrl: kitifiAutoConnectFromUrl,
    wireKitifiSave: wireKitifiSave,
    wireMikrotikSave: wireMikrotikSave,
    startRemainingPoll: startRemainingPoll,
    fetchRemaining: fetchRemaining,
    formatSecs: formatSecs,
    init: init,
  };
})(typeof window !== "undefined" ? window : globalThis);
