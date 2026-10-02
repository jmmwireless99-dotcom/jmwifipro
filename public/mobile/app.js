import { APPLY_COVERAGE } from "/lib/apply-coverage.mjs?v=6";
import {
  isSalesMonthEditable,
  salesMonthLockReason,
  monthNow as lockMonthNow,
} from "/lib/sales-history-lock.mjs?v=6";

const STORAGE_KEY = "jm_sales_history_vendos_v1";
const FILTER_KEY = "jm_sales_mobile_month";
const $ = (id) => document.getElementById(id);

const state = {
  tab: "home",
  muni: null,
  brgy: null,
  entries: [],
  month: "",
  editId: null,
  q: "",
  deferredPrompt: null,
  user: null,
};

/** Union of apply-coverage + barangays that already have encoded sales. */
function coverageTree() {
  const tree = {};
  for (const [m, list] of Object.entries(APPLY_COVERAGE)) {
    tree[m] = new Set(list);
  }
  for (const e of state.entries) {
    const m = String(e.municipality || "").toUpperCase().trim();
    const b = String(e.barangay || "").toUpperCase().trim();
    if (!m || !b) continue;
    if (!tree[m]) tree[m] = new Set();
    tree[m].add(b);
  }
  const out = {};
  for (const m of Object.keys(tree).sort()) {
    out[m] = [...tree[m]].sort();
  }
  return out;
}

