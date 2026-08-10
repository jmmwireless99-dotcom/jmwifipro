// lib/scope.js — multi-tenant site scoping for sub-operator accounts.
import { Accounts, Customers, Naps, Olts, FiberLines, Routers } from "./db.js";

export function userScope(user) {
  if (!user) return { scope: "all", router_ids: [], map_private: false };
  if (user.role === "admin") return { scope: "all", router_ids: [], map_private: false };
  const scope = user.scope || "all";
  const router_ids = (user.router_ids || []).map(Number).filter((n) => n > 0);
  return { scope, router_ids, map_private: !!user.map_private };
}

export function isSiteScoped(user) {
  const s = userScope(user);
  return s.scope === "sites" && s.router_ids.length > 0;
}

export function canAccessRouter(user, routerId) {
  if (!user || user.role === "admin") return true;
  const s = userScope(user);
  if (s.scope !== "sites") return true;
  return s.router_ids.includes(Number(routerId));
}

export function guardRouterAccess(user, routerId, send, res) {
  if (!canAccessRouter(user, routerId)) {
    send(res, 403, { ok: false, error: "That site isn't in your assigned scope." });
    return true;
  }
  return false;
}

export function filterByRouterIds(items, routerIds, getRouterId) {
  if (!routerIds || !routerIds.length) return items;
  const set = new Set(routerIds.map(Number));
  return items.filter((item) => {
    const rid = getRouterId(item);
    return rid != null && set.has(Number(rid));
  });
}

export function scopedRouterAreas(routerIds) {
  const areas = new Set();
  for (const r of Routers.list()) {
    if (routerIds.includes(r.id) && r.area) areas.add(String(r.area).trim());
  }
  return areas;
}

export function mapDataForScope(routerIds) {
  const rids = new Set(routerIds.map(Number));
  const clients = Customers.located().filter((c) => c.router_id && rids.has(Number(c.router_id)));
  const napIds = new Set(clients.map((c) => c.nap_id).filter(Boolean));
  const areas = scopedRouterAreas(routerIds);
  for (const n of Naps.list()) {
    if (areas.has(String(n.area || "").trim())) napIds.add(n.id);
  }
  const naps = Naps.list().filter((n) => napIds.has(n.id));
  const oltIds = new Set();
  const lines = FiberLines.list();
  for (const f of lines) {
    const fromNap = f.from_kind === "nap" && napIds.has(f.from_id);
    const toNap = f.to_kind === "nap" && napIds.has(f.to_id);
    if (fromNap || toNap) {
      if (f.from_kind === "olt") oltIds.add(f.from_id);
      if (f.to_kind === "olt") oltIds.add(f.to_id);
    }
  }
  for (const o of Olts.list()) {
    if (areas.has(String(o.area || "").trim())) oltIds.add(o.id);
  }
  const olts = Olts.list().filter((o) => oltIds.has(o.id));
  const visible = { nap: napIds, olt: oltIds };
  const fiber_lines = lines.filter((f) => {
    if (f.line_type === "manual") {
      return f.path && f.path.length >= 2;
    }
    const fromOk = (f.from_kind === "nap" && visible.nap.has(f.from_id))
      || (f.from_kind === "olt" && visible.olt.has(f.from_id));
    const toOk = (f.to_kind === "nap" && visible.nap.has(f.to_id))
      || (f.to_kind === "olt" && visible.olt.has(f.to_id));
    return fromOk && toOk;
  });
  const nameOf = (kind, id) => {
    if (kind === "olt") return (olts.find((o) => o.id === id) || {}).name || ("OLT#" + id);
    if (kind === "nap") return (naps.find((n) => n.id === id) || {}).name || ("NAP#" + id);
    return kind + "#" + id;
  };
  return {
    clients: clients.map((c) => ({
      id: c.id, name: c.name, username: c.username, plan_name: c.plan_name,
      status: c.status, area: c.area, lat: c.lat, lng: c.lng, nap_id: c.nap_id,
    })),
    naps,
    olts,
    fiber_lines: fiber_lines.map((f) => ({
      ...f,
      from_name: nameOf(f.from_kind, f.from_id),
      to_name: nameOf(f.to_kind, f.to_id),
    })),
  };
}

export function enrichUserFromDb(base) {
  if (!base) return null;
  if (base.role === "admin") {
    return { id: base.id, username: base.username, role: base.role, scope: "all", router_ids: [], map_private: false, sites: [] };
  }
  const full = Accounts.getByIdFull(base.id);
  if (!full) return base;
  const router_ids = full.router_ids || [];
  const sites = router_ids.map((id) => {
    const r = Routers.get(id);
    return { id, name: r ? r.name : ("Site#" + id) };
  });
  return {
    id: base.id,
    username: base.username,
    role: base.role,
    scope: full.scope || "all",
    router_ids,
    map_private: !!full.map_private,
    sites,
  };
}
