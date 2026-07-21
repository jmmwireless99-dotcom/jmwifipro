#!/usr/bin/env node
/** Enable Kitifi-style cloud hotspot RADIUS (pause time on disconnect). Safe — settings only. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Settings } from "../lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

Settings.set("cloud_hotspot_enabled", "1");
if (!Settings.get("radius_secret")) Settings.set("radius_secret", "JmWifi@Radius2026!");
if (!Settings.get("radius_host")) Settings.set("radius_host", "187.77.145.131");
console.log("cloud_hotspot_enabled=1");
console.log("radius_host=", Settings.get("radius_host"));
console.log("Restart jm-billing so RADIUS listens on UDP 1812/1813.");
