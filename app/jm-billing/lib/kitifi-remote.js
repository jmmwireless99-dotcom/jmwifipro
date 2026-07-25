/**
 * Drive KiTifi admin Voucher Generator (10.0.0.10/admin) from jmwifi.pro.
 * VPS cannot reach 10.0.0.10 directly — all HTTP goes through the site MikroTik
 * (/tool/fetch) that shares the LAN with KiTifi.
 *
 * Real UI payload (from generate.js):
 *   POST api/pages/home.php
 *   { action:"generateVoucher", name_length, char, qty, prefix, r_id, seller_id,
 *     profile, type, amount, day, hour, min, eday, ehour, emin, points, pause_limit }
 */
import { Settings } from "./db.js";

export function kitifiAdminBase(routerId) {
  if (routerId != null && routerId !== "") {
    const per = Settings.get("kitifi_controller_url_" + String(routerId), "");
    if (per) return String(per).replace(/\/$/, "");
  }
  return String(Settings.get("kitifi_controller_url", "http://10.0.0.10/admin")).replace(/\/$/, "");
}

export function kitifiAdminUser() {
  return Settings.get("kitifi_admin_user", "admin");
}

export function kitifiAdminPass(routerId) {
  if (routerId != null && routerId !== "") {
    const per = Settings.get("kitifi_admin_pass_" + String(routerId), "");
    if (per) return per;
  }
  return Settings.get("kitifi_admin_pass", "");
}

/** KiTifi Vendo / Seller API id — table row id may differ (e.g. 4rth VOUCHER = 137977). */
export function kitifiSellerId(routerId) {
  if (routerId != null && routerId !== "") {
    const per = Settings.get("kitifi_seller_id_" + String(routerId), "");
    if (per) return String(per);
  }
  return String(Settings.get("kitifi_seller_id", "1"));
}

