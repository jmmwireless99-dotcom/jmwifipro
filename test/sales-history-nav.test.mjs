import assert from "node:assert/strict";
import {
  OPERATOR_NAV_OLD,
  DASH_BTN_OLD,
  LANDING_CTA_OLD,
  LANDING_SVC_OLD,
  LANDING_CSS_OLD,
  LANDING_CSS_SVC_OLD,
  patchOperatorHtml,
  patchLandingHtml,
  patchLandingCss,
} from "../lib/sales-history-nav.mjs";
import { patchServerJs } from "../deploy/sales-history.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fakeOp = [
  OPERATOR_NAV_OLD,
  DASH_BTN_OLD,
  '<div class="dash-head-actions">',
].join("\n");

const op = patchOperatorHtml(fakeOp);
assert.equal(op.changed, true);
assert.deepEqual(op.missing, []);
assert.match(op.src, /id="nav-saleshistory"/);
assert.match(op.src, /Sales History/);
assert.match(op.src, /location\.href='\/sales-history'/);
assert.equal(patchOperatorHtml(op.src).changed, false, "operator patch idempotent");

// Live operator sidebar from jmwifi.pro/operator should match anchors
// Prefer current live operator from VPS snapshot if present, else cached /tmp
const livePath = fs.existsSync("/tmp/operator-live.html") ? "/tmp/operator-live.html" : "/tmp/operator.html";
const liveOp = fs.readFileSync(livePath, "utf8");
const livePatch = patchOperatorHtml(liveOp);
assert.ok(livePatch.src.includes('id="nav-saleshistory"'), "Sales History button present after patch");
assert.ok(livePatch.src.includes("📒 Sales History"));
// Business placement: Sales History after Hotspot, before Referrals
const iHot = livePatch.src.indexOf('id="nav-hotspot"');
const iSales = livePatch.src.indexOf('id="nav-saleshistory"');
const iRef = livePatch.src.indexOf('id="nav-referrals"');
assert.ok(iHot >= 0 && iSales > iHot && iSales < iRef, "Sales History sits in Business after Hotspot");

const fakeLanding = [
  '<link rel="stylesheet" href="/isp-landing.css?v=22">',
  LANDING_CTA_OLD,
  LANDING_SVC_OLD,
].join("\n");
const land = patchLandingHtml(fakeLanding);
assert.equal(land.changed, true);
assert.deepEqual(land.missing, []);
assert.match(land.src, /id="isp-sales-history-nav"/);
assert.match(land.src, /svc-sales/);
assert.match(land.src, /isp-landing\.css\?v=23/);
assert.equal(patchLandingHtml(land.src).changed, false);

// Our repo landing file already has the button
const repoLanding = fs.readFileSync(path.join(ROOT, "public/landing/index.html"), "utf8");
assert.match(repoLanding, /id="isp-sales-history-nav"/);
assert.match(repoLanding, /Sales History/);
assert.match(repoLanding, /href="\/sales-history"/);
assert.match(repoLanding, /svc-sales/);

const css = patchLandingCss([LANDING_CSS_OLD, LANDING_CSS_SVC_OLD].join("\n"));
assert.equal(css.changed, true);
assert.match(css.src, /\.isp-btn-sales/);
assert.match(css.src, /svc-sales \.isp-svc-icon-bg/);

const repoCss = fs.readFileSync(path.join(ROOT, "public/isp-landing.css"), "utf8");
assert.match(repoCss, /\.isp-btn-sales/);

const fakeServer = `    if (pathname === "/apply" && req.method === "GET") {\n      return servePortalPage(res, "apply.html");\n    }\n`;
const srv = patchServerJs(fakeServer);
assert.equal(srv.changed, true);
assert.match(srv.src, /\/sales-history/);

console.log("ok sales-history-nav tests");
