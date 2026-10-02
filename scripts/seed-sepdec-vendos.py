
import json, time
from collections import defaultdict
from pathlib import Path

FILE = Path("/opt/jm-billing/data/sales-history.json")
BACKUP = Path("/opt/jm-billing/data/backups")
BACKUP.mkdir(parents=True, exist_ok=True)
raw = json.loads(FILE.read_text())
entries = raw if isinstance(raw, list) else list(raw.get("entries") or [])
ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
(BACKUP / f"sales-history.before-sepdec-{ts}.json").write_text(json.dumps({"entries": entries}, indent=2))

# index existing
have = set()
for e in entries:
    have.add((str(e.get("municipality","")).upper(), str(e.get("barangay","")).upper(), str(e.get("vendo","")).strip(), str(e.get("month",""))))

vendos = sorted({
    (str(e.get("municipality","")).upper(), str(e.get("barangay","")).upper(), str(e.get("vendo","")).strip())
    for e in entries
    if e.get("municipality") and e.get("barangay") and e.get("vendo")
})

months = ["2026-09", "2026-10", "2026-11", "2026-12"]
added = 0
seq = 0
for muni, brgy, vendo in vendos:
    for month in months:
        key = (muni, brgy, vendo, month)
        if key in have:
            continue
        seq += 1
        entries.append({
            "id": f"sh_seed_{month.replace('-','')}_{seq:05d}",
            "municipality": muni,
            "barangay": brgy,
            "vendo": vendo,
            "month": month,
            "date": f"{month}-01",
            "amount": 0,
            "createdAt": f"{month}-01T00:00:00.000Z",
            "source": "sep-dec-seed",
        })
        have.add(key)
        added += 1

entries.sort(key=lambda e: (e.get("municipality",""), e.get("barangay",""), e.get("vendo",""), e.get("month","")))
FILE.write_text(json.dumps({"entries": entries}, indent=2))

# stats
by_m = defaultdict(int)
for e in entries:
    by_m[e.get("month","")] += 1
print(json.dumps({
    "vendos": len(vendos),
    "added": added,
    "total_entries": len(entries),
    "month_counts": dict(sorted(by_m.items())),
}, indent=2))
