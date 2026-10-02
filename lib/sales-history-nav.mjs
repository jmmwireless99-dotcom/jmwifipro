/**
 * UI button patches: Sales History on operator sidebar + dashboard,
 * and on the jmwifi.pro landing nav / services grid.
 */

/** Place Sales History in Business section (after Hotspot vouchers) so it is visible. */
export const OPERATOR_NAV_OLD = `  <button id="nav-hotspot" onclick="showView('hotspot')"><span class="ico">🎟</span>Hotspot vouchers</button>
  <button id="nav-referrals" onclick="showView('referrals')"><span class="ico">🎁</span>Referrals &amp; Points</button>`;

export const OPERATOR_NAV_NEW = `  <button id="nav-hotspot" onclick="showView('hotspot')"><span class="ico">🎟</span>Hotspot vouchers</button>
  <button id="nav-saleshistory" onclick="location.href='/sales-history'"><span class="ico">📒</span>Sales History</button>
  <button id="nav-referrals" onclick="showView('referrals')"><span class="ico">🎁</span>Referrals &amp; Points</button>`;

/** Legacy placement (after Sales & Reports) — remove if present so we do not get two buttons. */
export const OPERATOR_NAV_LEGACY = `  <button id="nav-saleshistory" onclick="location.href='/sales-history'"><span class="ico">📒</span>Sales History</button>
`;

export const DASH_BTN_OLD = `      <button type="button" class="ghost" onclick="showView('map')" style="background:var(--panel-2)">🌍 Earth Map</button>`;

export const DASH_BTN_NEW = `      <button type="button" class="ghost" onclick="showView('map')" style="background:var(--panel-2)">🌍 Earth Map</button>
      <button type="button" class="ghost" onclick="location.href='/sales-history'" style="background:var(--panel-2)">📒 Sales History</button>`;

export const LANDING_CTA_OLD = `      <a id="isp-apply-nav" class="isp-btn isp-btn-navy" href="/apply">Apply Now</a>
      <a class="isp-btn isp-btn-outline" href="/account">Client Log in Account</a>`;

export const LANDING_CTA_NEW = `      <a id="isp-apply-nav" class="isp-btn isp-btn-navy" href="/apply">Apply Now</a>
      <a id="isp-sales-history-nav" class="isp-btn isp-btn-sales" href="/sales-history">Sales History</a>
      <a class="isp-btn isp-btn-outline" href="/account">Client Log in Account</a>`;

export const LANDING_SVC_OLD = `      <div class="isp-svc-grid" id="isp-svc-grid">
        <a class="isp-svc-card" href="/apply">
          <img src="/landing/service-home.jpg" alt="" width="400" height="280" loading="lazy" decoding="async">
          <div class="overlay"><h3>Home Internet</h3><p>Wireless plans para sa buong pamilya.</p><span class="link">Apply now →</span></div>
        </a>`;

export const LANDING_SVC_NEW = `      <div class="isp-svc-grid" id="isp-svc-grid">
        <a class="isp-svc-card isp-svc-icon svc-sales" href="/sales-history">
          <div class="isp-svc-icon-bg" aria-hidden="true">📒</div>
          <div class="overlay"><h3>Sales History</h3><p>Vendo list per barangay — sales bawat vendo.</p><span class="link">Open dashboard →</span></div>
        </a>
        <a class="isp-svc-card" href="/apply">
          <img src="/landing/service-home.jpg" alt="" width="400" height="280" loading="lazy" decoding="async">
          <div class="overlay"><h3>Home Internet</h3><p>Wireless plans para sa buong pamilya.</p><span class="link">Apply now →</span></div>
        </a>`;

export const LANDING_CSS_OLD = `.isp-btn-navy { background: var(--navy); color: #fff !important; }
.isp-btn-outline {`;

export const LANDING_CSS_NEW = `.isp-btn-navy { background: var(--navy); color: #fff !important; }
.isp-btn-sales {
  background: linear-gradient(135deg, #0d6b4a 0%, #1d9e75 100%);
  color: #fff !important;
  box-shadow: 0 4px 14px rgba(29, 158, 117, 0.28);
}
.isp-btn-sales:hover { filter: brightness(1.06); }
.isp-btn-outline {`;

export const LANDING_CSS_SVC_OLD = `.isp-svc-card.svc-web .isp-svc-icon-bg { background: linear-gradient(135deg, #0a2d6b, #2b7fd4); }
.isp-svc-card.svc-billing .isp-svc-icon-bg { background: linear-gradient(135deg, #0d4a3a, #1a9e6e); }`;

export const LANDING_CSS_SVC_NEW = `.isp-svc-card.svc-web .isp-svc-icon-bg { background: linear-gradient(135deg, #0a2d6b, #2b7fd4); }
.isp-svc-card.svc-sales .isp-svc-icon-bg { background: linear-gradient(135deg, #0d4a3a, #1d9e75); }
.isp-svc-card.svc-billing .isp-svc-icon-bg { background: linear-gradient(135deg, #0d4a3a, #1a9e6e); }`;

function once(src, oldStr, newStr) {
  if (src.includes(newStr)) {
    return { src, changed: false };
  }
  if (!src.includes(oldStr)) {
    return { src, changed: false, missing: true };
  }
  return { src: src.replace(oldStr, newStr), changed: true };
}

/** Patch operator panel (public/index.html served at /operator). */
export function patchOperatorHtml(src) {
  let out = String(src || "");
  const missing = [];
  let changed = false;

  // Drop legacy placement under Sales & Reports if still present before Business insert.
  if (out.includes(OPERATOR_NAV_LEGACY) && !out.includes(OPERATOR_NAV_NEW)) {
    out = out.replace(OPERATOR_NAV_LEGACY, "");
    changed = true;
  }

  for (const [oldStr, newStr, label] of [
    [OPERATOR_NAV_OLD, OPERATOR_NAV_NEW, "operator-nav"],
    [DASH_BTN_OLD, DASH_BTN_NEW, "dashboard-btn"],
  ]) {
    const r = once(out, oldStr, newStr);
    out = r.src;
    if (r.missing) missing.push(label);
    if (r.changed) changed = true;
  }
  return { src: out, changed, missing };
}

/** Patch jmwifi.pro landing HTML. */
export function patchLandingHtml(src) {
  let out = String(src || "");
  const missing = [];
  let changed = false;

  for (const [oldStr, newStr, label] of [
    [LANDING_CTA_OLD, LANDING_CTA_NEW, "landing-cta"],
    [LANDING_SVC_OLD, LANDING_SVC_NEW, "landing-svc"],
  ]) {
    const r = once(out, oldStr, newStr);
    out = r.src;
    if (r.missing) missing.push(label);
    if (r.changed) changed = true;
  }

  // bump cache-bust when we add the button
  if (changed && out.includes("isp-landing.css?v=22")) {
    out = out.replace("isp-landing.css?v=22", "isp-landing.css?v=23");
  }
  return { src: out, changed, missing };
}

/** Patch landing CSS for Sales History button + service card. */
export function patchLandingCss(src) {
  let out = String(src || "");
  const missing = [];
  let changed = false;

  for (const [oldStr, newStr, label] of [
    [LANDING_CSS_OLD, LANDING_CSS_NEW, "css-btn-sales"],
    [LANDING_CSS_SVC_OLD, LANDING_CSS_SVC_NEW, "css-svc-sales"],
  ]) {
    const r = once(out, oldStr, newStr);
    out = r.src;
    if (r.missing) missing.push(label);
    if (r.changed) changed = true;
  }
  return { src: out, changed, missing };
}
