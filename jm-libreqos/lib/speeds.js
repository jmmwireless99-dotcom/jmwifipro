/** Parse a JM plan rate into megabits per second. */
export function parseMbps(raw) {
  if (raw == null) return null;
  let text = String(raw).trim().toLowerCase();
  if (!text) return null;
  if (text.includes("/")) text = text.split("/")[0].trim();
  text = text.replace(/bps/g, "").replace(/-/g, "").replace(/\s+/g, "");
  const match = text.match(/^([0-9]*\.?[0-9]+)([gmk])?$/);
  if (!match) {
    const loose = text.match(/([0-9]*\.?[0-9]+)/);
    if (!loose) return null;
    const n = Number(loose[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (match[2] === "g") return value * 1000;
  if (match[2] === "k") return value / 1000;
  return value;
}

export function formatRate(mbps) {
  const rounded = roundRate(mbps);
  if (!Number.isFinite(rounded)) return "0";
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function roundRate(mbps) {
  return Math.round(Number(mbps) * 100) / 100;
}

/**
 * LibreQoS circuit rates. Min is the guaranteed floor. Max is the plan
 * multiplied by headroom so a speed test still clears while CAKE is working.
 */
export function circuitRates(downRaw, upRaw, settings) {
  const headroom = Number(settings.headroom) > 0 ? Number(settings.headroom) : 1;
  const floor = Number(settings.minMbps) > 0 ? Number(settings.minMbps) : 1;
  const fallback = Number(settings.fallbackMbps) > 0 ? Number(settings.fallbackMbps) : 10;
  let down = parseMbps(downRaw);
  let up = parseMbps(upRaw);
  const usedFallback = down == null && up == null;
  if (down == null) down = up == null ? fallback : up;
  if (up == null) up = down;
  let downloadMax = Math.max(0.01, roundRate(down * headroom));
  let uploadMax = Math.max(0.01, roundRate(up * headroom));
  let downloadMin = Math.min(floor, downloadMax);
  let uploadMin = Math.min(floor, uploadMax);
  downloadMin = roundRate(Math.max(0.01, downloadMin));
  uploadMin = roundRate(Math.max(0.01, uploadMin));
  return {
    downloadMin,
    uploadMin,
    downloadMax,
    uploadMax,
    usedFallback,
  };
}
