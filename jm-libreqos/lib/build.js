import { circuitRates, formatRate } from "./speeds.js";
import { indexSessions } from "./sessions.js";
import { toCsv } from "./csv.js";

export const DEFAULT_SETTINGS = {
  upstreamDownloadMbps: 1000,
  upstreamUploadMbps: 1000,
  siteDownloadMbps: 1000,
  siteUploadMbps: 1000,
  oltDownloadMbps: 1000,
  oltUploadMbps: 1000,
  apDownloadMbps: 300,
  apUploadMbps: 300,
  headroom: 1.15,
  minMbps: 1,
  fallbackMbps: 10,
  includeSuspended: false,
  sqm: "",
  apiBase: "http://127.0.0.1:9122",
  apiKey: "",
  reloadAfterPush: true,
  nodes: {},
};

export function cleanLabel(value, fallback = "") {
  const text = String(value ?? "")
    .replace(/#/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function allocateName(raw, suffix, used) {
  const base = cleanLabel(raw, suffix).slice(0, 80);
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base} ${suffix}${n > 2 ? `-${n}` : ""}`.trim();
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function nodeBandwidth(id, download, upload, settings) {
  const override = settings.nodes?.[id] || {};
  const down = Number(override.downloadBandwidthMbps ?? download);
  const up = Number(override.uploadBandwidthMbps ?? upload);
  return {
    download: Math.max(1, Math.round(down)),
    upload: Math.max(1, Math.round(up)),
  };
}

function capTree(nodes, parentDown, parentUp) {
  for (const node of nodes) {
    node.download = Math.max(1, Math.min(node.download, Math.round(parentDown)));
    node.upload = Math.max(1, Math.min(node.upload, Math.round(parentUp)));
    capTree(node.children, node.download, node.upload);
  }
}

function validSqm(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (["cake", "fq_codel", "none"].includes(text)) return text;
  const [down = "", up = ""] = text.split("/");
  const ok = (part) => ["", "cake", "fq_codel", "none"].includes(part);
  if (text.includes("/") && ok(down) && ok(up) && text.split("/").length === 2) return `${down}/${up}`;
  return "";
}

function isMac(value) {
  return /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i.test(String(value || "").trim());
}

function validIpv4(value) {
  const match = String(value || "").trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((n) => n > 255)) return null;
  const cidr = match[5] == null ? null : Number(match[5]);
  if (cidr != null && (cidr < 0 || cidr > 32)) return null;
  return cidr == null ? octets.join(".") : `${octets.join(".")}/${cidr}`;
}

function collectIps(customer, sessions) {
  const found = [];
  const push = (raw) => {
    for (const part of String(raw || "").split(",")) {
      const ip = validIpv4(part);
      if (ip && !found.includes(ip)) found.push(ip);
    }
  };
  push(customer.static_ip);
  const key = String(customer.username || "").trim().toLowerCase();
  for (const ip of sessions.get(key) || []) push(ip);
  return found;
}

function majorityRouterId(customers) {
  const counts = new Map();
  for (const customer of customers) {
    if (customer.router_id == null) continue;
    counts.set(Number(customer.router_id), (counts.get(Number(customer.router_id)) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

function toNetworkJson(nodes) {
  const out = {};
  for (const node of nodes) {
    const entry = {
      downloadBandwidthMbps: node.download,
      uploadBandwidthMbps: node.upload,
      type: node.type,
      id: node.id,
    };
    if (Number.isFinite(node.lat) && Number.isFinite(node.lng)) {
      entry.latitude = node.lat;
      entry.longitude = node.lng;
    }
    if (node.children.length) entry.children = toNetworkJson(node.children);
    out[node.name] = entry;
  }
  return out;
}

function flattenNames(network, into = new Map()) {
  for (const [name, node] of Object.entries(network || {})) {
    into.set(name, node.id || "");
    if (node.children) flattenNames(node.children, into);
  }
  return into;
}

export function buildLibreQos(billing, options = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(options.settings || {}) };
  const sessions = options.sessions instanceof Map ? options.sessions : indexSessions(options.sessions || []);
  const warnings = [];
  const errors = [];
  const usedNames = new Set();
  if (settings.sqm && !validSqm(settings.sqm)) warnings.push("SQM value was ignored. Use cake, fq_codel, none, or down/up.");
  settings.sqm = validSqm(settings.sqm);

  const routers = billing.routers || [];
  const routerById = new Map(routers.map((router) => [Number(router.id), router]));
  const customers = billing.customers || [];
  const naps = billing.naps || [];
  const olts = billing.olts || [];
  const napById = new Map(naps.map((nap) => [Number(nap.id), nap]));
  const oltById = new Map(olts.map((olt) => [Number(olt.id), olt]));

  const napCustomers = new Map();
  for (const customer of customers) {
    if (customer.nap_id == null) continue;
    const id = Number(customer.nap_id);
    const list = napCustomers.get(id) || [];
    list.push(customer);
    napCustomers.set(id, list);
  }

  const napOlt = new Map();
  for (const line of billing.fiberLines || []) {
    if (line.from_kind === "olt" && line.to_kind === "nap" && napCustomers.has(Number(line.to_id))) {
      napOlt.set(Number(line.to_id), Number(line.from_id));
    }
  }

  const defaultRouter = routers.find((router) => Number(router.is_default) === 1) || routers[0] || null;
  const neededRouterIds = new Set();
  for (const customer of customers) {
    if (customer.router_id != null && routerById.has(Number(customer.router_id))) {
      neededRouterIds.add(Number(customer.router_id));
    }
  }
  for (const napId of napCustomers.keys()) {
    const routerId = majorityRouterId(napCustomers.get(napId));
    if (routerId != null && routerById.has(routerId)) neededRouterIds.add(routerId);
  }
  if (!neededRouterIds.size && defaultRouter) neededRouterIds.add(Number(defaultRouter.id));

  const routerNodes = new Map();
  for (const router of routers) {
    if (!neededRouterIds.has(Number(router.id))) continue;
    const id = `jm:router:${router.id}`;
    const bw = nodeBandwidth(id, settings.siteDownloadMbps, settings.siteUploadMbps, settings);
    const node = {
      name: allocateName(router.name, `router-${router.id}`, usedNames),
      id,
      type: "site",
      download: bw.download,
      upload: bw.upload,
      children: [],
    };
    routerNodes.set(Number(router.id), node);
  }

  const oltNodes = new Map();
  function ensureOlt(oltId, routerNode) {
    if (oltNodes.has(oltId)) return oltNodes.get(oltId);
    const olt = oltById.get(oltId);
    if (!olt || !routerNode) return null;
    const id = `jm:olt:${olt.id}`;
    const bw = nodeBandwidth(id, settings.oltDownloadMbps, settings.oltUploadMbps, settings);
    const node = {
      name: allocateName(olt.name, `olt-${olt.id}`, usedNames),
      id,
      type: "site",
      download: bw.download,
      upload: bw.upload,
      lat: olt.lat == null ? null : Number(olt.lat),
      lng: olt.lng == null ? null : Number(olt.lng),
      children: [],
    };
    routerNode.children.push(node);
    oltNodes.set(oltId, node);
    return node;
  }

  const napNodes = new Map();
  for (const [napId, group] of napCustomers) {
    const nap = napById.get(napId);
    if (!nap) {
      warnings.push(`Customer NAP ${napId} is missing from the plant list.`);
      continue;
    }
    const routerId = majorityRouterId(group);
    const routerNode = routerNodes.get(routerId) || routerNodes.get(Number(defaultRouter?.id)) || [...routerNodes.values()][0];
    if (!routerNode) continue;
    const oltId = napOlt.get(napId);
    const parent = oltId ? ensureOlt(oltId, routerNode) || routerNode : routerNode;
    const id = `jm:nap:${nap.id}`;
    const bw = nodeBandwidth(id, settings.apDownloadMbps, settings.apUploadMbps, settings);
    const node = {
      name: allocateName(nap.name, `nap-${nap.id}`, usedNames),
      id,
      type: "ap",
      download: bw.download,
      upload: bw.upload,
      lat: nap.lat == null ? null : Number(nap.lat),
      lng: nap.lng == null ? null : Number(nap.lng),
      children: [],
    };
    parent.children.push(node);
    napNodes.set(napId, node);
  }

  let unassigned = null;
  function unassignedNode() {
    if (unassigned) return unassigned;
    const id = "jm:unassigned";
    const bw = nodeBandwidth(id, settings.siteDownloadMbps, settings.siteUploadMbps, settings);
    unassigned = {
      name: allocateName("Unassigned", "unassigned", usedNames),
      id,
      type: "site",
      download: bw.download,
      upload: bw.upload,
      children: [],
    };
    return unassigned;
  }

  const roots = [...routerNodes.values()].sort((a, b) => a.name.localeCompare(b.name));
  capTree(roots, settings.upstreamDownloadMbps, settings.upstreamUploadMbps);

  const rows = [];
  const pending = [];
  let skippedSuspended = 0;

  for (const customer of customers) {
    const active = String(customer.status || "active").toLowerCase() === "active";
    if (!active && !settings.includeSuspended) {
      skippedSuspended += 1;
      continue;
    }
    const napNode = customer.nap_id == null ? null : napNodes.get(Number(customer.nap_id));
    const routerNode = customer.router_id == null ? null : routerNodes.get(Number(customer.router_id));
    const parent = napNode || routerNode || unassignedNode();
    const rates = active
      ? circuitRates(customer.download_speed || customer.plan_speed, customer.upload_speed || customer.plan_speed, settings)
      : {
          downloadMin: Math.max(0.01, Number(settings.minMbps) || 1),
          uploadMin: Math.max(0.01, Number(settings.minMbps) || 1),
          downloadMax: Math.max(0.01, Number(settings.minMbps) || 1),
          uploadMax: Math.max(0.01, Number(settings.minMbps) || 1),
          usedFallback: false,
        };
    if (rates.downloadMin > rates.downloadMax) rates.downloadMin = rates.downloadMax;
    if (rates.uploadMin > rates.uploadMax) rates.uploadMin = rates.uploadMax;
    if (rates.usedFallback) warnings.push(`Customer ${customer.id} has no plan speed. Using ${settings.fallbackMbps} Mbps.`);

    const ips = collectIps(customer, sessions);
    const username = cleanLabel(customer.username);
    const mac = isMac(customer.mac) ? String(customer.mac).trim().toLowerCase() : username;
    const circuitId = `jm-${customer.id}`;
    const row = {
      "Circuit ID": circuitId,
      "Circuit Name": cleanLabel(customer.name, username || circuitId),
      "Device ID": `${circuitId}-cpe`,
      "Device Name": username || "cpe",
      "Parent Node": parent.name,
      "Parent Node ID": parent.id,
      "Anchor Node ID": parent.id,
      MAC: mac,
      IPv4: ips.join(", "),
      IPv6: "",
      "Download Min Mbps": formatRate(rates.downloadMin),
      "Upload Min Mbps": formatRate(rates.uploadMin),
      "Download Max Mbps": formatRate(rates.downloadMax),
      "Upload Max Mbps": formatRate(rates.uploadMax),
      Comment: cleanLabel(`${customer.conn_type || "pppoe"} ${username} ${customer.plan_name || ""} ${customer.account_code || ""} ${active ? "" : "suspended"}`),
      sqm: validSqm(settings.sqm),
    };
    if (!ips.length) {
      pending.push({
        circuitId,
        name: row["Circuit Name"],
        username,
        parent: parent.name,
        downloadMax: row["Download Max Mbps"],
        uploadMax: row["Upload Max Mbps"],
      });
      continue;
    }
    rows.push(row);
  }

  if (unassigned) {
    roots.push(unassigned);
    capTree([unassigned], settings.upstreamDownloadMbps, settings.upstreamUploadMbps);
  }

  const network = toNetworkJson(roots);
  const names = flattenNames(network);
  for (const row of rows) {
    if (row["Circuit ID"].includes("#")) errors.push(`Circuit ${row["Circuit ID"]} contains #.`);
    if (!names.has(row["Parent Node"])) errors.push(`Parent ${row["Parent Node"]} is missing from network.json.`);
    const downMin = Number(row["Download Min Mbps"]);
    const downMax = Number(row["Download Max Mbps"]);
    const upMin = Number(row["Upload Min Mbps"]);
    const upMax = Number(row["Upload Max Mbps"]);
    if (downMin < 0.01 || downMax < 0.01 || upMin < 0.01 || upMax < 0.01) errors.push(`Circuit ${row["Circuit ID"]} has a rate below 0.01 Mbps.`);
    if (downMin > downMax || upMin > upMax) errors.push(`Circuit ${row["Circuit ID"]} has a minimum above its maximum.`);
  }
  if (!roots.length) errors.push("No router sites were found in the billing database.");

  const seenIds = new Set();
  for (const row of rows) {
    const key = `${row["Circuit ID"]}|${row["Device ID"]}`;
    if (seenIds.has(key)) errors.push(`Duplicate device ${key}.`);
    seenIds.add(key);
  }

  return {
    target: "LibreQoS 2.2",
    network,
    csv: toCsv(rows),
    rows,
    pending,
    warnings,
    errors,
    summary: {
      sites: [...names.values()].length,
      routers: routerNodes.size,
      naps: napNodes.size,
      olts: oltNodes.size,
      customers: customers.length,
      shaped: rows.length,
      waitingForIp: pending.length,
      skippedSuspended,
      mappedCircuits: new Set(rows.map((row) => row["Circuit ID"])).size,
    },
  };
}