function showLogin(msg = "") {
  state.user = null;
  $("app-shell").hidden = true;
  $("fab").classList.remove("show");
  $("login-gate").classList.add("open");
  $("login-err").textContent = msg || "";
}
function showApp(user) {
  state.user = user;
  $("login-gate").classList.remove("open");
  $("app-shell").hidden = false;
}
async function checkAuth() {
  try {
    const r = await fetch("/api/sales-history/me", { credentials: "same-origin" });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok && d.user) return d.user;
  } catch {}
  return null;
}
async function doLogin(username, password) {
  const r = await fetch("/api/sales-history/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(d.error || "Login failed");
  return d.user;
}
async function doLogout() {
  await fetch("/api/sales-history/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  showLogin("");
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function peso(n) {
  return "₱" + Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });
}

function monthNow() {
  return lockMonthNow();
}

function entryMonth(e) {
  return String(e?.month || (e?.date || "").slice(0, 7) || "");
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function loadLocal() {
  try {
    const a = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function saveLocal(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

async function loadEntries() {
  try {
    const r = await fetch("/api/sales-history", { credentials: "same-origin" });
    if (r.status === 401) {
      showLogin("Please login again.");
      throw new Error("login");
    }
    if (r.ok) {
      const d = await r.json();
      if (d && Array.isArray(d.entries)) {
        state.entries = d.entries;
        saveLocal(d.entries);
        return;
      }
    }
  } catch (e) {
    if (e && e.message === "login") throw e;
  }
  state.entries = loadLocal();
}

async function apiJson(method, body, qs = "") {
  const r = await fetch("/api/sales-history" + qs, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || d.needLogin) {
    showLogin("Session expired. Login again.");
    throw new Error("Login required");
  }
  if (!r.ok || d.ok === false) {
    throw new Error(d.error || "HTTP " + r.status);
  }
  return d;
}

async function persistEntry(entry) {
  const d = await apiJson("POST", entry);
  const saved = d.entry || entry;
  state.entries = [saved, ...state.entries.filter((e) => e.id !== saved.id)];
  saveLocal(state.entries);
  return saved;
}

async function updateEntry(entry) {
  const d = await apiJson("PUT", entry);
  const saved = d.entry || entry;
  state.entries = state.entries.map((e) => (e.id === saved.id ? saved : e));
  saveLocal(state.entries);
  return saved;
}

async function removeEntry(id) {
  await apiJson("DELETE", null, "?id=" + encodeURIComponent(id));
  state.entries = state.entries.filter((e) => e.id !== id);
  saveLocal(state.entries);
}

function filteredEntries() {
  if (!state.month) return state.entries;
  return state.entries.filter((e) => entryMonth(e) === state.month);
}

function entriesFor(muni, brgy) {
  return filteredEntries().filter(
    (e) =>
      String(e.municipality).toUpperCase() === muni &&
      String(e.barangay).toUpperCase() === brgy
  );
}

function encodeMonth() {
  return state.month || monthNow();
}

function knownVendoNames(muni, brgy) {
  const set = new Set();
  for (const e of state.entries) {
    if (String(e.municipality).toUpperCase() !== muni) continue;
    if (String(e.barangay).toUpperCase() !== brgy) continue;
    const v = String(e.vendo || "").trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function vendoEncodeRows(muni, brgy) {
  const ym = encodeMonth();
  const names = knownVendoNames(muni, brgy);
  const byName = new Map();
  for (const e of state.entries) {
    if (String(e.municipality).toUpperCase() !== muni) continue;
    if (String(e.barangay).toUpperCase() !== brgy) continue;
    if (entryMonth(e) !== ym) continue;
    const v = String(e.vendo || "").trim();
    if (!v) continue;
    if (!byName.has(v)) byName.set(v, e);
  }
  return names.map((vendo) => {
    const entry = byName.get(vendo) || null;
    return {
      vendo,
      month: ym,
      entry,
      amount: entry ? Number(entry.amount) || 0 : null,
      pending: !entry,
    };
  });
}

function canEdit(e) {
  return isSalesMonthEditable(entryMonth(e));
}

function formatMonthLabel(ym) {
  if (!ym) return "All months";
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleString("en-PH", {
    month: "long",
    year: "numeric",
  });
}

function setMonth(ym) {
  state.month = ym || "";
  try {
    localStorage.setItem(FILTER_KEY, state.month);
  } catch {}
  $("flt-month").value = state.month;
  render();
}

function openEncodeSheet(vendoName, { allowNewName = false } = {}) {
  $("form-err").textContent = "";
  const ym = encodeMonth();
  const name = String(vendoName || "").trim();
  const existing = name
    ? state.entries.find(
        (e) =>
          String(e.municipality).toUpperCase() === state.muni &&
          String(e.barangay).toUpperCase() === state.brgy &&
          String(e.vendo || "").trim() === name &&
          entryMonth(e) === ym
      )
    : null;
  state.editId = existing ? existing.id : null;
  const lockedName = !!name && !allowNewName;
  $("sheet-title").textContent = existing
    ? "Edit amount"
    : lockedName
      ? "Encode amount"
      : "New vendo name";
  $("sheet-where").textContent =
    state.muni + " › " + state.brgy + " · " + formatMonthLabel(ym);
  $("btn-save").textContent = "Save amount";
  if (!isSalesMonthEditable(ym)) {
    $("form-err").textContent = salesMonthLockReason(ym);
  }
  const d = new Date();
  const day =
    existing && existing.date
      ? existing.date.slice(8, 10)
      : ym !== monthNow()
        ? "01"
        : String(d.getDate()).padStart(2, "0");
  $("f-vendo").value = name;
  $("f-vendo").readOnly = lockedName;
  $("f-month").value = ym;
  $("f-month").readOnly = lockedName;
  $("f-date").value = existing?.date || `${ym}-${day}`;
  $("f-amount").value = existing ? String(Number(existing.amount) || 0) : "";
  $("sheet-backdrop").classList.add("open");
  $("sheet").classList.add("open");
  setTimeout(() => (lockedName ? $("f-amount") : $("f-vendo")).focus(), 50);
}

function openSheet(entry = null) {
  if (entry) openEncodeSheet(entry.vendo);
  else openEncodeSheet("", { allowNewName: true });
}

function closeSheet() {
  state.editId = null;
  $("f-vendo").readOnly = false;
  $("f-month").readOnly = false;
  $("sheet-backdrop").classList.remove("open");
  $("sheet").classList.remove("open");
}

function renderKpis() {
  const view = filteredEntries();
  const munis = Object.keys(coverageTree()).length;
  const total = view.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  $("k-muni").textContent = String(munis);
  $("k-rows").textContent = String(view.length);
  $("k-sales").textContent = peso(total);
}

function renderCrumbs() {
  const parts = [];
  parts.push(`<button type="button" data-crumb="root">Areas</button>`);
  if (state.muni) {
    parts.push(`<span>›</span><button type="button" data-crumb="muni">${esc(state.muni)}</button>`);
  }
  if (state.brgy) {
    parts.push(`<span>›</span><span class="here">${esc(state.brgy)}</span>`);
  }
  $("crumbs").innerHTML = parts.join("");
  $("crumbs").querySelectorAll("[data-crumb]").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.crumb === "root") {
        state.muni = null;
        state.brgy = null;
      } else if (btn.dataset.crumb === "muni") {
        state.brgy = null;
      }
      render();
    };
  });
}

function renderMunicipalities() {
  const q = state.q.trim().toUpperCase();
  const tree = coverageTree();
  const list = Object.keys(tree).filter((n) => !q || n.includes(q));
  if (!list.length) {
    $("list").innerHTML = `<div class="empty"><strong>Walang match</strong>Subukan ang ibang search.</div>`;
    return;
  }
  $("list").innerHTML = list
    .map((muni) => {
      const brgys = tree[muni] || [];
      const rows = filteredEntries().filter((e) => String(e.municipality).toUpperCase() === muni);
      const sales = rows.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const vendos = new Set(rows.map((e) => e.vendo)).size;
      return `<button type="button" class="row" data-muni="${esc(muni)}">
        <div class="avatar">${esc(muni.slice(0, 2))}</div>
        <div class="meta"><strong>${esc(muni)}</strong><span>${brgys.length} locations · ${vendos} vendos</span></div>
        <div class="right"><div class="amt">${peso(sales)}</div><div class="sub">total</div></div>
        <span class="chev">›</span>
      </button>`;
    })
    .join("");
  $("list").querySelectorAll("[data-muni]").forEach((btn) => {
    btn.onclick = () => {
      state.muni = btn.dataset.muni;
      state.brgy = null;
      state.q = "";
      $("search").value = "";
      render();
    };
  });
}

function renderBarangays() {
  const q = state.q.trim().toUpperCase();
  const tree = coverageTree();
  const ym = encodeMonth();
  const brgys = (tree[state.muni] || []).filter((b) => !q || b.includes(q));
  if (!brgys.length) {
    $("list").innerHTML = `<div class="empty"><strong>Walang barangay</strong></div>`;
    return;
  }
  $("list").innerHTML = brgys
    .map((brgy) => {
      const names = knownVendoNames(state.muni, brgy);
      const rows = vendoEncodeRows(state.muni, brgy);
      const encoded = rows.filter((r) => !r.pending && Number(r.amount) > 0).length;
      const sales = rows.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      return `<button type="button" class="row" data-brgy="${esc(brgy)}">
        <div class="avatar">${esc(brgy.slice(0, 2))}</div>
        <div class="meta"><strong>${esc(brgy)}</strong><span>${names.length} vendos · ${encoded} encoded · ${esc(formatMonthLabel(ym))}</span></div>
        <div class="right"><div class="amt">${peso(sales)}</div><div class="sub">total</div></div>
        <span class="chev">›</span>
      </button>`;
    })
    .join("");
  $("list").querySelectorAll("[data-brgy]").forEach((btn) => {
    btn.onclick = () => {
      state.brgy = btn.dataset.brgy;
      state.q = "";
      $("search").value = "";
      render();
    };
  });
}

function renderVendos() {
  const ym = encodeMonth();
  const rows = vendoEncodeRows(state.muni, state.brgy);
  if (!rows.length) {
    $("list").innerHTML = `<div class="empty"><strong>Walang vendo pa</strong>Pindutin ang + New vendo name, tapos amount na lang sa susunod.</div>`;
    return;
  }
  const unlocked = isSalesMonthEditable(ym);
  const tip = unlocked ? "" : esc(salesMonthLockReason(ym));
  $("list").innerHTML = rows
    .map((r) => {
      const status = !unlocked
        ? "Locked"
        : r.pending
          ? "Need amount"
          : Number(r.amount) > 0
            ? "Encoded"
            : "₱0";
      const amt = r.pending ? "—" : peso(r.amount);
      const encodeLabel = r.pending || !(Number(r.amount) > 0) ? "₱ Amount" : "✏️ Edit amount";
      const delBtn = r.entry
        ? `<button type="button" class="del" data-del="${esc(r.entry.id)}" ${unlocked ? "" : "disabled"} title="${tip}">🗑 Delete</button>`
        : "";
      return `<article class="vendo-card" data-vendo="${esc(r.vendo)}">
        <div class="head">
          <h3>${esc(r.vendo)}</h3>
          <div class="amt">${amt}</div>
        </div>
        <div class="info">
          <span class="pill">${esc(ym)}</span>
          <span class="pill ${unlocked && !r.pending && Number(r.amount) > 0 ? "ok" : unlocked ? "" : "lock"}">${status}</span>
        </div>
        <div class="actions">
          <button type="button" class="edit" data-encode="${esc(r.vendo)}" ${unlocked ? "" : "disabled"} title="${tip}">${encodeLabel}</button>
          ${delBtn}
        </div>
      </article>`;
    })
    .join("");

  $("list").querySelectorAll("[data-encode]").forEach((btn) => {
    btn.onclick = () => openEncodeSheet(btn.dataset.encode);
  });
  $("list").querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      const entry = state.entries.find((e) => e.id === btn.dataset.del);
      if (!entry) return;
      if (!canEdit(entry)) return toast(salesMonthLockReason(entryMonth(entry)));
      if (!confirm(`Delete "${entry.vendo}" (${peso(entry.amount)})?`)) return;
      try {
        await removeEntry(entry.id);
        toast("Deleted");
        render();
      } catch (err) {
        toast(err.message || "Delete failed");
      }
    };
  });
}