/** Discover VOUCHER seller API id from KiTifi seller list (data-id attribute). */
export async function kitifiDiscoverSellerApiId(conn, cookie, { name = "VOUCHER", routerId, fallbackNames = ["GCASH"] } = {}) {
  const ck = cookie || (await kitifiLogin(conn));
  const r = await conn.talk([
    "/tool/fetch",
    "=url=" + kitifiAdminBase(routerId) + "/api/pages/home.php",
    "=mode=http",
    "=http-method=post",
    "=http-header-field=Cookie: " + ck + "\r\nContent-Type: application/json",
    "=http-data=" + JSON.stringify({ page: "seller", draw: 1, start: 0, length: 50 }),
    "=output=user-with-headers",
    "=check-certificate=no",
  ]);
  const j = parseJson((r || []).map((x) => x.data || "").join(""));
  const pickApiId = (s) => {
    const blob = JSON.stringify(s);
    const apiId = (String(s.action || "").match(/data-id="(\d+)"/) || blob.match(/data-id\\":\\"(\d+)\\"/) || [])[1];
    if (apiId) return String(apiId);
    if (s.id != null && String(s.id) !== "1") return String(s.id);
    return null;
  };
  const findByName = (target) => {
    const want = String(target || "").trim().toUpperCase();
    if (!want) return null;
    for (const s of j?.data || []) {
      const rowName = stripHtml(s.name || s.seller || "").toUpperCase();
      if (rowName !== want) continue;
      return pickApiId(s);
    }
    return null;
  };
  const primary = findByName(name || "VOUCHER");
  if (primary) return primary;
  for (const fb of fallbackNames || []) {
    const hit = findByName(fb);
    if (hit) return hit;
  }
  if ((j?.data || []).length === 1) {
    const apiId = pickApiId(j.data[0]);
    if (apiId) return apiId;
  }
  return kitifiSellerId(routerId);
}

function rateAmountNum(r) {
  const raw = String(r.amount || "");
  const head = raw.includes("|") ? raw.split("|")[0] : raw;
  return Number(head.replace(/[^\d.]/g, "")) || 0;
}

export function kitifiGenProfile() {
  return Settings.get("kitifi_gen_profile", "KITIFI");
}

export function kitifiGenChar() {
  return Settings.get("kitifi_gen_char", "num"); // Random 1234
}

export function kitifiGenNameLength() {
  return Settings.get("kitifi_gen_name_length", "5");
}

export function kitifiGenPrefix() {
  return Settings.get("kitifi_gen_prefix", "VC");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function removeTmpFiles(conn, needle) {
  try {
    for (const f of (await conn.print("/file")) || []) {
      if (String(f.name || "").includes(needle)) {
        try { await conn.talk(["/file/remove", "=.id=" + f[".id"]]); } catch {}
      }
    }
  } catch {}
}

/**
 * POST JSON to KiTifi via MikroTik /tool/fetch → dst-path, then read file contents.
 * @returns {{ text: string, size: number, cookie: string }}
 */
async function kitifiFetch(conn, { url, method = "post", body = null, cookie = "", fname = "jm-kitifi-tmp.txt" }) {
  await removeTmpFiles(conn, fname.replace(/\.\w+$/, ""));
  const args = [
    "/tool/fetch",
    "=url=" + url,
    "=mode=http",
    "=http-method=" + method,
    "=dst-path=" + fname,
    "=check-certificate=no",
  ];
  // RouterOS keeps one http-header-field — combine Cookie + Content-Type
  const hdrs = [];
  if (cookie) hdrs.push("Cookie: " + cookie);
  if (body != null) {
    hdrs.push("Content-Type: application/json");
    args.push("=http-data=" + (typeof body === "string" ? body : JSON.stringify(body)));
  }
  if (hdrs.length) args.push("=http-header-field=" + hdrs.join("\r\n"));
  let headers = "";
  try {
    // Prefer headers so we can capture Set-Cookie on login
    const withHdr = [...args];
    // RouterOS can't mix dst-path and user-with-headers easily — login uses separate path
    await conn.talk(args);
  } catch (e) {
    // Non-2xx still may write a body
    if (!/status\s+[45]/i.test(e.message || "")) throw e;
  }
  const files = (await conn.print("/file")) || [];
  const f = files.find((x) => String(x.name || "").endsWith(fname) || String(x.name || "").includes(fname));
  return {
    text: f?.contents != null ? String(f.contents) : "",
    size: Number(f?.size || 0),
    cookie,
    headers,
  };
}

/** Login and return PHPSESSID cookie string. */
export async function kitifiLogin(conn, routerId) {
  const base = kitifiAdminBase(routerId);
  const user = kitifiAdminUser();
  const pass = kitifiAdminPass(routerId);
  if (!pass) throw new Error("KiTifi admin password not set (Settings → kitifi_admin_pass).");

  const r = await conn.talk([
    "/tool/fetch",
    "=url=" + base + "/api/login",
    "=mode=http",
    "=http-method=post",
    "=http-header-field=Content-Type: application/json",
    "=http-data=" + JSON.stringify({ username: user, password: pass }),
    "=output=user-with-headers",
    "=check-certificate=no",
  ]);
  const hdr = (r || []).map((x) => x["http-headers"] || "").join(" ");
  const body = (r || []).map((x) => x.data || "").join("");
  const m = hdr.match(/PHPSESSID=[^;\s]+/);
  if (!m) {
    throw new Error("KiTifi login failed — no session cookie. " + (body || hdr).slice(0, 120));
  }
  try {
    const j = JSON.parse(body);
    if (j && j.status === false) throw new Error("KiTifi login rejected.");
  } catch (e) {
    if (e.message && e.message.includes("login")) throw e;
  }
  return m[0];
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Strip HTML from KiTifi table cells. */
function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** All KiTifi voucher generates: no unused-voucher expiration (eday/ehour/emin = 0). */
export function kitifiForceNoExpiry(opts = {}) {
  return { ...opts, eday: "0", ehour: "0", emin: "0" };
}

/**
 * @param {object} conn RouterOSAPI connected to the KiTifi site router
 * @param {object} opts
 */
export async function kitifiRemoteGenerate(conn, opts = {}) {
  opts = kitifiForceNoExpiry(opts);
  const qty = Math.min(Math.max(Number(opts.qty ?? opts.count ?? 1) || 1, 1), 500);
  const cookie = opts.cookie || (await kitifiLogin(conn, opts.routerId));
  const base = kitifiAdminBase(opts.routerId);
  const api = base + "/api/pages/home.php";

  const payload = {
    name_length: String(opts.name_length || kitifiGenNameLength()),
    char: String(opts.char || kitifiGenChar()),
    qty: String(qty), // already clamped; GCash fulfill forces qty=1
    prefix: String(opts.prefix != null ? opts.prefix : kitifiGenPrefix()),
    r_id: String(opts.r_id || opts.rate_id || "1"),
    seller_id: String(opts.seller_id || kitifiSellerId()),
    profile: String(opts.profile || kitifiGenProfile()),
    type: String(opts.type || "default"),
    amount: String(opts.amount || "0"),
    day: String(opts.day || "0"),
    hour: String(opts.hour || "0"),
    min: String(opts.min || "0"),
    eday: "0",
    ehour: "0",
    emin: "0",
    points: String(opts.points || "0"),
    pause_limit: String(opts.pause_limit || "0"),
    action: "generateVoucher",
  };

  const gen = await kitifiFetch(conn, { url: api, body: payload, cookie, fname: "jm-kitifi-gen.txt" });
  const gj = parseJson(gen.text);
  if (!gj || (gj.status !== true && gj.status !== "true")) {
    throw new Error((gj && gj.message) || gen.text || "KiTifi generate failed (empty response).");
  }
  const batch = gj.batch || "";
  if (!batch) throw new Error("KiTifi generate returned no batch code.");

  // Brief pause so KiTifi finishes writing rows
  await sleep(1000);

  // Batch-filtered list first — print page regex can pick up OLD VC codes from the template.
  let codes = await kitifiRemoteListCodes(conn, { batch, cookie, expect: qty, routerId: opts.routerId });
  if (!codes.length) {
    codes = await kitifiRemotePrintCodes(conn, { batch, cookie, prefix: payload.prefix, routerId: opts.routerId });
  }
  codes = codes.slice(0, qty);
  return {
    batch,
    codes,
    count: codes.length,
    message: gj.message || "Process completed!",
    profile: payload.profile,
    seller_id: payload.seller_id,
    r_id: payload.r_id,
    generator: "kitifi-admin-remote",
    cookie,
  };
}

/**
 * Scrape voucher codes from KiTifi print page (?home=print&batch=XXXXX).
 */
export async function kitifiRemotePrintCodes(conn, { batch, cookie, prefix = "", routerId } = {}) {
  if (!batch) return [];
  const ck = cookie || (await kitifiLogin(conn, routerId));
  const url = kitifiAdminBase(routerId) + "/?home=print&batch=" + encodeURIComponent(batch);
  let text = "";
  try {
    const r = await conn.talk([
      "/tool/fetch",
      "=url=" + url,
      "=mode=http",
      "=http-method=get",
      "=http-header-field=Cookie: " + ck,
      "=output=user-with-headers",
      "=check-certificate=no",
    ]);
    text = (r || []).map((x) => x.data || "").join("");
  } catch (e) {
    // Non-2xx may still have body in some RouterOS builds
    text = String(e.message || "");
  }
  if (!text || text.length < 20) {
    const res = await kitifiFetch(conn, { url, method: "get", cookie: ck, fname: "jm-kitifi-print.txt" });
    text = res.text || "";
    if ((!text || text.length < 20) && res.size > 20) {
      text = await readFileChunk(conn, "jm-kitifi-print.txt", 0, Math.min(res.size, 60000));
    }
  }

  const junk = /^(span|div|html|body|head|script|style|table|tbody|thead|tr|td|th|class|style|href|http|https|batch|code|print|voucher|kitifi|unused|used|all)$/i;
  const looksLikeCode = (code) => {
    const c = String(code || "").trim();
    if (c.length < 3 || c.length > 20) return false;
    if (junk.test(c)) return false;
    if (c.toUpperCase() === String(batch).toUpperCase()) return false;
    // Must include a digit (KiTifi random/num codes) or match prefix+alnum
    if (!/\d/.test(c) && !(prefix && c.toUpperCase().startsWith(String(prefix).toUpperCase()))) return false;
    return /^[A-Za-z0-9]+$/.test(c);
  };

  const found = new Set();
  const pref = String(prefix || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (pref) {
    const re = new RegExp("\\b(" + pref + "[0-9A-Za-z]{2,16})\\b", "g");
    for (const m of text.matchAll(re)) if (looksLikeCode(m[1])) found.add(m[1]);
  }
  // Print template: {{ e.vc_code }} often rendered as plain text in a cell/line
  for (const m of text.matchAll(/(?:vc_code|voucher[_ ]?code)[^A-Za-z0-9]{0,24}([A-Za-z0-9]{3,20})/gi)) {
    if (looksLikeCode(m[1])) found.add(m[1]);
  }
  // Fallback: lines that are mostly a short code
  if (!found.size) {
    for (const line of String(text).split(/\r?\n/)) {
      const t = line.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (/^[A-Za-z0-9]{3,16}$/.test(t) && looksLikeCode(t)) found.add(t);
    }
  }
  return [...found];
}

/**
 * List voucher codes for a batch (DataTables page=generate + filter=batch).
 */
export async function kitifiRemoteListCodes(conn, { batch, cookie, expect = 50, routerId } = {}) {
  if (!batch) return [];
  const ck = cookie || (await kitifiLogin(conn, routerId));
  const api = kitifiAdminBase(routerId) + "/api/pages/home.php";
  const length = Math.min(Math.max(Number(expect) || 50, 1), 500);
  const colNames = ["id", "type", "code", "profile", "status", "amount", "time", "expiry", "pause_limit", "created", "seller_id", "batch_code", "time_used"];

  const body = {
    page: "generate",
    filter: String(batch),
    draw: 1,
    start: 0,
    length,
    order: [{ column: 9, dir: "desc" }],
    search: { value: "", regex: false },
    columns: colNames.map((data, i) => ({
      data,
      name: "",
      searchable: true,
      orderable: i !== 0,
      search: { value: "", regex: false },
    })),
  };

  // Prefer user-with-headers (dst-path often empty for this endpoint)
  try {
    const r = await conn.talk([
      "/tool/fetch",
      "=url=" + api,
      "=mode=http",
      "=http-method=post",
      "=http-header-field=Cookie: " + ck + "\r\nContent-Type: application/json",
      "=http-data=" + JSON.stringify(body),
      "=output=user-with-headers",
      "=check-certificate=no",
    ]);
    const text = (r || []).map((x) => x.data || "").join("");
    const j = parseJson(text);
    if (j && Array.isArray(j.data)) {
      return j.data.map((row) => stripHtml(row.code || row.voucher || "")).filter(Boolean);
    }
    const found = [...String(text || "").matchAll(/"code"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    if (found.length) return [...new Set(found)];
  } catch {}

  const res = await kitifiFetch(conn, { url: api, body, cookie: ck, fname: "jm-kitifi-list.txt" });
  let text = res.text;
  if ((!text || text.length < 20) && res.size > 20) {
    text = await readFileChunk(conn, "jm-kitifi-list.txt", 0, Math.min(res.size, 60000));
  }
  const j = parseJson(text);
  if (!j || !Array.isArray(j.data)) {
    const found = [...String(text || "").matchAll(/"code"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    return [...new Set(found)];
  }
  return j.data.map((row) => stripHtml(row.code || row.voucher || "")).filter(Boolean);
}

async function readFileChunk(conn, name, start, len) {
  const SCRIPT = "jm-kitifi-pick";
  const src = [
    `:local id [/file find name~"${name.replace(/"/g, "")}"]`,
    `:if ([:len $id] = 0) do={ :put ""; :return }`,
    `:local data [/file get $id contents]`,
    `:local total [:len $data]`,
    `:local s ${Number(start) || 0}`,
    `:local e ($s + ${Number(len) || 8000})`,
    `:if ($e > $total) do={ :set e $total }`,
    `:if ($s >= $total) do={ :put ""; :return }`,
    `:put [:pick $data $s $e]`,
  ].join("\r\n");
  try { await conn.talk(["/system/script/remove", "=.id=" + SCRIPT]); } catch {}
  try {
    await conn.talk(["/system/script/add", "=name=" + SCRIPT, "=policy=read,write,policy,test", "=source=" + src]);
    const r = await conn.talk(["/system/script/run", "=number=" + SCRIPT]);
    let out = "";
    for (const item of r || []) if (item?.ret != null) out += String(item.ret);
    return out;
  } catch {
    return "";
  } finally {
    try { await conn.talk(["/system/script/remove", "=.id=" + SCRIPT]); } catch {}
  }
}

function parseGetratesRow(r) {
  const parts = String(r.amount || "").split("|").map((s) => s.trim());
  return {
    id: String(r.id),
    amount: parts[0] || stripHtml(r.amount),
    time: parts[1] || "",
    expiry: parts[2] || "N/A",
    pause_limit: parts[3] || "0",
    points: r.points || 0,
  };
}

function normalizeRemoteRate(r) {
  return {
    id: String(r.id),
    amount: stripHtml(r.amount),
    time: stripHtml(r.time),
    expiry: stripHtml(r.expiry || "N/A"),
    pause_limit: stripHtml(r.pause_limit || "0"),
    points: r.points || 0,
  };
}

/** Fetch VOUCHER Seller rates from KiTifi (getrates on the selected seller station). */
export async function kitifiRemoteRates(conn, cookie, opts = {}) {
  const ck = cookie || (await kitifiLogin(conn, opts.routerId));
  const sellerId = String(opts.seller_id || kitifiSellerId(opts.routerId));
  const base = kitifiAdminBase(opts.routerId);
  const byId = new Map();

  const addRows = (rows) => {
    for (const r of rows || []) {
      if (!r?.id) continue;
      const n = String(r.amount || "").includes("|") ? parseGetratesRow(r) : normalizeRemoteRate(r);
      byId.set(n.id, n);
    }
  };

  for (const body of [
    { page: "rates", seller_id: sellerId },
    { page: "rates", draw: 1, start: 0, length: 100, seller_id: sellerId },
  ]) {
    const res = await kitifiFetch(conn, {
      url: base + "/api/pages/home.php",
      body,
      cookie: ck,
      fname: "jm-kitifi-rates.txt",
    });
    const j = parseJson(res.text);
    addRows(j?.data);
  }

  const gr = await kitifiFetch(conn, {
    url: base + "/api/pages/home.php",
    body: { id: sellerId, action: "getrates" },
    cookie: ck,
    fname: "jm-kitifi-getrates.txt",
  });
  const gj = parseJson(gr.text);
  addRows(gj?.rates || gj?.data);

  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

function parseKitifiDuration(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s || s === "n/a") return { day: 0, hour: 0, min: 0 };
  const compact = s.match(/^(\d+)\s*(h|d|m)$/);
  if (compact) {
    const n = Number(compact[1]) || 0;
    if (compact[2] === "h") return { day: 0, hour: n, min: 0 };
    if (compact[2] === "d") return { day: n, hour: 0, min: 0 };
    return { day: 0, hour: 0, min: n };
  }
  const n = parseInt(s, 10) || 0;
  if (/minute/.test(s)) return { day: 0, hour: 0, min: n };
  if (/hour/.test(s)) return { day: 0, hour: n, min: 0 };
  if (/day/.test(s)) return { day: n, hour: 0, min: 0 };
  return { day: 0, hour: 0, min: 0 };
}

function parseKitifiExpiry(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s || s === "n/a") return { eday: 0, ehour: 0, emin: 0 };
  const n = parseInt(s, 10) || 0;
  if (/minute/.test(s)) return { eday: 0, ehour: 0, emin: n };
  if (/hour/.test(s)) return { eday: 0, ehour: n, emin: 0 };
  if (/day/.test(s)) return { eday: n, ehour: 0, emin: 0 };
  return { eday: 0, ehour: 0, emin: 0 };
}

/**
 * GCash via VOUCHER seller rates (r4/r5): use default type so Station = VOUCHER
 * and time comes from Wifi Rates row (same as Candelaria KiTifi UI Generate).
 * Custom type leaves Station blank and skips rate binding.
 */
export function kitifiUseCustomGenerate(plan, rateId) {
  const rid = String(rateId || plan?.kitifi_rate_id || plan?.r_id || "");
  if (rid === "4" || rid === "5") return false;
  const price = Number(plan?.price ?? plan?.amount ?? 0);
  if (price >= 20 && rid) return false;
  if (price >= 20) return true;
  if (rid && Number(rid) > 3) return true;
  return false;
}

/** Build custom generateVoucher fields from a jmwifi plan (keeps VOUCHER station). */
export function planToCustomGenerateFields(plan = {}) {
  let time = plan.time || plan.uptime || plan.name || "";
  let expiry = plan.expiry || "";
  let pause = plan.pause_limit;
  const labelParts = String(plan.label || "").split("|").map((s) => s.trim()).filter(Boolean);
  if (labelParts.length >= 4) {
    if (!time || time === plan.name) time = labelParts[1] || time;
    if (!expiry || expiry === "N/A") expiry = labelParts[2] || expiry;
    if (pause == null || pause === "") pause = labelParts[3];
  }
  const dur = parseKitifiDuration(time);
  let pauseStr = String(pause ?? "0").trim();
  if (/no pause/i.test(pauseStr)) pauseStr = "0";
  else if (!/^\d+$/.test(pauseStr)) pauseStr = "0";
  return {
    type: "custom",
    r_id: "0",
    amount: String(Number(plan.price ?? plan.amount ?? 0) || 0),
    day: String(dur.day || 0),
    hour: String(dur.hour || 0),
    min: String(dur.min || 0),
    eday: "0",
    ehour: "0",
    emin: "0",
    points: "0",
    pause_limit: pauseStr,
  };
}

/** Map a jmwifi plan / amount to KiTifi rate id when possible. */
export function resolveKitifiRateId({ plan, r_id, amount }) {
  if (r_id != null && r_id !== "") return String(r_id);
  if (plan?.kitifi_rate_id) return String(plan.kitifi_rate_id);
  if (plan?.r_id) return String(plan.r_id);
  // Default first WiFi rate in KiTifi (₱1 / 12 min) — override via body.r_id
  return Settings.get("kitifi_default_rate_id", "1");
}

/** Resolve live KiTifi Wifi Rate id for a price on the VOUCHER seller (getrates). */
export async function kitifiResolveLiveRateId(conn, { price, seller_id, routerId, cookie } = {}) {
  const target = Number(price) || 0;
  if (target < 1) return "";
  const sid = String(seller_id || kitifiSellerId(routerId));
  const rates = await kitifiRemoteRates(conn, cookie, { seller_id: sid, routerId });
  const match = rates.find((r) => rateAmountNum(r) === target);
  return match?.id != null ? String(match.id) : "";
}
