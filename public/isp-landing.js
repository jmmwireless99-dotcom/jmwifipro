(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function peso(n) {
    n = Number(n) || 0;
    return "\u20B1" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  function cleanSpeed(s) {
    s = String(s || "");
    let first = s.split("/")[0];
    first = first.replace(/mbps/ig, "").replace(/m\b/ig, "").replace(/\s+/g, "").trim();
    return first || s.replace(/mbps/ig, "").trim() || "—";
  }

  function normalizeFacebookUrl(raw) {
    let fbUrl = String(raw || "").trim();
    if (!fbUrl) return "";
    if (!/^https?:\/\//i.test(fbUrl)) {
      fbUrl = fbUrl.replace(/^@/, "").replace(/^\/*/, "");
      if (!/^facebook\.com/i.test(fbUrl)) fbUrl = "https://facebook.com/" + fbUrl;
      else fbUrl = "https://" + fbUrl;
    }
    return fbUrl;
  }

  function setOffers(el, text) {
    if (!el) return;
    el.innerHTML = "";
    const lines = String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) { el.style.display = "none"; return; }
    const ul = document.createElement("ul");
    lines.forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line.replace(/^[•\-\*]\s*/, "").replace(/^\d+\.\s*/, "");
      ul.appendChild(li);
    });
    el.appendChild(ul);
    el.style.display = "";
  }

  function isShortPromoPlan(p) {
    const n = String(p.name || "").toLowerCase();
    const v = Number(p.validity_days) || 0;
    if (/\b1\s*[- ]?day|\b1d\b|one day|1 araw|promo.*\b1\b/.test(n)) return true;
    if (/\b3\s*[- ]?days?\b|\b3d\b|tatlong araw|3 araw/.test(n)) return true;
    if (v > 0 && v <= 3) return true;
    return false;
  }

  function filterPublicPlans(plans) {
    return (plans || []).filter((p) => {
      if (String(p.type || "pppoe").toLowerCase() === "hotspot") return false;
      return !isShortPromoPlan(p);
    });
  }

  function filterPromoLines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((line) => {
        const t = line.toLowerCase();
        if (/\b1\s*[- ]?day|\b1d\b|1 araw|promo.*\b1\b/.test(t)) return false;
        if (/\b3\s*[- ]?days?\b|\b3d\b|3 araw/.test(t)) return false;
        return true;
      })
      .join("\n");
  }

  const FEATURED_HERO = { price: 999, badge: "NEW Plan! NEW Offer!" };
  const HERO_SLIDES = [
    {
      thumb: "/landing/service-family.jpg",
      kicker: "Sulit na Sulit, Sulit pa!", lineA: "Unlimited", lineB: "Internet", price: "999!",
      badge: "NEW Plan! NEW Offer!", badgeStyle: "new", sub: "", showOffer: true,
    },
    {
      thumb: "/landing/service-home.jpg",
      kicker: "Para sa Bahay!", lineA: "Home", lineB: "Internet", price: "!", badge: "Wireless · Stable · Sulit", badgeStyle: "alt", showOffer: false,
    },
    {
      thumb: "/landing/service-family.jpg",
      kicker: "Para sa Pamilya!", lineA: "Unlimited", lineB: "Plans", price: "!", badge: "₱999 · Unlimited", badgeStyle: "alt", showOffer: false,
    },
    {
      thumb: "/landing/service-stream.jpg",
      kicker: "Madaling Bayad!", lineA: "Pay &", lineB: "Support", price: "!", badge: "Customer Portal · QR Ph", badgeStyle: "alt", showOffer: false,
    },
    {
      thumb: "/landing/service-cctv.jpg",
      kicker: "Secure ang Bahay!", lineA: "CCTV", lineB: "Installation", price: "!", badge: "Home & Business Security", badgeStyle: "alt", showOffer: false,
    },
    {
      thumb: "/landing/service-solar.jpg",
      kicker: "Tipid sa Kuryente!", lineA: "Solar", lineB: "Installation", price: "!", badge: "Solar Panel Setup", badgeStyle: "alt", showOffer: false,
    },
  ];

  function renderHeroAd(s) {
    const kicker = $("isp-hero-kicker");
    if (kicker) kicker.textContent = s.kicker;
    const product = $("isp-hero-headline");
    if (product) {
      product.innerHTML =
        '<span class="hl-a">' + esc(s.lineA) + "</span>" +
        '<span class="hl-b">' + esc(s.lineB) + "</span>";
    }
    const priceBig = $("isp-hero-price");
    if (priceBig) priceBig.textContent = s.price || "";
    if (priceBig) priceBig.style.display = s.price && s.showOffer !== false ? "" : "none";
    const sticker = $("isp-hero-badge");
    if (sticker) {
      sticker.className = "isp-ad-sticker" + (s.badgeStyle === "new" ? "" : " is-alt");
      if (s.badgeStyle === "new") {
        sticker.innerHTML = "<span>NEW Plan!</span><span>NEW Offer!</span>";
      } else {
        sticker.innerHTML = "<span>" + esc(s.badge) + "</span>";
      }
    }
    const offer = $("isp-hero-offer");
    if (offer) {
      offer.classList.toggle("hidden", s.showOffer === false);
      if (s.showOffer !== false) {
        const tag = $("isp-hero-tag");
        if (tag) tag.textContent = (s.lineA + " " + s.lineB).trim() || "Unlimited Internet";
      }
    }
    let sub = $("isp-hero-ad-sub");
    if (s.sub) {
      if (!sub) {
        sub = document.createElement("p");
        sub.id = "isp-hero-ad-sub";
        sub.className = "isp-ad-sub";
        $("isp-hero-ad") && $("isp-hero-ad").appendChild(sub);
      }
      sub.textContent = s.sub;
    } else if (sub) sub.remove();
  }

  function setFeaturedHero(plan) {
    const p = plan || null;
    const sp = p ? cleanSpeed(p.speed) : "";
    HERO_SLIDES[0].price = String(FEATURED_HERO.price) + "!";
    const sub = sp && sp !== "—" ? sp + " Mbps · " + peso(FEATURED_HERO.price) + "/month" : "";
    HERO_SLIDES[0].sub = sub;
    const speedEl = $("isp-hero-speed");
    const monthlyEl = $("isp-hero-monthly");
    const priceBig = $("isp-hero-price");
    if (speedEl) speedEl.textContent = sp && sp !== "—" ? sp + " Mbps" : "Unlimited";
    if (monthlyEl) monthlyEl.textContent = peso(FEATURED_HERO.price) + " per month";
    if (priceBig) priceBig.textContent = String(FEATURED_HERO.price) + "!";
    if (window._heroShow) window._heroShow(window._heroIdx || 0);
  }

  function initHeroSlider() {
    const ad = $("isp-hero-ad");
    const thumbsEl = $("isp-hero-thumbs");
    const prevBtn = $("isp-hero-prev");
    const nextBtn = $("isp-hero-next");
    let idx = 0;
    let timer = null;
    let changing = false;

    function show(i) {
      if (changing) return;
      idx = (i + HERO_SLIDES.length) % HERO_SLIDES.length;
      window._heroIdx = idx;
      if (ad) {
        changing = true;
        ad.classList.add("is-changing");
        setTimeout(() => {
          renderHeroAd(HERO_SLIDES[idx]);
          ad.classList.remove("is-changing");
          changing = false;
        }, 220);
      } else {
        renderHeroAd(HERO_SLIDES[idx]);
      }
      if (thumbsEl) {
        thumbsEl.querySelectorAll(".isp-hero-thumb").forEach((t, j) => {
          t.classList.toggle("active", j === idx);
        });
      }
    }

    window._heroShow = show;

    if (thumbsEl) {
      thumbsEl.innerHTML = HERO_SLIDES.map((s, i) =>
        '<button type="button" class="isp-hero-thumb' + (i === 0 ? " active" : "") + '" data-i="' + i + '" aria-label="Promo ' + (i + 1) + '">' +
        '<img src="' + esc(s.thumb || s.door || "/landing/hero-bg.jpg") + '" alt="" width="88" height="52" loading="lazy" decoding="async">' +
        "</button>"
      ).join("");
      thumbsEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".isp-hero-thumb");
        if (!btn) return;
        show(Number(btn.dataset.i));
        resetTimer();
      });
    }

    if (prevBtn) prevBtn.addEventListener("click", () => { show(idx - 1); resetTimer(); });
    if (nextBtn) nextBtn.addEventListener("click", () => { show(idx + 1); resetTimer(); });

    function resetTimer() {
      if (timer) clearInterval(timer);
      timer = setInterval(() => show(idx + 1), 5500);
    }

    const hero = $("isp-hero");
    if (hero) {
      hero.addEventListener("mouseenter", () => { if (timer) clearInterval(timer); });
      hero.addEventListener("mouseleave", resetTimer);
      hero.addEventListener("touchstart", () => { if (timer) clearInterval(timer); }, { passive: true });
      hero.addEventListener("touchend", () => { setTimeout(resetTimer, 4000); }, { passive: true });
    }

    show(0);
    resetTimer();
  }

  function findFeaturedPlan(plans) {
    const list = filterPublicPlans(plans);
    return list.find((p) => /unlimited/i.test(p.name) && Number(p.price) === FEATURED_HERO.price)
      || list.find((p) => /unlimited/i.test(p.name))
      || list.find((p) => Number(p.price) === FEATURED_HERO.price)
      || null;
  }

  function renderPlans(plans) {
    const box = $("isp-plan-cards");
    if (!box) return;
    const list = filterPublicPlans(plans);
    setFeaturedHero(findFeaturedPlan(plans));
    if (!list.length) {
      box.innerHTML = '<div class="isp-plan empty">Plans coming soon — contact us on Facebook or apply online.</div>';
      return;
    }
    const popIdx = list.findIndex((p) => /unlimited/i.test(p.name) && Number(p.price) === FEATURED_HERO.price);
    const pop = popIdx >= 0 ? popIdx : 0;
    box.innerHTML = list.map((p, i) => {
      const sp = cleanSpeed(p.speed);
      const isUnlimited = /unlimited/i.test(p.name);
      return `<article class="isp-plan${i === pop ? " pop" : ""}">
        <div class="nm">${esc(p.name)}</div>
        <div class="sp">${isUnlimited ? "∞" : esc(sp)}<small>${isUnlimited ? " Unlimited" : " Mbps"}</small></div>
        <div class="pr">${peso(p.price)}<small>/month</small></div>
        <a class="pick" href="/apply?plan=${encodeURIComponent(p.id)}">Apply now</a>
      </article>`;
    }).join("");
  }

  function applyBranding(d) {
    const biz = String(d.biz_name || "JMM INTERNET SERVICES").trim();
    const tag = "Fast and Reliable Internet";
    document.title = biz + " — Internet Service";
    if ($("isp-foot-name")) $("isp-foot-name").textContent = biz;
    if ($("isp-brand-name")) $("isp-brand-name").textContent = biz;
    if ($("isp-hero-top-name")) $("isp-hero-top-name").textContent = biz;
    if ($("isp-nav-tag")) $("isp-nav-tag").textContent = tag;
    if ($("brand-name")) $("brand-name").textContent = biz;

    const logoSrc = String(d.brand_logo_url || d.brand_logo || "").trim();
    document.querySelectorAll("#isp-brand-logo, #isp-hero-mini-logo").forEach((el) => {
      if (logoSrc) { el.src = logoSrc; el.style.display = "block"; }
      else el.style.display = "none";
    });

    const addr = String(d.biz_address || "").trim();
    const contact = String(d.biz_contact || "").trim();
    if ($("isp-foot-addr")) $("isp-foot-addr").textContent = addr || "Wireless internet for homes and businesses";
    if ($("isp-foot-contact")) $("isp-foot-contact").textContent = contact;

    const facebook = normalizeFacebookUrl(d.biz_facebook || "https://www.facebook.com/profile.php?id=61592702023354");
    if ($("isp-fb-btn") && facebook) $("isp-fb-btn").href = facebook;

    const pub = String(d.public_url || "https://jmwifi.pro").trim().replace(/\/$/, "") || location.origin.replace(/\/$/, "");
    const applyUrl = String(d.apply_url || pub + "/apply").trim();
    if ($("isp-apply-nav")) $("isp-apply-nav").href = applyUrl;
    if ($("isp-apply-band")) $("isp-apply-band").href = applyUrl;
    if ($("isp-web-link")) {
      $("isp-web-link").href = pub;
      try { $("isp-web-link").textContent = new URL(pub).host; } catch { $("isp-web-link").textContent = pub.replace(/^https?:\/\//, ""); }
    }

    setOffers($("isp-offers"), filterPromoLines(d.login_promo));

    const img = $("brand-logo"), fb = $("brand-fallback");
    if (img && fb) {
      if (logoSrc) { img.src = logoSrc; img.style.display = "block"; fb.style.display = "none"; }
      else { img.style.display = "none"; fb.style.display = "flex"; fb.textContent = biz.charAt(0).toUpperCase(); }
    }
  }

  window.initIspLanding = async function initIspLanding() {
    const toggle = $("isp-nav-toggle");
    const nav = document.querySelector(".isp-nav");
    if (toggle && nav) {
      toggle.addEventListener("click", () => nav.classList.toggle("open"));
      nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => nav.classList.remove("open")));
    }

    initHeroSlider();
    setFeaturedHero(null);

    try {
      const me = await fetch("/api/auth/me", { credentials: "same-origin" }).then((x) => x.json());
      if (me && me.ok && me.user) {
        if (me.user.role === "admin") location.replace("/");
        else location.replace("/operator");
        return;
      }
    } catch {}

    const panel = $("isp-signin-panel");
    const openBtn = $("isp-signin-open");
    const closeBtn = $("isp-signin-close");
    function openSignin() {
      if (!panel) return;
      panel.hidden = false;
      if (openBtn) openBtn.setAttribute("aria-expanded", "true");
      setTimeout(() => { if ($("li-user")) $("li-user").focus(); }, 100);
    }
    function closeSignin() {
      if (!panel) return;
      panel.hidden = true;
      if (openBtn) openBtn.setAttribute("aria-expanded", "false");
    }
    if (openBtn) openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      panel && panel.hidden ? openSignin() : closeSignin();
    });
    if (closeBtn) closeBtn.addEventListener("click", closeSignin);
    document.addEventListener("click", (e) => {
      if (!panel || panel.hidden) return;
      if (panel.contains(e.target) || (openBtn && openBtn.contains(e.target))) return;
      closeSignin();
    });
    if (new URLSearchParams(location.search).has("staff")) openSignin();

    try {
      const br = await fetch("/api/branding").then((x) => x.json());
      applyBranding((br && br.data) || {});
    } catch {
      applyBranding({});
    }

    const plansBox = $("isp-plan-cards");
    let plansLoaded = false;
    async function loadPlans() {
      if (plansLoaded) return;
      plansLoaded = true;
      try {
        const pl = await fetch("/api/plans").then((x) => x.json());
        if (pl && pl.ok) renderPlans(pl.plans);
      } catch {
        if (plansBox) plansBox.innerHTML = '<div class="isp-plan empty">Plans coming soon — contact us on Facebook.</div>';
      }
    }
    if (plansBox && "IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { loadPlans(); io.disconnect(); }
      }, { rootMargin: "200px" });
      io.observe(plansBox);
    } else {
      loadPlans();
    }
  };

  window.doLogin = async function doLogin(e) {
    e.preventDefault();
    if ($("li-err")) $("li-err").textContent = "";
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: $("li-user").value.trim(), password: $("li-pass").value }),
      }).then((x) => x.json());
      if (r.ok) {
        const role = (r.user && r.user.role) || "";
        if (role === "admin") location.replace("/");
        else location.href = "/operator";
        return false;
      }
      if ($("li-err")) $("li-err").textContent = r.error || "Login failed";
    } catch {
      if ($("li-err")) $("li-err").textContent = "Connection error";
    }
    return false;
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (typeof initIspLanding === "function") initIspLanding();
  });
})();