function renderHome() {
  $("home-view").hidden = false;
  $("month-view").hidden = true;
  $("about-view").hidden = true;
  $("search-wrap").hidden = !!state.brgy;
  $("search").placeholder = state.muni
    ? "Search barangay…"
    : "Search municipality…";
  renderCrumbs();
  renderKpis();
  if (!state.muni) renderMunicipalities();
  else if (!state.brgy) renderBarangays();
  else renderVendos();

  const showFab = !!(state.muni && state.brgy);
  $("fab").classList.toggle("show", showFab);
  if (showFab) {
    const addMonth = encodeMonth();
    $("fab").disabled = !isSalesMonthEditable(addMonth);
    $("fab").title = isSalesMonthEditable(addMonth)
      ? "Add a new vendo name"
      : salesMonthLockReason(addMonth);
  }
}

function renderMonthTab() {
  $("home-view").hidden = true;
  $("month-view").hidden = false;
  $("about-view").hidden = true;
  $("fab").classList.remove("show");
  const byMonth = new Map();
  for (const e of state.entries) {
    const m = entryMonth(e) || "unknown";
    if (!byMonth.has(m)) byMonth.set(m, { count: 0, sales: 0 });
    const g = byMonth.get(m);
    g.count += 1;
    g.sales += Number(e.amount) || 0;
  }
  const months = [...byMonth.keys()].sort().reverse();
  if (!months.length) {
    $("month-list").innerHTML = `<div class="empty"><strong>Walang sales pa</strong>Mag-encode muna sa Areas.</div>`;
    return;
  }
  $("month-list").innerHTML = months
    .map((m) => {
      const g = byMonth.get(m);
      const unlocked = isSalesMonthEditable(m);
      return `<button type="button" class="row" data-month="${esc(m)}">
        <div class="avatar">${esc((m || "").slice(5, 7) || "?")}</div>
        <div class="meta">
          <strong>${esc(formatMonthLabel(m))}</strong>
          <span>${g.count} entries · ${unlocked ? "Editable" : "Locked"}</span>
        </div>
        <div class="right"><div class="amt">${peso(g.sales)}</div><div class="sub">filter</div></div>
        <span class="chev">›</span>
      </button>`;
    })
    .join("");
  $("month-list").querySelectorAll("[data-month]").forEach((btn) => {
    btn.onclick = () => {
      setMonth(btn.dataset.month);
      setTab("home");
    };
  });
}

