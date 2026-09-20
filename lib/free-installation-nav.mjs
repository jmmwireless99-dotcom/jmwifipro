/** Sidebar + job-order patches for the Free Installation module. */

export const NAV_OLD = `  <button id="nav-joborders" onclick="showView('joborders')"><span class="ico">📋</span>Job Orders</button>
  <button id="nav-techs" onclick="showView('techs')"><span class="ico">👷</span>Tech Team</button>`;

export const NAV_NEW = `  <button id="nav-joborders" onclick="showView('joborders')"><span class="ico">📋</span>Job Orders</button>
  <button id="nav-freeinstall" onclick="showView('freeinstall')"><span class="ico">🆓</span>Free Installation</button>
  <button id="nav-techs" onclick="showView('techs')"><span class="ico">👷</span>Tech Team</button>`;

export const VIEW_OLD = `</div><!-- /view-joborders -->

<div id="view-techs" class="hidden">`;

export const VIEW_NEW = `</div><!-- /view-joborders -->

<div id="view-freeinstall" class="hidden">
  <section class="bgrid">
    <div class="bcard"><div class="k">New free installs</div><div class="v" id="fi-k-applied">—</div></div>
    <div class="bcard"><div class="k">In progress</div><div class="v" id="fi-k-prog">—</div></div>
    <div class="bcard"><div class="k">Completed</div><div class="v" id="fi-k-done">—</div></div>
    <div class="bcard"><div class="k">Total</div><div class="v" id="fi-k-total">—</div></div>
  </section>
  <div class="panel">
    <h2>Free Installation
      <span style="display:flex;gap:8px;align-items:center">
        <select id="fi-filter" onchange="loadFreeInstalls()" style="background:var(--bg);border:1px solid var(--line);color:var(--text);padding:6px 8px;border-radius:7px;font-size:12px">
          <option value="">All</option><option value="applied">New (applied)</option><option value="assigned">Assigned</option><option value="released">Released</option><option value="installed">Installed</option><option value="completed">Completed</option><option value="rejected">Rejected</option></select>
        <button class="refresh" onclick="openJoCreate({free:true})" style="background:var(--grad);color:#fff;border-color:transparent;font-weight:700">+ Free Installation</button>
        <button class="refresh" onclick="loadFreeInstalls()">⟳ refresh</button>
      </span>
    </h2>
    <div style="padding:9px 16px 0;font-family:var(--sans);font-size:12px;color:var(--muted)">Promo / no-charge installs — ₱0 installation fee. Same pipeline as Job Orders (assign → release → sign-off). Marked <b>FREE-INSTALL</b>.</div>
    <div class="scroll" style="max-height:560px"><table><thead><tr><th>#</th><th>Applicant</th><th>Plan</th><th>Payment</th><th>Status</th><th>Crew</th><th>Actions</th></tr></thead><tbody id="fi-rows"><tr><td colspan=7 class=empty>—</td></tr></tbody></table></div>
  </div>
</div><!-- /view-freeinstall -->

<div id="view-techs" class="hidden">`;

export const VIEWS_OLD = `const VIEWS = ["ops", "clients", "inventory", "joborders", "techs", "expenses", "map", "routers", "plans", "hotspot", "referrals", "helpdesk", "sms", "reports"];`;
export const VIEWS_NEW = `const VIEWS = ["ops", "clients", "inventory", "joborders", "freeinstall", "techs", "expenses", "map", "routers", "plans", "hotspot", "referrals", "helpdesk", "sms", "reports"];`;

export const SHOW_OLD = `  if (name === "joborders") { loadJobOrders(); }`;
export const SHOW_NEW = `  if (name === "joborders") { loadJobOrders(); }
  if (name === "freeinstall") { loadFreeInstalls(); }`;

export const ROLES_OLD = `  cashier: ["ops", "clients", "plans", "hotspot", "joborders", "techs", "inventory", "expenses", "referrals", "helpdesk", "sms", "reports", "map", "routers"],
  technician: ["joborders", "techs", "inventory", "hotspot", "referrals", "map", "helpdesk"],
  staff: ["ops", "clients", "hotspot", "joborders", "techs", "inventory", "referrals", "helpdesk", "map"],
  helper: ["clients", "inventory", "hotspot", "joborders", "techs", "referrals", "helpdesk", "map"],
  agent: ["ops", "clients", "hotspot", "joborders", "referrals", "helpdesk", "map"],`;

export const ROLES_NEW = `  cashier: ["ops", "clients", "plans", "hotspot", "joborders", "freeinstall", "techs", "inventory", "expenses", "referrals", "helpdesk", "sms", "reports", "map", "routers"],
  technician: ["joborders", "freeinstall", "techs", "inventory", "hotspot", "referrals", "map", "helpdesk"],
  staff: ["ops", "clients", "hotspot", "joborders", "freeinstall", "techs", "inventory", "referrals", "helpdesk", "map"],
  helper: ["clients", "inventory", "hotspot", "joborders", "freeinstall", "techs", "referrals", "helpdesk", "map"],
  agent: ["ops", "clients", "hotspot", "joborders", "freeinstall", "referrals", "helpdesk", "map"],`;

