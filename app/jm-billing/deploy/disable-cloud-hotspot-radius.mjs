#!/usr/bin/env node
/** Turn OFF cloud RADIUS — vouchers go to local MikroTik /ip/hotspot/user per router. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Settings } from "../lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

Settings.set("cloud_hotspot_enabled", "0");
Settings.set("hotspot_central", "0");
console.log("cloud_hotspot_enabled=0");
console.log("hotspot_central=0");
console.log("Restart jm-billing so UDP 1812/1813 RADIUS listener stops.");
