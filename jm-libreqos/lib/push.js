function joinUrl(base, path) {
  return `${String(base || "").replace(/\/$/, "")}${path}`;
}

async function request(base, apiKey, path, { method = "GET", body, contentType } = {}) {
  const headers = {};
  if (apiKey) headers["x-bearer"] = apiKey;
  if (contentType) headers["content-type"] = contentType;
  const response = await fetch(joinUrl(base, path), {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  return { name: `${method} ${path}`, status: response.status, ok: response.ok, body: text.slice(0, 2000) };
}

/**
 * Push topology and shaped devices to a LibreQoS 2.2 node API.
 * Auth header is `x-bearer`, the key from License & Services.
 */
export async function pushToLibreQos({ apiBase, apiKey, network, csv, reload = true }) {
  if (!apiBase) throw new Error("LibreQoS API base URL is empty.");
  const steps = [];
  const health = await request(apiBase, apiKey, "/health");
  steps.push(health);
  if (!health.ok) return { ok: false, steps };

  const networkStep = await request(apiBase, apiKey, "/network_json/update", {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify(network),
  });
  steps.push(networkStep);
  if (!networkStep.ok) return { ok: false, steps };

  const shapedStep = await request(apiBase, apiKey, "/shaped_devices/update", {
    method: "POST",
    contentType: "text/csv",
    body: csv,
  });
  steps.push(shapedStep);
  if (!shapedStep.ok) return { ok: false, steps };

  if (reload) {
    const reloadStep = await request(apiBase, apiKey, "/reload_libreqos", { method: "POST" });
    steps.push(reloadStep);
    if (!reloadStep.ok) return { ok: false, steps };
  }
  return { ok: true, steps };
}