export const OPEN_OLD = `  _jocDefaultInstall = settingsR.ok ? Number(settingsR.data.install_fee || 0) : 0;
  _jocDefaultRouter = settingsR.ok ? Number(settingsR.data.router_cost || 0) : 0;`;

export const OPEN_NEW = `  _jocFreeInstall = !!preset.free;
  _jocDefaultInstall = _jocFreeInstall ? 0 : (settingsR.ok ? Number(settingsR.data.install_fee || 0) : 0);
  _jocDefaultRouter = settingsR.ok ? Number(settingsR.data.router_cost || 0) : 0;`;

export const OPEN_TITLE_OLD = `  $("jo-create-title").textContent = preset.job_type === "router_install_repair" ? "Router job — today" : "Manual job order";`;
export const OPEN_TITLE_NEW = `  if (_jocFreeInstall) $("joc-mark-order").value = "FREE-INSTALL";
  $("jo-create-title").textContent = _jocFreeInstall ? "Free Installation" : (preset.job_type === "router_install_repair" ? "Router job — today" : "Manual job order");
  if (_jocFreeInstall) document.querySelectorAll(".joc-item-install").forEach((el) => { el.value = "0"; });`;

export const PLANFEE_OLD = `  const planFee = Number(p && p.installation_fee) || 0;
  feeEl.value = planFee > 0 ? planFee : (_jocDefaultInstall || "");`;
export const PLANFEE_NEW = `  if (typeof _jocFreeInstall !== "undefined" && _jocFreeInstall) { feeEl.value = 0; return; }
  const planFee = Number(p && p.installation_fee) || 0;
  feeEl.value = planFee > 0 ? planFee : (_jocDefaultInstall || "");`;

export const SAVE_OLD = `    techs: _jocStaff.map(s => ({ staff_id: s.staff_id, tech_name: s.tech_name, role: s.role })),
    items,
  };`;
export const SAVE_NEW = `    techs: _jocStaff.map(s => ({ staff_id: s.staff_id, tech_name: s.tech_name, role: s.role })),
    items,
  };
  if (typeof _jocFreeInstall !== "undefined" && _jocFreeInstall) {
    body.marking_order = body.marking_order || "FREE-INSTALL";
    body.install_fee = 0;
    body.items = items.map((it) => Object.assign({}, it, { install_fee: 0 }));
  }`;

export const SAVE_RELOAD_OLD = `  $("jo-create-modal").classList.add("hidden");
  loadJobOrders();
  openJobOrder(r.data.id);`;
export const SAVE_RELOAD_NEW = `  $("jo-create-modal").classList.add("hidden");
  loadJobOrders();
  if (typeof loadFreeInstalls === "function") loadFreeInstalls();
  openJobOrder(r.data.id);`;

export const JO_VARS_OLD = `let _joAll = [], _joJobTypes = [], _joItemStatuses = [], _joTechRoles = [], _jocStaff = [], _jocItemSeq = 0, _jocDefaultInstall = 0, _jocDefaultRouter = 0;`;
export const JO_VARS_NEW = `let _joAll = [], _joJobTypes = [], _joItemStatuses = [], _joTechRoles = [], _jocStaff = [], _jocItemSeq = 0, _jocDefaultInstall = 0, _jocDefaultRouter = 0, _jocFreeInstall = false, _fiAll = [];`;

