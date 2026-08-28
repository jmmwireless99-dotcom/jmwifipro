/**
 * Shared portal music for PANISIJAN free WiFi.
 * Plays loop while on captive portal; call stop() before internet connect redirect.
 */
(function (global) {
  var AUDIO_URL = "https://jmwifi.pro/hotspot/audio/free-wifi-panisijan.mp3";
  var KEY = "panisijan_portal_music";
  var audio = null;
  var started = false;

  function getAudio() {
    if (!audio) {
      audio = new Audio(AUDIO_URL);
      audio.loop = true;
      audio.preload = "auto";
    }
    return audio;
  }

  function markOn() {
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
  }

  function markOff() {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }

  function start() {
    markOn();
    var a = getAudio();
    a.muted = false;
    return a.play().then(function () {
      started = true;
    }).catch(function () {});
  }

  function stop() {
    markOff();
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    started = false;
  }

  function boot() {
    try {
      if (sessionStorage.getItem(KEY) !== "1") return;
    } catch (e) { return; }
    start();
  }

  function bindAutoStart() {
    var kick = function () {
      if (!started) start();
    };
    document.addEventListener("click", kick, { once: true, passive: true });
    document.addEventListener("touchstart", kick, { once: true, passive: true });
    var a = getAudio();
    a.muted = true;
    a.play().then(function () {
      a.muted = false;
      started = true;
    }).catch(function () {});
  }

  global.PanisijanMusic = {
    AUDIO_URL: AUDIO_URL,
    start: start,
    stop: stop,
    boot: boot,
    bindAutoStart: bindAutoStart,
  };
})(window);
