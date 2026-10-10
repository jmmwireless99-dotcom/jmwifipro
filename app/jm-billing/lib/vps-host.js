// VPS (host) CPU / RAM status for the ops dashboard.
import os from "node:os";

let _prev = null;
let _cpuPct = 0;

function sampleCpu() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  if (_prev && total > _prev.total) {
    const di = idle - _prev.idle;
    const dt = total - _prev.total;
    if (dt > 0) _cpuPct = Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100)));
  }
  _prev = { idle, total };
}

sampleCpu();
setInterval(sampleCpu, 2000).unref?.();

export function vpsHostStatus() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  const usedPct = total ? Math.round((used / total) * 100) : 0;
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    uptime_secs: Math.floor(os.uptime()),
    cpu_pct: _cpuPct,
    cpu_cores: os.cpus().length,
    loadavg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    ram_total: total,
    ram_free: free,
    ram_used: used,
    ram_used_pct: usedPct,
  };
}
