import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PANISIJAN_ROUTER_ID,
  kitifiFreeSkipRegister,
  kitifiFreeGuestName,
  kitifiFreeCanClaim,
  kitifiFreeStatusMessage,
} from "../lib/kitifi-free-claim-policy.js";

test("only Panisijan (router 51) skips registration", () => {
  assert.equal(kitifiFreeSkipRegister(51), true);
  assert.equal(kitifiFreeSkipRegister("51"), true);
  assert.equal(kitifiFreeSkipRegister(34), false);
  assert.equal(kitifiFreeSkipRegister(40), false);
  assert.equal(kitifiFreeSkipRegister(PANISIJAN_ROUTER_ID), true);
});

test("guest name uses last 4 of MAC, no personal fields", () => {
  assert.equal(kitifiFreeGuestName("AA:BB:CC:DD:EE:FF"), "Guest EEFF");
  assert.equal(kitifiFreeGuestName("aabbccddeeff"), "Guest EEFF");
  assert.equal(kitifiFreeGuestName(""), "Guest");
});

test("Panisijan can claim without a registered client", () => {
  const d = kitifiFreeCanClaim({
    enabled: true,
    skipRegister: true,
    client: null,
    claimsToday: 0,
    limitPerDay: 1,
  });
  assert.equal(d.ok, true);
  assert.equal(d.reason, "ok");
});

test("other sites still require registration", () => {
  const d = kitifiFreeCanClaim({
    enabled: true,
    skipRegister: false,
    client: null,
    claimsToday: 0,
    limitPerDay: 1,
  });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "register");
});

test("daily limit still blocks after a claim (no extra account)", () => {
  const d = kitifiFreeCanClaim({
    enabled: true,
    skipRegister: true,
    client: { status: "active" },
    claimsToday: 1,
    limitPerDay: 1,
  });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "limit");
});

test("blocked guest cannot claim", () => {
  const d = kitifiFreeCanClaim({
    enabled: true,
    skipRegister: true,
    client: { status: "blocked" },
    claimsToday: 0,
    limitPerDay: 1,
  });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "blocked");
});

test("disabled site cannot claim", () => {
  const d = kitifiFreeCanClaim({
    enabled: false,
    skipRegister: true,
    client: null,
    claimsToday: 0,
    limitPerDay: 1,
  });
  assert.equal(d.ok, false);
  assert.equal(d.reason, "disabled");
});

test("registered Candelaria client can still claim", () => {
  const d = kitifiFreeCanClaim({
    enabled: true,
    skipRegister: false,
    client: { status: "active" },
    claimsToday: 0,
    limitPerDay: 1,
  });
  assert.equal(d.ok, true);
});

test("Panisijan status copy is claim-only, not register", () => {
  const available = kitifiFreeStatusMessage({
    enabled: true,
    skipRegister: true,
    client: null,
    claimsToday: 0,
    limitPerDay: 1,
    uptime: "5 Hours",
    routerId: 51,
  });
  assert.match(available, /tap to claim/i);
  assert.doesNotMatch(available, /register/i);

  const limited = kitifiFreeStatusMessage({
    enabled: true,
    skipRegister: true,
    client: null,
    claimsToday: 1,
    limitPerDay: 1,
    routerId: 51,
  });
  assert.match(limited, /Na-claim mo na/i);
});

test("other sites still ask to register", () => {
  const msg = kitifiFreeStatusMessage({
    enabled: true,
    skipRegister: false,
    client: null,
    claimsToday: 0,
    limitPerDay: 1,
    routerId: 34,
  });
  assert.match(msg, /Register/i);
});
