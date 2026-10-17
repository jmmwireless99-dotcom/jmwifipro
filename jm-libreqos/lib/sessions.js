function tokenValue(match) {
  return (match[2] || match[3] || "").trim();
}

/** Pull `name` and `address` from a RouterOS `/ppp active print terse` dump. */
export function parseMikrotikActive(text) {
  const sessions = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const name = line.match(/(?:^|\s)name=("([^"]*)"|(\S+))/i);
    const address = line.match(/(?:^|\s)address=("([^"]*)"|(\S+))/i);
    if (!name || !address) continue;
    const username = tokenValue(name);
    const ipv4 = tokenValue(address).split("/")[0];
    if (username && ipv4) sessions.push({ username, ipv4 });
  }
  return sessions;
}

function asList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => asList(item));
  if (value == null) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return asList(JSON.parse(trimmed));
    }
    return parseMikrotikActive(trimmed);
  }
  if (typeof value !== "object") return [];
  if (Array.isArray(value.sessions)) return asList(value.sessions);
  if (value.username || value.name) {
    const ips = []
      .concat(value.ipv4 || value.address || value.ip || [])
      .flat()
      .map((ip) => String(ip));
    return ips.filter(Boolean).map((ipv4) => ({
      username: String(value.username || value.name),
      ipv4: ipv4.split("/")[0],
    }));
  }
  return Object.entries(value).flatMap(([username, ipv4]) => asList({ username, ipv4 }));
}

export function parseSessions(input) {
  return asList(input).filter((row) => row.username && row.ipv4);
}

export function indexSessions(input) {
  const index = new Map();
  for (const row of parseSessions(input)) {
    const key = row.username.trim().toLowerCase();
    const list = index.get(key) || [];
    if (!list.includes(row.ipv4)) list.push(row.ipv4);
    index.set(key, list);
  }
  return index;
}
