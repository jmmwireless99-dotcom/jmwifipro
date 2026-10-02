#!/usr/bin/env python3
"""
Import Excel-style monthly vendo sales into sales-history.json entries.

Format (TSV):
  VENDO LIST | VENDO NAME | JANUARY ... DECEMBER

Each non-empty monthly cell becomes one entry:
  { municipality, barangay, vendo, month: YYYY-MM, date: YYYY-MM-01, amount }
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

YEAR = 2026
MONTHS = [
    ("JANUARY", "01"),
    ("FEBRUARY", "02"),
    ("MARCH", "03"),
    ("APRIL", "04"),
    ("MAY", "05"),
    ("JUNE", "06"),
    ("JULY", "07"),
    ("AUGUST", "08"),
    ("SEPTEMBER", "09"),
    ("OCTOBER", "10"),
    ("NOVEMBER", "11"),
    ("DECEMBER", "12"),
]

# Excel "VENDO LIST" label → (municipality, barangay)
# Prefer apply-coverage names; keep Excel barangay text when not in coverage.
BRGY_MAP = {
    "CADULAWAN": ("CATAINGAN", "CADULAWAN"),
    "MALBUG": ("CAWAYAN", "MALBUG"),
    "LAGUE-LAGUE": ("CAWAYAN", "LAGUE-LAGUE"),
    "TABERNA": ("CAWAYAN", "TABERNA"),
    "CABAYUGAN": ("CAWAYAN", "CABAYUGAN"),
    "BUGTONG": ("CAWAYAN", "BUGTONG"),
    "CALERO": ("CAWAYAN", "CALERO"),
    "MACTAN": ("CAWAYAN", "MACTAN"),
    "DEL CARMEN": ("USON", "DEL CARMEN"),
    "TUBURAN": ("CAWAYAN", "TUBURAN"),
    "SAN JOSE": ("CAWAYAN", "SAN JOSE"),
    "TUBOG": ("CAWAYAN", "TUBOG"),
    "DALIPE": ("CAWAYAN", "DALIPE"),
    "IRAYA": ("CAWAYAN", "IRAYA"),
    "CALUMPANG": ("CAWAYAN", "CALUMPANG"),
    "MADBAD": ("CAWAYAN", "MADBAD"),
    "SAN VICENTE": ("CAWAYAN", "SAN VICENTE"),
    "CALAPAYAN": ("CAWAYAN", "CALAPAYAN"),
    "CABANGCALAN": ("PLACER", "CABANGCALAN"),
    "TAN-AWAN": ("PLACER", "TAN-AWAN"),
    "PURO": ("PLACER", "PURO"),
    "VILLAHERMOSA": ("CAWAYAN", "VILLAHERMOSA"),
    "CALMAD": ("CAWAYAN", "CALMAD"),
    "DEL ROSARIO": ("USON", "DEL ROSARIO"),
    "NABUHAY": ("USON", "NABUHAY"),
    "MONGGAHAY": ("USON", "MONGAHAY"),
    "MONGAHAY": ("USON", "MONGAHAY"),
    "MAIHAO": ("CAWAYAN", "MAIHAO"),
    "PIN-AS": ("CAWAYAN", "PIN-AS"),
    "SAN RAMON": ("USON", "SAN RAMON"),
    "SAN ISIDRO": ("USON", "SAN ISIDRO"),
    "MATAGBAC": ("MILAGROS", "MATAGBAC"),
    "SAWMILL": ("MILAGROS", "SAWMILL"),
    "INTUSAN": ("PALANAS", "INTUSAN"),
    "VILLAPUGADO": ("PALANAS", "VILLAPUGADO"),
    "MAANAHAO": ("PALANAS", "MAANAHAO"),
    "PULOT": ("CAWAYAN", "PULOT"),
    "BANCO": ("PALANAS", "BANCO"),
    "MABINI": ("PALANAS", "MABINI"),
    "SALVACION": ("PALANAS", "SALVACION"),
    "TINURIAN": ("PALANAS", "TINURIAN"),
    "PALOBANDERA": ("CAWAYAN", "PALOBANDERA"),
    "LIONG": ("CATAINGAN", "LIONG"),
    "SAN CARLOS PAL.": ("PALANAS", "SAN CARLOS"),
    "SAN CARLOS PAL": ("PALANAS", "SAN CARLOS"),
    "SAN CARLOS": ("PALANAS", "SAN CARLOS"),
    "MATUBINAO": ("CATAINGAN", "MATUBINAO"),
    "OSMENA": ("CATAINGAN", "OSMENIA"),
    "OSMENIA": ("CATAINGAN", "OSMENIA"),
    "CANDELARIA": ("USON", "CANDELARIA"),
    "BARA": ("MILAGROS", "BARA"),
    "BONIFACIO": ("USON", "BONIFACIO"),
    "ILIHAN": ("MILAGROS", "ILIHAN"),
    "R.M/ FULL OUT": ("CAWAYAN", "R.M FULL OUT"),
    "R.M/ Full out": ("CAWAYAN", "R.M FULL OUT"),
    "MAHAYAHAY": ("PLACER", "MAHAYAHAY"),
    "PANAN-AWAN": ("CAWAYAN", "PANAN-AWAN"),
    "LIBERTAD USON": ("USON", "LIBERTAD"),
    "LIBERTAD": ("USON", "LIBERTAD"),
}


def parse_amount(cell: str):
    s = (cell or "").strip()
    if not s:
        return None
    upper = s.upper()
    if upper in {"FULL OUT", "TOTAL", "OVERALL TOTAL", "N/A", "-"}:
        return None
    # keep explicit 0.00
    s = s.replace(",", "").replace("₱", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def norm_brgy(label: str) -> str:
    return re.sub(r"\s+", " ", (label or "").strip()).upper()


def resolve_area(label: str):
    key = norm_brgy(label)
    if key in BRGY_MAP:
        return BRGY_MAP[key]
    # fuzzy: strip trailing dots
    key2 = key.rstrip(".")
    if key2 in BRGY_MAP:
        return BRGY_MAP[key2]
    # default: store under UNKNOWN municipality with excel label as barangay
    return ("UNKNOWN", key)


def parse_tsv(text: str):
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    # Dedupe: stop at second header or after first OVERALL TOTAL
    seen_header = 0
    rows = []
    for line in lines:
        if not line.strip():
            continue
        cols = line.split("\t")
        head = (cols[0] if cols else "").strip().upper()
        if head == "VENDO LIST":
            seen_header += 1
            if seen_header > 1:
                break
            continue
        if head.startswith("OVERALL TOTAL"):
            rows.append(cols)
            break
        rows.append(cols)

    current_brgy = ""
    entries = []
    seq = 0
    skipped_total = 0
    skipped_empty_vendo = 0
    month_counts = {m: 0 for _, m in MONTHS}
    unknown_areas = set()

    for cols in rows:
        # pad to at least 14 cols (list, name, 12 months)
        while len(cols) < 14:
            cols.append("")
        area = cols[0].strip()
        vendo = cols[1].strip()
        if area:
            current_brgy = area
        area_u = norm_brgy(current_brgy)
        vendo_u = vendo.upper()
        if not current_brgy:
            continue
        if area_u in {"TOTAL", "OVERALL TOTAL"} or vendo_u in {"TOTAL", "OVERALL TOTAL"}:
            skipped_total += 1
            continue
        if area_u.startswith("OVERALL"):
            skipped_total += 1
            continue
        # orphan amount row with blank vendo (e.g. Bonifacio blank line) — skip
        if not vendo:
            # if any amounts present without vendo name, skip
            skipped_empty_vendo += 1
            continue

        muni, brgy = resolve_area(current_brgy)
        if muni == "UNKNOWN":
            unknown_areas.add(current_brgy)

        for i, (_name, mm) in enumerate(MONTHS):
            amt = parse_amount(cols[2 + i] if 2 + i < len(cols) else "")
            if amt is None:
                continue
            seq += 1
            month = f"{YEAR}-{mm}"
            month_counts[mm] += 1
            entries.append(
                {
                    "id": f"sh_xl_{YEAR}{mm}_{seq:05d}",
                    "municipality": muni,
                    "barangay": brgy,
                    "vendo": vendo,
                    "month": month,
                    "date": f"{month}-01",
                    "amount": round(amt, 2),
                    "createdAt": f"{YEAR}-{mm}-01T00:00:00.000Z",
                    "source": "excel-import",
                }
            )

    return {
        "entries": entries,
        "stats": {
            "entry_count": len(entries),
            "skipped_total_rows": skipped_total,
            "skipped_empty_vendo": skipped_empty_vendo,
            "month_counts": month_counts,
            "unknown_areas": sorted(unknown_areas),
            "muni_counts": {},
        },
    }


def main():
    in_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/jm-excel-import/vendos.tsv")
    out_path = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/jm-excel-import/sales-history.json")
    text = in_path.read_text(encoding="utf-8")
    result = parse_tsv(text)
    muni_counts = {}
    for e in result["entries"]:
        muni_counts[e["municipality"]] = muni_counts.get(e["municipality"], 0) + 1
    result["stats"]["muni_counts"] = dict(sorted(muni_counts.items()))
    # verify against Excel overall monthly totals when present
    excel_overall = {
        "01": 804800,
        "02": 742162,
        "03": 658754,
        "04": 782073,
        "05": 964812,
        "06": 853243,
        "07": 694297,
        "08": 608067,
        "09": 230139,
        "10": 0,
        "11": 0,
        "12": 0,
    }
    our = {mm: 0.0 for mm in excel_overall}
    for e in result["entries"]:
        mm = e["month"].split("-")[1]
        our[mm] += e["amount"]
    diffs = {}
    for mm, expected in excel_overall.items():
        got = round(our[mm], 2)
        diffs[mm] = {"expected": expected, "got": got, "delta": round(got - expected, 2)}
    result["stats"]["total_amount"] = round(sum(e["amount"] for e in result["entries"]), 2)
    result["stats"]["month_total_check"] = diffs

    out_path.write_text(json.dumps({"entries": result["entries"]}, indent=2), encoding="utf-8")
    Path(str(out_path) + ".stats.json").write_text(json.dumps(result["stats"], indent=2), encoding="utf-8")
    print(json.dumps(result["stats"], indent=2))
    print("wrote", out_path, "entries", len(result["entries"]))


if __name__ == "__main__":
    main()
