/**
 * Manual Excel-like sales history (edit this file to encode sales).
 *
 * Columns (parang Excel sheet):
 *   date          | YYYY-MM-DD
 *   municipality  | from APPLY_COVERAGE (jmwifi.pro/apply)
 *   barangay      | from APPLY_COVERAGE
 *   vendo         | vendo / hotspot machine name
 *   amount        | peso sales for that day (number)
 *   note          | optional
 *
 * Magdagdag lang ng bagong row sa array — automatic mag-update ang dashboard.
 */

/** @typedef {{ date: string, municipality: string, barangay: string, vendo: string, amount: number, note?: string }} SalesRow */

/** @type {SalesRow[]} */
export const SALES_ROWS = [
  // —— USON / CANDELARIA ——
  { date: "2026-08-04", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Plaza", amount: 1850, note: "week 1" },
  { date: "2026-08-11", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Plaza", amount: 2100, note: "" },
  { date: "2026-08-18", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Plaza", amount: 1980, note: "" },
  { date: "2026-08-25", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Plaza", amount: 2250, note: "" },
  { date: "2026-09-01", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Plaza", amount: 2400, note: "" },
  { date: "2026-09-08", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Plaza", amount: 2150, note: "" },
  { date: "2026-09-15", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Plaza", amount: 2680, note: "" },
  { date: "2026-09-22", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Plaza", amount: 2510, note: "" },
  { date: "2026-09-29", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Plaza", amount: 2890, note: "" },
  { date: "2026-10-01", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Plaza", amount: 1320, note: "partial week" },
  { date: "2026-09-08", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Crossing", amount: 980, note: "new vendo" },
  { date: "2026-09-15", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Crossing", amount: 1120, note: "" },
  { date: "2026-09-22", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Crossing", amount: 1050, note: "" },
  { date: "2026-09-29", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Crossing", amount: 1210, note: "" },
  { date: "2026-10-01", municipality: "USON", barangay: "CANDELARIA", vendo: "Vendo Candelaria Crossing", amount: 640, note: "" },

  // —— USON / SAN RAMON ——
  { date: "2026-08-05", municipality: "USON", barangay: "SAN RAMON", vendo: "Vendo San Ramon Proper", amount: 1420, note: "" },
  { date: "2026-08-12", municipality: "USON", barangay: "SAN RAMON", vendo: "Vendo San Ramon Proper", amount: 1580, note: "" },
  { date: "2026-08-19", municipality: "USON", barangay: "SAN RAMON", vendo: "Vendo San Ramon Proper", amount: 1490, note: "" },
  { date: "2026-08-26", municipality: "USON", barangay: "SAN RAMON", vendo: "Vendo San Ramon Proper", amount: 1710, note: "" },
  { date: "2026-09-02", municipality: "USON", barangay: "SAN RAMON", vendo: "Vendo San Ramon Proper", amount: 1650, note: "" },
  { date: "2026-09-09", municipality: "USON", barangay: "SAN RAMON", vendo: "Vendo San Ramon Proper", amount: 1820, note: "" },
  { date: "2026-09-16", municipality: "USON", barangay: "SAN RAMON", vendo: "Vendo San Ramon Proper", amount: 1740, note: "" },
  { date: "2026-09-23", municipality: "USON", barangay: "SAN RAMON", vendo: "Vendo San Ramon Proper", amount: 1910, note: "" },
  { date: "2026-09-30", municipality: "USON", barangay: "SAN RAMON", vendo: "Vendo San Ramon Proper", amount: 1880, note: "" },
  { date: "2026-10-01", municipality: "USON", barangay: "SAN RAMON", vendo: "Vendo San Ramon Proper", amount: 720, note: "" },

  // —— USON / MAGSAYSAY ——
  { date: "2026-09-03", municipality: "USON", barangay: "MAGSAYSAY", vendo: "Vendo Magsaysay Hub", amount: 1100, note: "" },
  { date: "2026-09-10", municipality: "USON", barangay: "MAGSAYSAY", vendo: "Vendo Magsaysay Hub", amount: 1250, note: "" },
  { date: "2026-09-17", municipality: "USON", barangay: "MAGSAYSAY", vendo: "Vendo Magsaysay Hub", amount: 1180, note: "" },
  { date: "2026-09-24", municipality: "USON", barangay: "MAGSAYSAY", vendo: "Vendo Magsaysay Hub", amount: 1340, note: "" },
  { date: "2026-10-01", municipality: "USON", barangay: "MAGSAYSAY", vendo: "Vendo Magsaysay Hub", amount: 560, note: "" },

  // —— CAWAYAN / MALBUG ——
  { date: "2026-08-06", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Center", amount: 2200, note: "" },
  { date: "2026-08-13", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Center", amount: 2450, note: "" },
  { date: "2026-08-20", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Center", amount: 2310, note: "" },
  { date: "2026-08-27", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Center", amount: 2580, note: "" },
  { date: "2026-09-03", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Center", amount: 2700, note: "" },
  { date: "2026-09-10", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Center", amount: 2620, note: "" },
  { date: "2026-09-17", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Center", amount: 2890, note: "" },
  { date: "2026-09-24", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Center", amount: 2750, note: "" },
  { date: "2026-10-01", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Center", amount: 980, note: "" },
  { date: "2026-09-10", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Market", amount: 870, note: "" },
  { date: "2026-09-17", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Market", amount: 940, note: "" },
  { date: "2026-09-24", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Market", amount: 910, note: "" },
  { date: "2026-10-01", municipality: "CAWAYAN", barangay: "MALBUG", vendo: "Vendo Malbug Market", amount: 410, note: "" },

  // —— CAWAYAN / POBLACION ——
  { date: "2026-09-05", municipality: "CAWAYAN", barangay: "POBLACION", vendo: "Vendo Cawayan Pob", amount: 3100, note: "" },
  { date: "2026-09-12", municipality: "CAWAYAN", barangay: "POBLACION", vendo: "Vendo Cawayan Pob", amount: 3350, note: "" },
  { date: "2026-09-19", municipality: "CAWAYAN", barangay: "POBLACION", vendo: "Vendo Cawayan Pob", amount: 3220, note: "" },
  { date: "2026-09-26", municipality: "CAWAYAN", barangay: "POBLACION", vendo: "Vendo Cawayan Pob", amount: 3480, note: "" },
  { date: "2026-10-01", municipality: "CAWAYAN", barangay: "POBLACION", vendo: "Vendo Cawayan Pob", amount: 1200, note: "" },

  // —— PALANAS / POBLACION ——
  { date: "2026-09-04", municipality: "PALANAS", barangay: "POBLACION", vendo: "Vendo Palanas Town", amount: 1600, note: "" },
  { date: "2026-09-11", municipality: "PALANAS", barangay: "POBLACION", vendo: "Vendo Palanas Town", amount: 1720, note: "" },
  { date: "2026-09-18", municipality: "PALANAS", barangay: "POBLACION", vendo: "Vendo Palanas Town", amount: 1680, note: "" },
  { date: "2026-09-25", municipality: "PALANAS", barangay: "POBLACION", vendo: "Vendo Palanas Town", amount: 1810, note: "" },
  { date: "2026-10-01", municipality: "PALANAS", barangay: "POBLACION", vendo: "Vendo Palanas Town", amount: 690, note: "" },

  // —— AROROY / BALETE ——
  { date: "2026-09-07", municipality: "AROROY", barangay: "BALETE", vendo: "Vendo Balete Port", amount: 920, note: "" },
  { date: "2026-09-14", municipality: "AROROY", barangay: "BALETE", vendo: "Vendo Balete Port", amount: 1050, note: "" },
  { date: "2026-09-21", municipality: "AROROY", barangay: "BALETE", vendo: "Vendo Balete Port", amount: 990, note: "" },
  { date: "2026-09-28", municipality: "AROROY", barangay: "BALETE", vendo: "Vendo Balete Port", amount: 1140, note: "" },
  { date: "2026-10-01", municipality: "AROROY", barangay: "BALETE", vendo: "Vendo Balete Port", amount: 430, note: "" },

  // —— MILAGROS / SAWMILL ——
  { date: "2026-09-06", municipality: "MILAGROS", barangay: "SAWMILL", vendo: "Vendo Sawmill Stop", amount: 780, note: "" },
  { date: "2026-09-13", municipality: "MILAGROS", barangay: "SAWMILL", vendo: "Vendo Sawmill Stop", amount: 850, note: "" },
  { date: "2026-09-20", municipality: "MILAGROS", barangay: "SAWMILL", vendo: "Vendo Sawmill Stop", amount: 810, note: "" },
  { date: "2026-09-27", municipality: "MILAGROS", barangay: "SAWMILL", vendo: "Vendo Sawmill Stop", amount: 890, note: "" },
  { date: "2026-10-01", municipality: "MILAGROS", barangay: "SAWMILL", vendo: "Vendo Sawmill Stop", amount: 350, note: "" },

  // —— PLACER / PURO ——
  { date: "2026-09-09", municipality: "PLACER", barangay: "PURO", vendo: "Vendo Puro Hub", amount: 640, note: "" },
  { date: "2026-09-16", municipality: "PLACER", barangay: "PURO", vendo: "Vendo Puro Hub", amount: 710, note: "" },
  { date: "2026-09-23", municipality: "PLACER", barangay: "PURO", vendo: "Vendo Puro Hub", amount: 680, note: "" },
  { date: "2026-09-30", municipality: "PLACER", barangay: "PURO", vendo: "Vendo Puro Hub", amount: 750, note: "" },
  { date: "2026-10-01", municipality: "PLACER", barangay: "PURO", vendo: "Vendo Puro Hub", amount: 280, note: "" },

  // —— CATAINGAN / OSMENIA ——
  { date: "2026-09-08", municipality: "CATAINGAN", barangay: "OSMENIA", vendo: "Vendo Osmenia", amount: 530, note: "" },
  { date: "2026-09-15", municipality: "CATAINGAN", barangay: "OSMENIA", vendo: "Vendo Osmenia", amount: 610, note: "" },
  { date: "2026-09-22", municipality: "CATAINGAN", barangay: "OSMENIA", vendo: "Vendo Osmenia", amount: 580, note: "" },
  { date: "2026-09-29", municipality: "CATAINGAN", barangay: "OSMENIA", vendo: "Vendo Osmenia", amount: 650, note: "" },
  { date: "2026-10-01", municipality: "CATAINGAN", barangay: "OSMENIA", vendo: "Vendo Osmenia", amount: 240, note: "" },
];
