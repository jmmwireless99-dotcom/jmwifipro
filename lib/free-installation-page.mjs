/** Server / operator patches for https://jmwifi.pro/free/installation */

export const IMPORT_OLD = `import { resolveApplyCoverage, formatApplyAddress } from "./lib/apply-coverage.mjs";`;
export const IMPORT_NEW = `import { resolveApplyCoverage, formatApplyAddress } from "./lib/apply-coverage.mjs";
import { resolveFreeInstallationCoverage } from "./lib/free-installation-coverage.mjs";`;

export const GET_OLD = `    if (pathname === "/apply" && req.method === "GET") {
      return servePortalPage(res, "apply.html");
    }`;
export const GET_NEW = `    if (pathname === "/apply" && req.method === "GET") {
      return servePortalPage(res, "apply.html");
    }
    if ((pathname === "/free/installation" || pathname === "/free/installation/") && req.method === "GET") {
      return servePortalPage(res, "free-installation.html");
    }`;

export const POST_OLD = `      return send(res, 200, { ok: true, id: jo.id, message: "Thank you! Your application was received. We'll contact you shortly to schedule your installation. After your account is activated, sign in at My Account using your first name and last name." });
    }

    // ===== Customer portal API (matches the standalone VPS portal contract) =====`;

export const POST_NEW = `      return send(res, 200, { ok: true, id: jo.id, message: "Thank you! Your application was received. We'll contact you shortly to schedule your installation. After your account is activated, sign in at My Account using your first name and last name." });
    }
    if (pathname === "/api/apply/free-installation" && req.method === "POST") {
      const raw = (await readBody(req)) || "";
      if (raw.length > 8_000_000) return send(res, 413, { ok: false, error: "Image too large (max ~6MB)." });
      const b = JSON.parse(raw || "{}");
      const parsed = parseApplyBody(b);
      if (parsed.error) return send(res, 400, { ok: false, error: parsed.error });
      if (!b.contact || !String(b.contact).trim()) return send(res, 400, { ok: false, error: "Please enter a contact number." });
      if (!b.agreed) return send(res, 400, { ok: false, error: "Please read and tick the agreement to continue." });
      const cov = resolveFreeInstallationCoverage(b.municipality, b.barangay);
      if (!cov.ok) return send(res, 400, { ok: false, error: cov.error });
      b.area = cov.barangay;
      b.address = formatApplyAddress(cov.municipality, cov.barangay, b.landmark);
      const s = Settings.all();
      const jo = JobOrders.apply({
        name: parsed.first, last_name: parsed.last, username: parsed.username, password: parsed.password,
        contact: b.contact, email: b.email, facebook: b.facebook, address: b.address, area: b.area,
        lat: b.lat, lng: b.lng, plan_id: b.plan_id || null, conn_type: b.conn_type || "pppoe", notes: b.notes,
        install_fee: 0,
        router_cost: Number(s.router_cost || 0),
        pay_choice: b.pay_choice === "now" ? "now" : "on_install",
        pay_reference: b.pay_reference || "", pay_proof: b.pay_proof || "", agreed: 1,
        referral_code: String(b.referral_code || b.ref || "").trim(),
        marking_order: "FREE-INSTALL",
      });
      Audit.add({ type: "auto", action: "free-installation-apply", detail: \`\${parsed.fullName} (\${b.contact}) — FREE-INSTALL \${cov.municipality}/\${cov.barangay}\`, ok: true });
      const c = tg(), chat = tgChat();
      if (c && chat) { try { await c.sendMessage(chat, \`🆓 <b>FREE INSTALLATION APPLY</b>\\n\${escapeHtml(parsed.fullName)} · \${escapeHtml(b.contact)}\${b.facebook ? "\\nFB: " + escapeHtml(b.facebook) : ""}\\n\${escapeHtml(b.address || "")}\\nOpen Free Installation to review.\`); } catch {} }
      return send(res, 200, { ok: true, id: jo.id, message: "Thank you! Free installation application received. We'll contact you to schedule. After activation, sign in at My Account using your first name and last name." });
    }

    // ===== Customer portal API (matches the standalone VPS portal contract) =====`;

export const APPLY_SQL_OLD = `INSERT INTO job_orders (name,last_name,username,password,contact,email,facebook,address,area,lat,lng,plan_id,conn_type,notes,install_fee,router_cost,pay_choice,pay_status,pay_reference,pay_proof,agreed,referral_code,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
export const APPLY_SQL_NEW = `INSERT INTO job_orders (name,last_name,username,password,contact,email,facebook,address,area,lat,lng,plan_id,conn_type,notes,install_fee,router_cost,pay_choice,pay_status,pay_reference,pay_proof,agreed,referral_code,status,marking_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

export const APPLY_ARGS_OLD = `      String(a.referral_code || "").trim().toUpperCase() || "",
      a.status || "applied");
    return JobOrders.get(r.lastInsertRowid);
  },
  // Staff-created job (walk-in, phone, daily router list — not from /apply).`;
export const APPLY_ARGS_NEW = `      String(a.referral_code || "").trim().toUpperCase() || "",
      a.status || "applied",
      a.marking_order || "");
    return JobOrders.get(r.lastInsertRowid);
  },
  // Staff-created job (walk-in, phone, daily router list — not from /apply).`;

export const OP_LINK_OLD = `        <button class="refresh" onclick="loadFreeInstalls()">⟳ refresh</button>`;
export const OP_LINK_NEW = `        <button class="refresh" onclick="loadFreeInstalls()">⟳ refresh</button>
        <button class="refresh" onclick="window.open('/free/installation','_blank')" title="open the public free installation form">🔗 open /free/installation</button>`;

function replaceOnce(src, oldStr, newStr, alreadyHint) {
  if (alreadyHint && src.includes(alreadyHint)) return { src, changed: false };
  if (!src.includes(oldStr)) return { src, changed: false, missing: true };
  return { src: src.replace(oldStr, newStr), changed: true };
}

export function patchServerJs(src) {
  let out = String(src || "");
  const missing = [];
  let changed = false;
  const steps = [
    [IMPORT_OLD, IMPORT_NEW, "resolveFreeInstallationCoverage"],
    [GET_OLD, GET_NEW, '"/free/installation"'],
    [POST_OLD, POST_NEW, '"/api/apply/free-installation"'],
  ];
  for (const [oldStr, newStr, hint] of steps) {
    const r = replaceOnce(out, oldStr, newStr, hint);
    if (r.missing) missing.push(hint);
    out = r.src;
    if (r.changed) changed = true;
  }
  return { src: out, changed, missing };
}

export function patchDbJs(src) {
  let out = String(src || "");
  const missing = [];
  let changed = false;
  for (const [oldStr, newStr, hint] of [
    [APPLY_SQL_OLD, APPLY_SQL_NEW, "status,marking_order)"],
    [APPLY_ARGS_OLD, APPLY_ARGS_NEW, "a.marking_order || \"\""],
  ]) {
    const r = replaceOnce(out, oldStr, newStr, hint);
    if (r.missing) missing.push(hint);
    out = r.src;
    if (r.changed) changed = true;
  }
  return { src: out, changed, missing };
}

export function patchIndexHtml(src) {
  return replaceOnce(String(src || ""), OP_LINK_OLD, OP_LINK_NEW, "open('/free/installation'");
}
