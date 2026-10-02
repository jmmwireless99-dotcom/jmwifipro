import assert from "node:assert/strict";
import {
  isSalesMonthEditable,
  salesMonthLockReason,
  addMonths,
  monthNow,
} from "../lib/sales-history-lock.mjs";

// Oct 2, 2026
const oct = new Date(2026, 9, 2);
assert.equal(monthNow(oct), "2026-10");
assert.equal(addMonths("2026-09", 1), "2026-10");
assert.equal(addMonths("2026-09", 2), "2026-11");

// In October: Sep editable, Aug locked
assert.equal(isSalesMonthEditable("2026-10", oct), true);
assert.equal(isSalesMonthEditable("2026-09", oct), true);
assert.equal(isSalesMonthEditable("2026-08", oct), false);
assert.ok(salesMonthLockReason("2026-08", oct).includes("Locked"));

// Nov 1: Sep locks
const nov = new Date(2026, 10, 1);
assert.equal(isSalesMonthEditable("2026-09", nov), false);
assert.equal(isSalesMonthEditable("2026-10", nov), true);
assert.equal(isSalesMonthEditable("2026-11", nov), true);

console.log("ok sales-history-lock tests");
