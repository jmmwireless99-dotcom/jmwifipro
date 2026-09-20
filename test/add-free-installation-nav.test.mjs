import assert from "node:assert/strict";
import test from "node:test";
import {
  API_OLD,
  JO_VARS_OLD,
  LIST_OLD,
  NAV_OLD,
  OPEN_OLD,
  OPEN_TITLE_OLD,
  PLANFEE_OLD,
  ROLES_OLD,
  SAVE_OLD,
  SAVE_RELOAD_OLD,
  SHOW_OLD,
  VIEW_OLD,
  VIEWS_OLD,
  patchDbJs,
  patchIndexHtml,
  patchServerJs,
} from "../lib/free-installation-nav.mjs";

const FAKE_INDEX = [
  NAV_OLD,
  VIEW_OLD,
  VIEWS_OLD,
  SHOW_OLD,
  ROLES_OLD,
  JO_VARS_OLD,
  OPEN_OLD,
  OPEN_TITLE_OLD,
  PLANFEE_OLD,
  SAVE_OLD,
  SAVE_RELOAD_OLD,
  "async function loadJobOrders() {",
].join("\n");

test("patches operator sidebar and Free Installation view", () => {
  const r = patchIndexHtml(FAKE_INDEX);
  assert.equal(r.changed, true);
  assert.deepEqual(r.missing, []);
  assert.match(r.src, /id="nav-freeinstall"/);
  assert.match(r.src, />Free Installation</);
  assert.match(r.src, /id="view-freeinstall"/);
  assert.match(r.src, /showView\('freeinstall'\)/);
  assert.match(r.src, /openJoCreate\(\{free:true\}\)/);
  assert.match(r.src, /"freeinstall"/);
  assert.match(r.src, /async function loadFreeInstalls/);
  assert.match(r.src, /\?free=1/);
  assert.match(r.src, /FREE-INSTALL/);
  const again = patchIndexHtml(r.src);
  assert.equal(again.changed, false);
});

test("API and JobOrders.list accept free=1 / freeInstall", () => {
  const db = patchDbJs(LIST_OLD);
  assert.equal(db.changed, true);
  assert.match(db.src, /filter.freeInstall/);
  assert.match(db.src, /FREE-INSTALL/);
  const api = patchServerJs(API_OLD);
  assert.equal(api.changed, true);
  assert.match(api.src, /q.get\("free"\) === "1"/);
});
