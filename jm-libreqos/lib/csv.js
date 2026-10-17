export const SHAPED_HEADERS = [
  "Circuit ID",
  "Circuit Name",
  "Device ID",
  "Device Name",
  "Parent Node",
  "Parent Node ID",
  "Anchor Node ID",
  "MAC",
  "IPv4",
  "IPv6",
  "Download Min Mbps",
  "Upload Min Mbps",
  "Download Max Mbps",
  "Upload Max Mbps",
  "Comment",
  "sqm",
];

function escapeCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows) {
  const lines = [SHAPED_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(SHAPED_HEADERS.map((header) => escapeCell(row[header])).join(","));
  }
  return lines.join("\n") + "\n";
}
