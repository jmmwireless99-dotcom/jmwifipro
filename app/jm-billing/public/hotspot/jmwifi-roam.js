/* JM WIFI — roam + global time pool (remaining follows you across all sites). */
(function (global) {
  var KEY = "jmwifi_cloud_voucher";
  var TRY_KEY = "jmwifi_auto_tried";
  var POLL_KEY = "jmwifi_remain_poll";
  var API = "https://jmwifi.pro/api/voucher/remaining";

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

  function gatewayLoginUrl(code, gw, dst) {
    gw = String(gw || "10.0.0.10").replace(/^https?:\/\//, "").split("/")[0];
    var q = new URLSearchParams();
    q.set("username", code);
    q.set("password", code);
    q.set("popup", "true");
    if (dst) q.set("dst", dst);
    return "http://" + gw + "/login?" + q.toString();
  }

  function goGatewayLogin(code, gw, dst) {
    save(code);
    global.location.assign(gatewayLoginUrl(code, gw, dst));
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
    wireKitifiCloudSubmit();
    var v = load();
    if (v && v.code) startRemainingPoll();
  }

  global.JmWifiRoam = {
    KEY: KEY,
    save: save,
    load: load,
    clear: clear,
    syncFromQuery: syncFromQuery,
    tryAutoLoginMikrotik: tryAutoLoginMikrotik,
    tryAutoLoginKitifi: tryAutoLoginKitifi,
    wireKitifiSave: wireKitifiSave,
    wireMikrotikSave: wireMikrotikSave,
    startRemainingPoll: startRemainingPoll,
    fetchRemaining: fetchRemaining,
    formatSecs: formatSecs,
    init: init,
  };
})(typeof window !== "undefined" ? window : globalThis);
