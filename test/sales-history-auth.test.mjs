import assert from "node:assert/strict";
import { patchSalesHistoryAuth, AUTH_MARKER } from "../lib/sales-history-auth.mjs";

const fake = `
    if (pathname === "/api/sales-history" && req.method === "GET") {
      res.end("ok");
    }
`;

const once = patchSalesHistoryAuth(fake);
assert.equal(once.changed, true);
assert.match(once.src, /function salesHistorySessionOk\(/);
assert.match(once.src, new RegExp(AUTH_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(once.src, /Father@services1985/);
assert.match(once.src, /shsid=/);
assert.equal(patchSalesHistoryAuth(once.src).changed, false, "auth patch idempotent");

console.log("ok sales-history-auth tests");
