/** Covered JM WIFI install areas from jmwifi.pro/apply — municipality → barangay. */

export const APPLY_NOT_FOUND = "__none__";

export const APPLY_NOT_AVAILABLE =
  "Not available pa. Wala pa kaming line sa area ninyo. Hindi kayo maka-proceed.";

/** Same list as live APPLY_COVERAGE on https://jmwifi.pro/apply */
export const APPLY_COVERAGE = {
  PALANAS: [
    "ANTIPOLO",
    "BANCO",
    "BIGA-A",
    "BONTOD",
    "BUENASUERTE",
    "INTUSAN",
    "MAANAHAO",
    "MABINI",
    "MALATAWAN",
    "MALIBAS",
    "NABANGIG",
    "PARINA",
    "PIÑA",
    "POBLACION",
    "SALVACION",
    "SAN ANTONIO",
    "SAN CARLOS",
    "SAN ISIDRO",
  ],
  CATAINGAN: [
    "CADULAWAN",
    "CAGBATANG",
    "ESTAMPAR",
    "LIONG",
    "MAANAHAO",
    "MATUBINAO",
    "OSMENIA",
    "SAN ISIDRO",
  ],
  CAWAYAN: [
    "CABAYUGAN",
    "CALAPAYAN",
    "CALUMPANG",
    "CHICO ISLAND",
    "DALIPE",
    "DIVISORIA",
    "IRAYA",
    "LAGUE-LAGUE",
    "LIBERTAD",
    "MACTAN",
    "MADBAD",
    "MAIHAO",
    "MALBUG",
    "PALOBANDERA",
    "PANAN-AWAN",
    "PEÑA ISLAND",
    "PIN-AS",
    "POBLACION",
    "PULOT",
    "SAN JOSE",
    "SAN VICENTE",
    "TABERNA",
    "TALISAY",
    "TUBOG",
    "TUBURAN",
    "VILLAHERMOSA",
    "VILLAGANAS VILLAGE",
  ],
  USON: [
    "ARADO",
    "AURORA",
    "BONIFACIO",
    "BUENASUERTE",
    "BUENAVISTA",
    "CAMPANA",
    "CANDELARIA",
    "DEL CARMEN",
    "DEL ROSARIO",
    "LIBERTAD",
    "MABINI",
    "NABUHAY",
    "MAGSAYSAY",
    "MONGAHAY",
    "PAGUIHAMAN",
    "SAN ISIDRO",
    "SAN JOSE",
    "SAN MATEO",
    "SAN RAMON",
    "SAN VICENTE",
  ],
  MILAGROS: [
    "BARA",
    "BURABOD",
    "BURUNGON",
    "MATAGBAC",
    "SAN CARLOS",
    "SAWMILL",
    "TESA",
    "CAMARIN",
  ],
  AROROY: [
    "AMOTAG",
    "BAGAUMA",
    "BALETE",
    "CABAS-AN",
    "CONCEPTION",
    "BART-AG",
    "DAYHAGAN",
    "MACABUG",
    "MALUBI",
    "MANAMOC",
    "MARIPOSA",
    "MATUNGOG",
    "PANIQUE",
    "DON PABLO",
    "TINIGBAN",
  ],
  PLACER: ["CABANGCALAN", "MAHAYAHAY", "PURO", "TAN-AWAN"],
};

/** Flat list of { municipality, barangay } for every covered area. */
export function listAllBarangays(coverage = APPLY_COVERAGE) {
  const out = [];
  for (const municipality of Object.keys(coverage)) {
    for (const barangay of coverage[municipality]) {
      out.push({ municipality, barangay });
    }
  }
  return out;
}

export function resolveApplyCoverage(municipality, barangay, coverage = APPLY_COVERAGE) {
  const m = String(municipality || "")
    .trim()
    .toUpperCase();
  const b = String(barangay || "")
    .trim()
    .toUpperCase();
  if (!m || !b || b === APPLY_NOT_FOUND) {
    return { ok: false, error: APPLY_NOT_AVAILABLE };
  }
  const list = coverage[m] || [];
  if (list.indexOf(b) < 0) {
    return { ok: false, error: APPLY_NOT_AVAILABLE };
  }
  return { ok: true, municipality: m, barangay: b };
}

export function formatApplyAddress(municipality, barangay, landmark) {
  const parts = [String(landmark || "").trim(), barangay, municipality, "Masbate"].filter(Boolean);
  return parts.join(", ");
}
