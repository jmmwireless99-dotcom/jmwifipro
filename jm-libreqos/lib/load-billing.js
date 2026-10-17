import { DatabaseSync } from "node:sqlite";

const CUSTOMER_SQL = `
  SELECT
    c.id, c.name, c.username, c.status, c.area, c.conn_type, c.mac, c.static_ip,
    c.router_id, c.nap_id, c.plan_id, c.account_code,
    p.name AS plan_name, p.speed AS plan_speed,
    p.download_speed, p.upload_speed
  FROM customers c
  LEFT JOIN plans p ON p.id = c.plan_id
  ORDER BY c.id
`;

export function loadBilling(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return {
      plans: db.prepare("SELECT id, name, speed, download_speed, upload_speed, type, status FROM plans ORDER BY id").all(),
      routers: db.prepare("SELECT id, name, area, enabled, is_default FROM routers ORDER BY is_default DESC, id").all(),
      naps: db.prepare("SELECT id, name, area, lat, lng FROM naps ORDER BY id").all(),
      olts: db.prepare("SELECT id, name, area, lat, lng FROM olts ORDER BY id").all(),
      fiberLines: db.prepare("SELECT id, line_type, from_kind, from_id, to_kind, to_id FROM fiber_lines").all(),
      customers: db.prepare(CUSTOMER_SQL).all(),
    };
  } finally {
    db.close();
  }
}