export const FI_JS = `
async function loadFreeInstalls() {
  try { const tr = await api("/api/billing/techs"); if (tr.ok) { _techs = tr.data.techs || []; _techRanks = tr.data.ranks || []; } } catch {}
  const f = ($("fi-filter") && $("fi-filter").value) || "";
  let qs = "?free=1";
  if (f) qs += "&status=" + encodeURIComponent(f);
  const r = await api("/api/billing/joborders" + qs); if (!r.ok) return;
  _fiAll = r.data.list || [];
  _joJobTypes = r.data.jobTypes || _joJobTypes;
  _joItemStatuses = r.data.itemStatuses || _joItemStatuses;
  _joTechRoles = r.data.techRoles || _joTechRoles;
  const applied = _fiAll.filter((j) => j.status === "applied").length;
  const prog = _fiAll.filter((j) => ["assigned","released","installed"].includes(j.status)).length;
  const done = _fiAll.filter((j) => j.status === "completed").length;
  if ($("fi-k-applied")) $("fi-k-applied").textContent = applied;
  if ($("fi-k-prog")) $("fi-k-prog").textContent = prog;
  if ($("fi-k-done")) $("fi-k-done").textContent = done;
  if ($("fi-k-total")) $("fi-k-total").textContent = _fiAll.length;
  const navBtn = $("nav-freeinstall");
  if (navBtn) {
    let badge = navBtn.querySelector(".nav-badge");
    if (applied > 0) {
      if (!badge) { badge = document.createElement("span"); badge.className = "nav-badge"; badge.style.cssText = "margin-left:auto;background:var(--warn);color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px"; navBtn.appendChild(badge); }
      badge.textContent = applied;
    } else if (badge) badge.remove();
  }
  renderFreeInstalls();
}
function renderFreeInstalls() {
  const tb = $("fi-rows"); if (!tb) return;
  tb.innerHTML = _fiAll.length ? _fiAll.map((j) => \`<tr>
    <td>\${j.id}</td>
    <td>\${esc(jobOrderFullName(j))} \${joSourceBadge(j)}<div style="font-size:11px;color:var(--muted)">\${esc(j.area||j.full_address||"")}</div></td>
    <td>\${esc(j.plan_name||"—")}</td>
    <td style="font-size:12px">\${joPayLabel(j)}</td>
    <td><span style="color:\${joStatusColor(j.status)};font-weight:600;text-transform:capitalize">\${esc(j.status)}</span></td>
    <td>\${esc(joCrewLabel(j))}</td>
    <td style="white-space:nowrap"><button class="mini go" onclick="openJobOrder(\${j.id})">open</button> <button class="mini danger" onclick="joDelete(\${j.id})">delete</button></td>
  </tr>\`).join("") : \`<tr><td colspan=7 class=empty>no free installations yet — use + Free Installation</td></tr>\`;
}
`;

export const LIST_OLD = `    if (filter.job_type) { where.push("jo.job_type=?"); args.push(filter.job_type); }
    if (filter.scheduledToday) {`;
export const LIST_NEW = `    if (filter.job_type) { where.push("jo.job_type=?"); args.push(filter.job_type); }
    if (filter.freeInstall) { where.push("(COALESCE(jo.install_fee,0)=0 OR COALESCE(jo.marking_order,'')='FREE-INSTALL')"); }
    if (filter.scheduledToday) {`;

export const API_OLD = `      if (q.get("job_type")) filter.job_type = q.get("job_type");
      if (q.get("scheduled") === "today") filter.scheduledToday = true;`;
export const API_NEW = `      if (q.get("job_type")) filter.job_type = q.get("job_type");
      if (q.get("free") === "1") filter.freeInstall = true;
      if (q.get("scheduled") === "today") filter.scheduledToday = true;`;

function replaceOnce(src, oldStr, newStr, alreadyHint) {
  if (alreadyHint && src.includes(alreadyHint)) return { src, changed: false };
  if (!src.includes(oldStr)) return { src, changed: false, missing: true };
  return { src: src.replace(oldStr, newStr), changed: true };
}

export function patchIndexHtml(src) {
  let out = String(src || "");
  const missing = [];
  let changed = false;
  const steps = [
    [NAV_OLD, NAV_NEW, 'id="nav-freeinstall"'],
    [VIEW_OLD, VIEW_NEW, 'id="view-freeinstall"'],
    [VIEWS_OLD, VIEWS_NEW, '"joborders", "freeinstall", "techs"'],
    [SHOW_OLD, SHOW_NEW, 'if (name === "freeinstall")'],
    [ROLES_OLD, ROLES_NEW, 'joborders", "freeinstall", "techs"'],
    [JO_VARS_OLD, JO_VARS_NEW, ", _fiAll = []"],
    [OPEN_OLD, OPEN_NEW, "_jocFreeInstall = !!preset.free"],
    [OPEN_TITLE_OLD, OPEN_TITLE_NEW, '"Free Installation" : (preset.job_type'],
    [PLANFEE_OLD, PLANFEE_NEW, "_jocFreeInstall) { feeEl.value = 0"],
    [SAVE_OLD, SAVE_NEW, 'body.marking_order = body.marking_order || "FREE-INSTALL"'],
    [SAVE_RELOAD_OLD, SAVE_RELOAD_NEW, "if (typeof loadFreeInstalls === \"function\")"],
  ];
  for (const [oldStr, newStr, hint] of steps) {
    const r = replaceOnce(out, oldStr, newStr, hint);
    if (r.missing) missing.push(hint);
    out = r.src;
    if (r.changed) changed = true;
  }
  if (!out.includes("async function loadFreeInstalls()")) {
    if (out.includes("async function loadJobOrders()")) {
      out = out.replace("async function loadJobOrders()", FI_JS + "\nasync function loadJobOrders()");
      changed = true;
    } else {
      missing.push("loadFreeInstalls");
    }
  }
  return { src: out, changed, missing };
}

export function patchDbJs(src) {
  return replaceOnce(String(src || ""), LIST_OLD, LIST_NEW, "filter.freeInstall");
}

export function patchServerJs(src) {
  return replaceOnce(String(src || ""), API_OLD, API_NEW, 'q.get("free") === "1"');
}
