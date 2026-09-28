/**
 * Client self-edit for pending jmwifi.pro/apply applications.
 * Lookup by contact (+ optional application #). Only status=applied, no customer yet.
 */

export const APPLY_EDIT_LOCKED =
  "Hindi na pwedeng i-edit. Naka-process na ang application. Message kami para ayusin.";

export const APPLY_EDIT_NOT_FOUND =
  "Hindi namin mahanap ang application. Check ang contact number o application #.";

export function phoneDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

export function phoneKey(s) {
  let d = phoneDigits(s);
  if (d.startsWith("63") && d.length >= 12) d = "0" + d.slice(2);
  if (d.length > 11) d = d.slice(-11);
  return d;
}

export function contactsMatch(a, b) {
  const x = phoneKey(a);
  const y = phoneKey(b);
  if (!x || !y || x.length < 10 || y.length < 10) return false;
  return x === y || x.slice(-10) === y.slice(-10);
}

export function splitApplyAddress(address, area) {
  const parts = String(address || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let municipality = "";
  let barangay = "";
  let landmark = "";
  if (parts.length >= 3 && /masbate/i.test(parts[parts.length - 1])) {
    municipality = parts[parts.length - 2];
    barangay = parts[parts.length - 3];
    landmark = parts.slice(0, parts.length - 3).join(", ");
  } else {
    barangay = String(area || "").trim();
    landmark = String(address || "").trim();
  }
  return { municipality, barangay, landmark };
}

export function publicApplyRecord(jo) {
  if (!jo) return null;
  const addr = splitApplyAddress(jo.address, jo.area);
  return {
    id: jo.id,
    status: jo.status,
    first_name: jo.name || "",
    last_name: jo.last_name || "",
    contact: jo.contact || "",
    email: jo.email || "",
    facebook: jo.facebook || "",
    address: jo.address || "",
    area: jo.area || "",
    municipality: addr.municipality,
    barangay: addr.barangay || jo.area || "",
    landmark: addr.landmark,
    lat: jo.lat ?? null,
    lng: jo.lng ?? null,
    plan_id: jo.plan_id || null,
    plan_name: jo.plan_name || "",
    pay_choice: jo.pay_choice === "now" ? "now" : "on_install",
    referral_code: jo.referral_code || "",
  };
}

function isPendingApply(jo) {
  return !!jo && String(jo.status || "") === "applied" && !jo.customer_id;
}

export function findPendingApply(getById, listApplied, id, contact) {
  if (phoneKey(contact).length < 10) {
    return { ok: false, error: "Ilagay ang contact number na ginamit ninyo sa apply." };
  }
  const rawId = String(id || "").replace(/\D+/g, "");
  if (rawId) {
    const jo = getById(Number(rawId));
    if (!jo || !contactsMatch(jo.contact, contact)) {
      return { ok: false, error: APPLY_EDIT_NOT_FOUND };
    }
    if (!isPendingApply(jo)) return { ok: false, error: APPLY_EDIT_LOCKED };
    return { ok: true, job: jo };
  }
  const hits = (listApplied() || []).filter((j) => contactsMatch(j.contact, contact) && isPendingApply(j));
  if (!hits.length) return { ok: false, error: APPLY_EDIT_NOT_FOUND };
  if (hits.length > 1) {
    return {
      ok: false,
      error: "Maraming application sa number na ito. Ilagay din ang application number.",
    };
  }
  return { ok: true, job: hits[0] };
}

export const IMPORT_EDIT =
  `import { contactsMatch, publicApplyRecord, findPendingApply, APPLY_EDIT_LOCKED } from "./lib/apply-edit.mjs";`;

export function patchServerImport(src) {
  let out = String(src || "");
  if (out.includes('from "./lib/apply-edit.mjs"')) return { src: out, changed: false };
  const cov = `import { resolveApplyCoverage, formatApplyAddress } from "./lib/apply-coverage.mjs";`;
  const jo = `import { JobOrders } from "./lib/db.js";`;
  if (!out.includes(cov)) {
    if (!out.includes(jo)) return { src: out, changed: false, missing: "import" };
    out = out.replace(jo, jo + "\n" + cov);
  }
  if (out.includes(cov)) {
    return { src: out.replace(cov, cov + "\n" + IMPORT_EDIT), changed: true };
  }
  return { src: out, changed: false, missing: "import" };
}

export const ROUTES_MARKER = "// ===== Customer portal API (matches the standalone VPS portal contract) =====";

export const APPLY_EDIT_ROUTES = `    if (pathname === "/api/apply/lookup" && req.method === "POST") {
      const raw = (await readBody(req)) || "";
      const b = JSON.parse(raw || "{}");
      if (b._hp) return send(res, 200, { ok: true, application: null });
      const found = findPendingApply((id) => JobOrders.get(id), () => JobOrders.list({ status: "applied" }), b.id || b.application_id, b.contact);
      if (!found.ok) return send(res, 404, { ok: false, error: found.error });
      return send(res, 200, { ok: true, application: publicApplyRecord(found.job) });
    }
    if (pathname === "/api/apply/edit" && req.method === "POST") {
      const raw = (await readBody(req)) || "";
      if (raw.length > 8_000_000) return send(res, 413, { ok: false, error: "Image too large (max ~6MB)." });
      const b = JSON.parse(raw || "{}");
      if (b._hp) return send(res, 200, { ok: true, id: null, message: "Saved." });
      const parsed = parseApplyBody(b);
      if (parsed.error) return send(res, 400, { ok: false, error: parsed.error });
      if (!b.contact || !String(b.contact).trim()) return send(res, 400, { ok: false, error: "Please enter a contact number." });
      if (!b.agreed) return send(res, 400, { ok: false, error: "Please read and tick the agreement to continue." });
      const found = findPendingApply(
        (id) => JobOrders.get(id),
        () => JobOrders.list({ status: "applied" }),
        b.id || b.application_id,
        b.lookup_contact || b.original_contact || b.contact
      );
      if (!found.ok) return send(res, 400, { ok: false, error: found.error });
      const cov = resolveApplyCoverage(b.municipality, b.barangay);
      if (!cov.ok) return send(res, 400, { ok: false, error: cov.error });
      b.area = cov.barangay;
      b.address = formatApplyAddress(cov.municipality, cov.barangay, b.landmark);
      const s = Settings.all();
      const updated = JobOrders.updateApplicant(found.job.id, {
        name: parsed.first, last_name: parsed.last, username: parsed.username, password: parsed.password,
        contact: b.contact, email: b.email, facebook: b.facebook, address: b.address, area: b.area,
        lat: b.lat, lng: b.lng, plan_id: b.plan_id || found.job.plan_id,
        install_fee: Plans.installFee(b.plan_id || found.job.plan_id, s.install_fee),
        referral_code: String(b.referral_code || b.ref || "").trim(),
        pay_choice: b.pay_choice === "now" ? "now" : "on_install",
      });
      if (!updated) return send(res, 400, { ok: false, error: APPLY_EDIT_LOCKED });
      Audit.add({ type: "auto", action: "apply-edit", detail: \`JO #\${found.job.id} \${jobOrderFullName(found.job)} → \${parsed.fullName} (\${b.contact})\`, ok: true });
      return send(res, 200, { ok: true, id: updated.id, message: "Na-save ang corrections. Application #" + updated.id + " updated. We'll use the new details for your installation." });
    }

    ${ROUTES_MARKER}`;

export function patchServerRoutes(src) {
  let out = String(src || "");
  if (out.includes('pathname === "/api/apply/edit"')) return { src: out, changed: false };
  if (!out.includes(ROUTES_MARKER)) return { src: out, changed: false, missing: "portal-marker" };
  return { src: out.replace(ROUTES_MARKER, APPLY_EDIT_ROUTES), changed: true };
}

export function patchServerJs(src) {
  let out = String(src || "");
  const missing = [];
  let changed = false;
  for (const step of [patchServerImport, patchServerRoutes]) {
    const r = step(out);
    if (r.missing) missing.push(r.missing);
    out = r.src;
    if (r.changed) changed = true;
  }
  return { src: out, changed, missing };
}

export const APPLY_FN_OLD = `    return JobOrders.get(r.lastInsertRowid);
  },
  // Staff-created job (walk-in, phone, daily router list — not from /apply).`;

export const APPLY_FN_NEW = `    return JobOrders.get(r.lastInsertRowid);
  },
  updateApplicant: (id, a) => {
    const jo = get("SELECT id,status,customer_id FROM job_orders WHERE id=?", id);
    if (!jo) return null;
    if (String(jo.status || "") !== "applied" || jo.customer_id) return null;
    run(\`UPDATE job_orders SET name=?,last_name=?,username=?,password=?,contact=?,email=?,facebook=?,address=?,area=?,lat=?,lng=?,plan_id=?,install_fee=?,referral_code=?,pay_choice=? WHERE id=? AND status='applied'\`,
      a.name, a.last_name || "", a.username || "", a.password || "",
      a.contact || "", a.email || "", a.facebook || "", a.address || "", a.area || "",
      a.lat != null && a.lat !== "" ? Number(a.lat) : null, a.lng != null && a.lng !== "" ? Number(a.lng) : null,
      a.plan_id || null, Number(a.install_fee) || 0,
      String(a.referral_code || "").trim().toUpperCase() || "",
      a.pay_choice === "now" ? "now" : "on_install",
      id);
    return JobOrders.get(id);
  },
  // Staff-created job (walk-in, phone, daily router list — not from /apply).`;

export function patchDbJs(src) {
  let out = String(src || "");
  if (out.includes("updateApplicant:")) return { src: out, changed: false };
  if (!out.includes(APPLY_FN_OLD)) return { src: out, changed: false, missing: "apply-fn" };
  return { src: out.replace(APPLY_FN_OLD, APPLY_FN_NEW), changed: true };
}

export const HTML_CSS_OLD = `  footer{position:relative;z-index:1;text-align:center;color:var(--muted);font-size:13px;padding:36px 22px 46px;border-top:1px solid var(--line);margin-top:24px}`;

export const HTML_CSS_NEW = `  .editbar{margin:18px 0 8px}
  .edit-toggle{width:100%;background:var(--inbg);border:1px dashed var(--cyan);color:var(--ink);border-radius:14px;padding:12px 14px;font-size:14px;font-weight:700;cursor:pointer;text-align:left}
  .edit-toggle:hover{background:rgba(34,211,238,.08)}
  .edit-find{display:none;margin-top:10px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
  .edit-find.show{display:block}
  .edit-find p{font-size:13px;color:var(--muted);margin-bottom:10px;line-height:1.45}
  .edit-find button.go{width:100%;margin-top:12px;background:var(--grad);color:#fff;border:none;border-radius:24px;padding:13px;font-size:15px;font-weight:800;cursor:pointer}
  .edit-banner{display:none;margin-bottom:14px;padding:12px 14px;border-radius:12px;border:1px solid var(--ok);background:rgba(52,211,153,.12);color:#a7f3d0;font-size:13.5px;line-height:1.45}
  .edit-banner.show{display:block}
${HTML_CSS_OLD}`;

export const HTML_NAV_OLD = `      <a href="/apply" class="active">Apply</a>
      <a href="/account">My Account</a>`;
export const HTML_NAV_NEW = `      <a href="/apply" class="active">Apply</a>
      <a href="/apply?edit=1">Edit apply</a>
      <a href="/account">My Account</a>`;

export const HTML_BAR_OLD = `  <div class="wrap">
    <!-- STEP 1: plans -->`;

export const HTML_BAR_NEW = `  <div class="wrap">
    <div class="editbar" id="editbar">
      <button type="button" class="edit-toggle" id="edit-toggle" onclick="toggleEditFind()">May mali sa type? I-edit ang application ninyo</button>
      <div class="edit-find" id="edit-find">
        <p>Ilagay ang <b style="color:var(--ink)">contact number</b> na ginamit ninyo sa <a href="/apply" style="color:#fff;text-decoration:underline">/apply</a>. Optional: application number (makikita after mag-submit).</p>
        <label>Application number <span style="color:var(--muted);font-weight:400">(optional)</span></label>
        <input id="edit_find_id" inputmode="numeric" placeholder="e.g. 123">
        <label>Contact number *</label>
        <input id="edit_find_contact" placeholder="09xx xxx xxxx">
        <button type="button" class="go" onclick="lookupApply()">Open application</button>
        <div class="msg" id="edit-find-msg"></div>
      </div>
    </div>
    <!-- STEP 1: plans -->`;

export const HTML_BANNER_OLD = `      <div class="card">
        <label>First name *</label>`;

export const HTML_BANNER_NEW = `      <div class="card">
        <div class="edit-banner" id="edit-banner"></div>
        <label>First name *</label>`;

export const HTML_JS_OLD = `  let PLANS=[], CONFIG={}, CHOSEN=null;`;
export const HTML_JS_NEW = `  let PLANS=[], CONFIG={}, CHOSEN=null, EDIT=null;`;

export const HTML_PAINT_OLD = `      else if(submit.textContent!=="Sending...") submit.textContent="Submit application";`;
export const HTML_PAINT_NEW = `      else if(submit.textContent!=="Sending..." && submit.textContent!=="Saving...") submit.textContent=EDIT?"Save corrections":"Submit application";`;

export const HTML_SUCCESS_OLD = `      if(d.ok){ msg.className="msg ok"; msg.textContent=d.message; ["first_name","last_name","contact","email","facebook","landmark","referral_code","lat","lng"].forEach(i=>{if($(i))$(i).value="";}); resetCoverage(); $("agreed").checked=false; resetPinMap(); $("pinstate").textContent=""; $("pinbtn").classList.remove("done"); $("pinbtn").textContent="📍 Pin Installation Address"; }
      else { msg.className="msg err"; msg.textContent=d.error||"Something went wrong."; }
    }catch(e){ msg.className="msg err"; msg.textContent="Network error. Please try again."; }
    $("submit").disabled=false;$("submit").textContent="Submit application";
    paintCoverage();
  }
  load();`;

export const HTML_SUCCESS_NEW = `      if(d.ok){
        EDIT={ id:d.id, contact:body.contact };
        try{ localStorage.setItem("jm_apply_last", JSON.stringify(EDIT)); }catch(e){}
        setEditMode(EDIT, d.message || ("Application #"+d.id+" received."));
        msg.className="msg ok";
        msg.textContent="Application #"+d.id+" received. May mali sa type? I-correct dito then tap Save corrections.";
      }
      else { msg.className="msg err"; msg.textContent=d.error||"Something went wrong."; }
    }catch(e){ msg.className="msg err"; msg.textContent="Network error. Please try again."; }
    $("submit").disabled=false;$("submit").textContent=EDIT?"Save corrections":"Submit application";
    paintCoverage();
  }
  function submitLabel(){ return EDIT ? "Save corrections" : "Submit application"; }
  function setEditMode(rec, note){
    EDIT=rec;
    const ban=$("edit-banner");
    if(ban){
      ban.classList.add("show");
      ban.innerHTML="<b>Editing application #"+esc(String(rec.id))+"</b><br>"+(note?esc(note):"May mali sa type? I-correct then Save corrections. Pending applications lang ang pwedeng i-edit.");
    }
    const t=$("edit-toggle"); if(t) t.textContent="Editing application #"+rec.id;
    const f=$("edit-find"); if(f) f.classList.remove("show");
    const s=$("submit"); if(s){ s.textContent="Save corrections"; s.disabled=false; s.classList.remove("blocked"); }
  }
  function toggleEditFind(){
    const box=$("edit-find"); if(!box) return;
    box.classList.toggle("show");
    if(box.classList.contains("show")){
      try{
        const last=JSON.parse(localStorage.getItem("jm_apply_last")||"null");
        if(last){
          if($("edit_find_id") && ! $("edit_find_id").value) $("edit_find_id").value=last.id||"";
          if($("edit_find_contact") && ! $("edit_find_contact").value) $("edit_find_contact").value=last.contact||"";
        }
      }catch(e){}
      if($("edit_find_contact")) $("edit_find_contact").focus();
    }
  }
  function fillApplyRecord(app){
    if(!app) return;
    if($("first_name")) $("first_name").value=app.first_name||"";
    if($("last_name")) $("last_name").value=app.last_name||"";
    if($("contact")) $("contact").value=app.contact||"";
    if($("email")) $("email").value=app.email||"";
    if($("facebook")) $("facebook").value=app.facebook||"";
    if($("referral_code")) $("referral_code").value=app.referral_code||"";
    if($("pay_choice") && app.pay_choice) $("pay_choice").value=app.pay_choice;
    if($("landmark")) $("landmark").value=app.landmark||"";
    if($("lat")) $("lat").value=app.lat||"";
    if($("lng")) $("lng").value=app.lng||"";
    if($("muni") && app.municipality){
      $("muni").value=app.municipality;
      paintCoverage();
      if($("brgy") && app.barangay) $("brgy").value=app.barangay;
      paintCoverage();
    }
    if(app.lat && app.lng){
      try{ showPinMap(Number(app.lat), Number(app.lng)); $("pinbtn").classList.add("done"); $("pinbtn").textContent="📍 Pin updated"; $("pinstate").className="pinstate ok"; $("pinstate").textContent="Saved pin loaded."; }catch(e){}
    }
    const idx=PLANS.findIndex(function(p){ return String(p.id)===String(app.plan_id); });
    if(idx>=0) choose(idx);
    else { $("step-plans").style.display="none"; $("step-form").classList.add("show"); }
    setEditMode({ id:app.id, contact:app.contact }, "Loaded. I-correct ang mali then Save corrections.");
    if($("agreed")) $("agreed").checked=true;
    const msg=$("msg"); if(msg){ msg.className="msg ok"; msg.textContent="Application #"+app.id+" loaded. You can edit the fields."; }
  }
  async function lookupApply(){
    const msg=$("edit-find-msg"); if(msg){ msg.className="msg"; msg.textContent=""; }
    const contact=($("edit_find_contact")&&$("edit_find_contact").value||"").trim();
    const id=($("edit_find_id")&&$("edit_find_id").value||"").trim();
    if(!contact){ if(msg){ msg.className="msg err"; msg.textContent="Ilagay ang contact number."; } return; }
    try{
      const r=await fetch("/api/apply/lookup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ contact:contact, id:id, _hp:($("_hp")||{}).value||"" })});
      const d=await r.json();
      if(!d.ok){ if(msg){ msg.className="msg err"; msg.textContent=d.error||"Not found."; } return; }
      fillApplyRecord(d.application);
    }catch(e){ if(msg){ msg.className="msg err"; msg.textContent="Network error. Please try again."; } }
  }
  async function submitApplyEdit(body, msg){
    body.id=EDIT.id;
    body.application_id=EDIT.id;
    body.lookup_contact=EDIT.contact;
    $("submit").disabled=true;$("submit").textContent="Saving...";
    try{
      const r=await fetch("/api/apply/edit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const d=await r.json();
      if(d.ok){
        EDIT={ id:d.id||EDIT.id, contact:body.contact };
        try{ localStorage.setItem("jm_apply_last", JSON.stringify(EDIT)); }catch(e){}
        setEditMode(EDIT, d.message);
        msg.className="msg ok"; msg.textContent=d.message||"Na-save ang corrections.";
      } else { msg.className="msg err"; msg.textContent=d.error||"Something went wrong."; }
    }catch(e){ msg.className="msg err"; msg.textContent="Network error. Please try again."; }
    $("submit").disabled=false;$("submit").textContent="Save corrections";
    paintCoverage();
  }
  load();`;

export const HTML_FETCH_OLD = `      const r=await fetch("/api/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});`;
export const HTML_FETCH_NEW = `      if(EDIT && EDIT.id){ return submitApplyEdit(body, msg); }
      const r=await fetch("/api/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});`;

export const HTML_LOAD_OLD = `    if(want){ const i=PLANS.findIndex(p=>String(p.id)===String(want)); if(i>=0) choose(i); }
  }`;
export const HTML_LOAD_NEW = `    if(want){ const i=PLANS.findIndex(p=>String(p.id)===String(want)); if(i>=0) choose(i); }
    const qs=new URLSearchParams(location.search);
    if(qs.get("edit")==="1" || qs.get("id") || qs.get("app")){
      if($("edit_find_id") && (qs.get("id")||qs.get("app"))) $("edit_find_id").value=qs.get("id")||qs.get("app");
      toggleEditFind();
    }
  }`;

function replaceOnce(src, oldStr, newStr, alreadyHint) {
  if (alreadyHint && src.includes(alreadyHint)) return { src, changed: false };
  if (!src.includes(oldStr)) return { src, changed: false, missing: true };
  return { src: src.replace(oldStr, newStr), changed: true };
}

export function patchApplyHtml(src) {
  let out = String(src || "");
  const missing = [];
  let changed = false;
  const steps = [
    [HTML_CSS_OLD, HTML_CSS_NEW, ".edit-toggle"],
    [HTML_NAV_OLD, HTML_NAV_NEW, "/apply?edit=1"],
    [HTML_BAR_OLD, HTML_BAR_NEW, 'id="edit-find"'],
    [HTML_BANNER_OLD, HTML_BANNER_NEW, 'id="edit-banner"'],
    [HTML_JS_OLD, HTML_JS_NEW, "EDIT=null"],
    [HTML_PAINT_OLD, HTML_PAINT_NEW, 'EDIT?"Save corrections"'],
    [HTML_FETCH_OLD, HTML_FETCH_NEW, "submitApplyEdit(body"],
    [HTML_SUCCESS_OLD, HTML_SUCCESS_NEW, "function lookupApply()"],
    [HTML_LOAD_OLD, HTML_LOAD_NEW, 'qs.get("edit")'],
  ];
  for (const [oldStr, newStr, hint] of steps) {
    const r = replaceOnce(out, oldStr, newStr, hint);
    if (r.missing) missing.push(hint);
    out = r.src;
    if (r.changed) changed = true;
  }
  return { src: out, changed, missing };
}
