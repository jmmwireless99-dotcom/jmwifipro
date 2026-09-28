/** Covered JM WIFI install areas for jmwifi.pro/apply — municipality then barangay. */

export const APPLY_NOT_FOUND = "__none__";

export const APPLY_NOT_AVAILABLE =
  "Not available pa. Wala pa kaming line sa area ninyo. Hindi kayo maka-proceed.";

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
  PLACER: [
    "CABANGCALAN",
    "MAHAYAHAY",
    "PURO",
    "TAN-AWAN",
  ],
};

export const APPLY_MUNICIPALITIES = Object.keys(APPLY_COVERAGE);

export function foldApplyPlace(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ñ/gi, "n")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function findCoveredMunicipality(name) {
  const key = foldApplyPlace(name);
  if (!key) return "";
  return APPLY_MUNICIPALITIES.find((m) => foldApplyPlace(m) === key) || "";
}

export function findCoveredBarangay(municipality, name) {
  const muni = findCoveredMunicipality(municipality);
  if (!muni) return "";
  const key = foldApplyPlace(name);
  if (!key) return "";
  return (APPLY_COVERAGE[muni] || []).find((b) => foldApplyPlace(b) === key) || "";
}

export function barangaysFor(municipality) {
  const muni = findCoveredMunicipality(municipality);
  return muni ? APPLY_COVERAGE[muni].slice() : [];
}

export function isApplyNotFound(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  if (v === APPLY_NOT_FOUND) return true;
  return /hindi ko makita|not available|wala (pa )?sa listahan/i.test(v);
}

export function resolveApplyCoverage(municipality, barangay) {
  if (isApplyNotFound(barangay) || isApplyNotFound(municipality)) {
    return { ok: false, error: APPLY_NOT_AVAILABLE };
  }
  const muni = findCoveredMunicipality(municipality);
  if (!muni) {
    return { ok: false, error: "Piliin ang municipality sa listahan." };
  }
  const brgy = findCoveredBarangay(muni, barangay);
  if (!brgy) {
    return { ok: false, error: APPLY_NOT_AVAILABLE };
  }
  return { ok: true, municipality: muni, barangay: brgy };
}

export function formatApplyAddress(municipality, barangay, landmark) {
  const extra = String(landmark || "").trim();
  return [extra, barangay, municipality, "Masbate"].filter(Boolean).join(", ");
}
