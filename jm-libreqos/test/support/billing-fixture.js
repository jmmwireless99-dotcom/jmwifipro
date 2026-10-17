import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function makeBillingDb(rows) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jm-lqos-")), "billing.db");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE plans (id INTEGER PRIMARY KEY, name TEXT, speed TEXT, download_speed TEXT, upload_speed TEXT, type TEXT, status TEXT);
    CREATE TABLE routers (id INTEGER PRIMARY KEY, name TEXT, area TEXT, enabled INTEGER, is_default INTEGER);
    CREATE TABLE naps (id INTEGER PRIMARY KEY, name TEXT, area TEXT, lat REAL, lng REAL);
    CREATE TABLE olts (id INTEGER PRIMARY KEY, name TEXT, area TEXT, lat REAL, lng REAL);
    CREATE TABLE fiber_lines (id INTEGER PRIMARY KEY, line_type TEXT, from_kind TEXT, from_id INTEGER, to_kind TEXT, to_id INTEGER);
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY, name TEXT, username TEXT, status TEXT, area TEXT, conn_type TEXT,
      mac TEXT, static_ip TEXT, router_id INTEGER, nap_id INTEGER, plan_id INTEGER, account_code TEXT
    );
  `);
  const insert = (sql, values) => db.prepare(sql).run(...values);
  for (const plan of rows.plans || []) insert("INSERT INTO plans VALUES (?,?,?,?,?,?,?)", plan);
  for (const router of rows.routers || []) insert("INSERT INTO routers VALUES (?,?,?,?,?)", router);
  for (const nap of rows.naps || []) insert("INSERT INTO naps VALUES (?,?,?,?,?)", nap);
  for (const olt of rows.olts || []) insert("INSERT INTO olts VALUES (?,?,?,?,?)", olt);
  for (const line of rows.fiber || []) insert("INSERT INTO fiber_lines VALUES (?,?,?,?,?,?)", line);
  for (const customer of rows.customers || []) insert("INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", customer);
  db.close();
  return file;
}

export const sampleBilling = {
  plans: [
    [1, "Home 100", "100-Mbps", "100-Mbps", "100-Mbps", "pppoe", "active"],
    [2, "Day pass", "10M", "10M", "10M", "ipoe", "active"],
  ],
  routers: [
    [5, "Candelaria", "CANDELARIA", 1, 1],
    [6, "Candelaria", "MALUBI", 1, 0],
  ],
  olts: [[4, "EPON PON2", "malbug", 13.9, 121.4]],
  naps: [[19, "MAL.NAP06", "MALBUG", 13.93, 121.42]],
  fiber: [[1, "olt_nap", "olt", 4, "nap", 19]],
  customers: [
    [10, "Ana Cruz", "ana@jm", "active", "MALBUG", "pppoe", "", "", 6, 19, 1, "JM-10"],
    [11, "Plan #2 Site", "ben@jm", "active", "CANDELARIA", "pppoe", "20:AB:48:1F:42:84", "172.9.9.219", 5, null, 2, "JM-11"],
    [12, "Old Account", "old@jm", "suspended", "MALBUG", "pppoe", "", "10.0.0.9", 6, null, 1, "JM-12"],
    [13, "No Router", "walk@jm", "active", "", "pppoe", "", "", null, null, null, ""],
  ],
};
