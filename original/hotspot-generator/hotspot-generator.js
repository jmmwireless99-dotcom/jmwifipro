// Original jmwifi.pro hotspot voucher generator — JEFF NETWORK SERVICE (Jeffrey).
// Preserved from the production jm-billing panel (direct MikroTik /ip/hotspot/user creation).
// Zero dependencies; safe to import from server.js or use standalone.

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I

/** Generate a random hotspot voucher code (original Jeffrey algorithm). */
export function genVoucherCode(len, prefix = "") {
  let s = String(prefix || "");
  const n = Math.min(Math.max(Number(len) || 6, 4), 16);
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/** Parse `voucher:<planId>[:<routerId>]` payment tags. */
export function parseVoucherPaymentTag(s) {
  const m = String(s || "").trim().match(/^voucher:(\d+)(?::(\d+))?$/i);
  if (!m) return null;
  return { planId: Number(m[1]), routerId: m[2] ? Number(m[2]) : null };
}

/** Convert plan validity minutes to MikroTik limit-uptime (e.g. 120 → "2h"). */
export function minsToHotspotUptime(mins) {
  mins = Number(mins) || 0;
  if (mins <= 0) return "";
  if (mins >= 1440 && mins % 1440 === 0) return `${mins / 1440}d`;
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}m`;
}

/**
 * Original Jeffrey bulk hotspot voucher generator.
 * Creates users via the supplied `createUser` callback (typically MikroTik API).
 */
export async function generateHotspotVouchers({
  count = 10,
  profile = "default",
  length = 8,
  prefix = "",
  uptime = "",
  userOnly = true,
  createUser,
}) {
  if (typeof createUser !== "function") throw new Error("createUser callback required.");
  const n = Math.min(Math.max(Number(count) || 10, 1), 500);
  const prof = String(profile || "default");
  const made = [];
  const errors = [];
  for (let i = 0; i < n; i++) {
    const code = genVoucherCode(length, prefix);
    const password = userOnly ? "" : code;
    try {
      await createUser({ code, password, profile: prof, uptime: uptime || "" });
      made.push(code);
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  return {
    created: made,
    count: made.length,
    profile: prof,
    uptime: uptime || "",
    userOnly: userOnly !== false,
    errors,
  };
}

/** Build printable voucher card HTML (original jmwifi.pro admin panel layout). */
export function buildVoucherPrintHtml({ created = [], biz = "WiFi", userOnly = true, price = "", exp = "", uptime = "" }) {
  const cards = created.map((code) => `<div class="v">
      <div class="b">${escapeHtml(biz)}</div>
      <div class="lbl">${userOnly ? "Username" : "User / Pass"}</div>
      <div class="c">${escapeHtml(code)}</div>
      <div class="ft">${price ? `<span class="p">${escapeHtml(price)}</span>` : ""}${exp ? `<span class="e">${escapeHtml(exp)}</span>` : (uptime ? `<span class="e">${escapeHtml(uptime)}</span>` : "")}</div>
    </div>`).join("");
  return `<!doctype html><title>Vouchers</title><style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;margin:8px}
    .grid{display:flex;flex-wrap:wrap;gap:6px}
    .v{border:1px dashed #888;border-radius:6px;padding:6px 8px;width:118px;text-align:center;page-break-inside:avoid}
    .b{font-size:10px;font-weight:700;color:#111;text-transform:uppercase;letter-spacing:.3px;border-bottom:1px solid #eee;padding-bottom:2px;margin-bottom:3px}
    .lbl{font-size:8px;color:#888;text-transform:uppercase;letter-spacing:.5px}
    .c{font-size:18px;font-weight:800;letter-spacing:2px;font-family:'Courier New',monospace;margin:1px 0 3px}
    .ft{display:flex;justify-content:space-between;font-size:10px;color:#333;border-top:1px solid #eee;padding-top:3px}
    .p{font-weight:800} .e{color:#666}
    @media print{button{display:none}}
  </style><button onclick="print()" style="padding:6px 12px;margin-bottom:8px">Print</button><div class="grid">${cards}</div>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
