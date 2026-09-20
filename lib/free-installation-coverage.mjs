/**
 * Free Installation coverage — municipalities stay listed,
 * barangays stay empty until explicitly opened.
 * Current open area: AROROY / MANAMOC only.
 */

export const FREE_INSTALL_NOT_FOUND = "__none__";

export const FREE_INSTALL_NOT_AVAILABLE =
  "Not available pa. Wala pa sa Free Installation list ang address ninyo. Hindi kayo maka-proceed.";

export const FREE_INSTALL_COVERAGE = {
  PALANAS: [],
  CATAINGAN: [],
  CAWAYAN: [],
  USON: [],
  MILAGROS: [],
  AROROY: ["MANAMOC"],
  PLACER: [],
};

export const FREE_INSTALL_MUNICIPALITIES = Object.keys(FREE_INSTALL_COVERAGE);

export function foldFreeInstallPlace(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ñ/gi, "n")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function findFreeInstallMunicipality(name) {
  const key = foldFreeInstallPlace(name);
  if (!key) return "";
  return FREE_INSTALL_MUNICIPALITIES.find((m) => foldFreeInstallPlace(m) === key) || "";
}

export function findFreeInstallBarangay(municipality, name) {
  const muni = findFreeInstallMunicipality(municipality);
  if (!muni) return "";
  const key = foldFreeInstallPlace(name);
  if (!key) return "";
  return (FREE_INSTALL_COVERAGE[muni] || []).find((b) => foldFreeInstallPlace(b) === key) || "";
}

export function barangaysForFreeInstall(municipality) {
  const muni = findFreeInstallMunicipality(municipality);
  return muni ? FREE_INSTALL_COVERAGE[muni].slice() : [];
}

export function isFreeInstallNotFound(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  if (v === FREE_INSTALL_NOT_FOUND) return true;
  return /hindi ko makita|not available|wala (pa )?sa listahan/i.test(v);
}

export function resolveFreeInstallationCoverage(municipality, barangay) {
  if (isFreeInstallNotFound(barangay) || isFreeInstallNotFound(municipality)) {
    return { ok: false, error: FREE_INSTALL_NOT_AVAILABLE };
  }
  const muni = findFreeInstallMunicipality(municipality);
  if (!muni) {
    return { ok: false, error: "Piliin ang municipality sa listahan." };
  }
  const brgy = findFreeInstallBarangay(muni, barangay);
  if (!brgy) {
    return { ok: false, error: FREE_INSTALL_NOT_AVAILABLE };
  }
  return { ok: true, municipality: muni, barangay: brgy };
}

export function formatFreeInstallAddress(municipality, barangay, landmark) {
  const extra = String(landmark || "").trim();
  return [extra, barangay, municipality, "Masbate"].filter(Boolean).join(", ");
}