function renderAbout() {
  $("home-view").hidden = true;
  $("month-view").hidden = true;
  $("about-view").hidden = false;
  $("fab").classList.remove("show");
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".bottom-nav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  if (tab === "home") renderHome();
  else if (tab === "month") renderMonthTab();
  else renderAbout();
}

function render() {
  if (state.tab === "home") renderHome();
  else if (state.tab === "month") renderMonthTab();
  else renderAbout();
  updateInstallBanner();
}

function updateInstallBanner() {
  const banner = $("install-banner");
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  banner.classList.toggle("show", !standalone && (!!state.deferredPrompt || isIos()));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

async function refresh() {
  await loadEntries();
  render();
  toast("Refreshed");
}

$("btn-refresh").onclick = () => refresh();
$("fab").onclick = () => openEncodeSheet("", { allowNewName: true });
$("btn-cancel").onclick = closeSheet;
$("sheet-backdrop").onclick = closeSheet;
$("btn-all-months").onclick = () => setMonth("");
$("flt-month").addEventListener("change", (e) => setMonth(e.target.value || ""));
$("search").addEventListener("input", (e) => {
  state.q = e.target.value || "";
  renderHome();
});

document.querySelectorAll(".bottom-nav button").forEach((btn) => {
  btn.onclick = () => setTab(btn.dataset.tab);
});

$("add-form").onsubmit = async (e) => {
  e.preventDefault();
  $("form-err").textContent = "";
  const vendo = $("f-vendo").value.trim();
  const month = $("f-month").value;
  let date = $("f-date").value;
  const amount = Number($("f-amount").value);
  if (!vendo) return ($("form-err").textContent = "Lagyan ng vendo name.");
  if (!month) return ($("form-err").textContent = "Piliin ang month.");
  if (!(amount >= 0)) return ($("form-err").textContent = "Invalid sales amount.");
  if (!isSalesMonthEditable(month)) {
    return ($("form-err").textContent = salesMonthLockReason(month));
  }
  if (!date) date = month + "-01";
  if (date.slice(0, 7) !== month) date = month + "-01";
  try {
    if (state.editId) {
      await updateEntry({
        id: state.editId,
        municipality: state.muni,
        barangay: state.brgy,
        vendo,
        month,
        date,
        amount,
      });
      toast("Amount updated");
    } else {
      await persistEntry({
        id: "sh_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        municipality: state.muni,
        barangay: state.brgy,
        vendo,
        month,
        date,
        amount,
        createdAt: new Date().toISOString(),
      });
      toast("Amount saved");
    }
    closeSheet();
    if (state.month && state.month !== month) setMonth(month);
    else render();
  } catch (err) {
    $("form-err").textContent = err.message || "Save failed";
  }
};

$("btn-install").onclick = async () => {
  if (state.deferredPrompt) {
    state.deferredPrompt.prompt();
    const choice = await state.deferredPrompt.userChoice.catch(() => null);
    state.deferredPrompt = null;
    updateInstallBanner();
    if (choice?.outcome === "accepted") toast("Installed");
    return;
  }
  if (isIos()) {
    toast("Share → Add to Home Screen");
    return;
  }
  toast("Gamitin ang browser Install / Add to Home Screen");
};

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.deferredPrompt = e;
  updateInstallBanner();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/mobile/sw.js").catch(() => {});
}

$("btn-logout").onclick = () => doLogout();
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  $("login-err").textContent = "";
  $("login-btn").disabled = true;
  try {
    const user = await doLogin($("login-user").value.trim(), $("login-pass").value);
    showApp(user);
    await loadEntries();
    setTab("home");
    toast("Welcome, " + (user.username || "admin"));
  } catch (err) {
    $("login-err").textContent = err.message || "Login failed";
  } finally {
    $("login-btn").disabled = false;
  }
};

try {
  state.month = localStorage.getItem(FILTER_KEY) || "";
} catch {
  state.month = "";
}
$("flt-month").value = state.month;

const user = await checkAuth();
if (!user) {
  showLogin("");
  $("login-user").value = "admin";
  setTimeout(() => $("login-pass").focus(), 40);
} else {
  showApp(user);
  await loadEntries();
  setTab("home");
}
