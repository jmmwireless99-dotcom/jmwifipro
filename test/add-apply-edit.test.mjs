import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  APPLY_EDIT_LOCKED,
  APPLY_EDIT_NOT_FOUND,
  APPLY_FN_OLD,
  HTML_BAR_OLD,
  HTML_CSS_OLD,
  HTML_FETCH_OLD,
  HTML_JS_OLD,
  HTML_LOAD_OLD,
  HTML_PAINT_OLD,
  HTML_SUCCESS_OLD,
  IMPORT_EDIT,
  ROUTES_MARKER,
  contactsMatch,
  findPendingApply,
  patchApplyHtml,
  patchDbJs,
  patchServerJs,
  phoneKey,
  publicApplyRecord,
  splitApplyAddress,
} from "../lib/apply-edit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("phone keys match 09 and +63 numbers", () => {
  assert.equal(phoneKey("0917 123 4567"), "09171234567");
  assert.equal(phoneKey("+63 917 123 4567"), "09171234567");
  assert.equal(contactsMatch("09171234567", "639171234567"), true);
  assert.equal(contactsMatch("09171234567", "09170000000"), false);
  assert.equal(contactsMatch("0917", "0917"), false);
});

test("split apply address recovers municipality and barangay", () => {
  const a = splitApplyAddress("Purok 2, MANAMOC, AROROY, Masbate", "MANAMOC");
  assert.equal(a.municipality, "AROROY");
  assert.equal(a.barangay, "MANAMOC");
  assert.equal(a.landmark, "Purok 2");
});

test("public record omits password and username", () => {
  const rec = publicApplyRecord({
    id: 9,
    status: "applied",
    name: "Juan",
    last_name: "Cruz",
    contact: "09171234567",
    email: "a@b.c",
    facebook: "Juan",
    address: "House, CANDELARIA, USON, Masbate",
    area: "CANDELARIA",
    password: "SECRET",
    username: "Juan",
    plan_id: 2,
    pay_choice: "on_install",
  });
  assert.equal(rec.first_name, "Juan");
  assert.equal(rec.barangay, "CANDELARIA");
  assert.equal(rec.municipality, "USON");
  assert.equal("password" in rec, false);
  assert.equal("username" in rec, false);
});

test("only pending applied jobs can be opened", () => {
  const jobs = [
    { id: 1, contact: "09171234567", status: "applied", customer_id: null, name: "A" },
    { id: 2, contact: "09171234567", status: "completed", customer_id: 9, name: "B" },
  ];
  const getById = (id) => jobs.find((j) => j.id === id);
  const list = () => jobs;
  const ok = findPendingApply(getById, list, "", "09171234567");
  assert.equal(ok.ok, true);
  assert.equal(ok.job.id, 1);
  const locked = findPendingApply(getById, list, 2, "09171234567");
  assert.equal(locked.ok, false);
  assert.equal(locked.error, APPLY_EDIT_LOCKED);
  const miss = findPendingApply(getById, list, 1, "09999999999");
  assert.equal(miss.error, APPLY_EDIT_NOT_FOUND);
});

test("multiple pending applies on one number require the application id", () => {
  const jobs = [
    { id: 10, contact: "09171234567", status: "applied" },
    { id: 11, contact: "09171234567", status: "applied" },
  ];
  const r = findPendingApply((id) => jobs.find((j) => j.id === id), () => jobs, "", "09171234567");
  assert.equal(r.ok, false);
  assert.match(r.error, /application number/i);
  const one = findPendingApply((id) => jobs.find((j) => j.id === id), () => jobs, 11, "0917-123-4567");
  assert.equal(one.ok, true);
  assert.equal(one.job.id, 11);
});

test("server patch adds coverage import when missing", () => {
  const srv = patchServerJs(`import { JobOrders } from "./lib/db.js";\n${ROUTES_MARKER}\n`);
  assert.equal(srv.changed, true);
  assert.match(srv.src, /apply-coverage\.mjs/);
  assert.match(srv.src, /apply-edit\.mjs/);
});

test("server and db patchers add lookup/edit and updateApplicant", () => {
  const srv = patchServerJs(
    `import { JobOrders } from "./lib/db.js";\nimport { resolveApplyCoverage, formatApplyAddress } from "./lib/apply-coverage.mjs";\n${ROUTES_MARKER}\n`,
  );
  assert.equal(srv.changed, true);
  assert.deepEqual(srv.missing, []);
  assert.match(srv.src, /apply-edit\.mjs/);
  assert.match(srv.src, /\/api\/apply\/lookup/);
  assert.match(srv.src, /\/api\/apply\/edit/);
  assert.match(srv.src, /JobOrders\.updateApplicant/);
  assert.match(srv.src, /lookup_contact/);
  const db = patchDbJs(APPLY_FN_OLD);
  assert.equal(db.changed, true);
  assert.match(db.src, /updateApplicant:/);
  assert.doesNotMatch(db.src, /status='completed'/);
});

test("apply.html patch adds edit finder and save-corrections flow", () => {
  const stub = [
    HTML_CSS_OLD,
    `      <a href="/apply" class="active">Apply</a>
      <a href="/account">My Account</a>`,
    HTML_BAR_OLD,
    `      <div class="card">\n        <label>First name *</label>`,
    HTML_JS_OLD,
    HTML_PAINT_OLD,
    HTML_FETCH_OLD,
    HTML_SUCCESS_OLD,
    HTML_LOAD_OLD,
  ].join("\n");
  const html = patchApplyHtml(stub);
  assert.equal(html.changed, true, html.missing && html.missing.join(","));
  assert.deepEqual(html.missing, []);
  assert.match(html.src, /May mali sa type/);
  assert.match(html.src, /\/apply\?edit=1/);
  assert.match(html.src, /\/api\/apply\/lookup/);
  assert.match(html.src, /\/api\/apply\/edit/);
  assert.match(html.src, /Save corrections/);
  assert.match(html.src, /submitApplyEdit/);
  assert.match(html.src, /jm_apply_last/);
});

test("workspace apply page includes the live form fields", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/portal/apply.html"), "utf8");
  assert.match(html, /Submit application|Save corrections/);
  assert.match(html, /first_name/);
  assert.match(html, /\/api\/apply/);
});

void IMPORT_EDIT;
