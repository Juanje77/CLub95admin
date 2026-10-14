import type ExcelJS from "exceljs";
import { cellValue, colLetter, isoDate, num, str } from "./sheet";
import type { ServiceType } from "../domain/types";

/** Primera y última columna de días (C..AG: la AG es un día extra que el mes siguiente repite). */
export const FIRST_DAY_COL = 3;
export const LAST_DAY_COL = 33;
export const TOTAL_COL = 34; // AH

export type BarberKey = "JERE" | "ALE" | "BENI";

/** Filas de la hoja mensual (estructura de ABR-26 a OCT-26). Se valida contra las etiquetas de la columna B. */
export const LAYOUT = {
  dateRow: 10,
  barbers: {
    JERE: { header: 11, services: { CORTE: 12, CORTE_BARBA: 13, BARBA_CEJAS: 14 }, membership: 15, gross: 19, labor: 87 },
    ALE: { header: 20, services: { CORTE: 21, CORTE_BARBA: 22, BARBA_CEJAS: 23 }, membership: 24, gross: 28, labor: 88 },
    BENI: { header: 29, services: { CORTE: 30, CORTE_BARBA: 31, BARBA_CEJAS: 32 }, membership: 33, gross: 37, labor: 89 },
  },
  looseDrinks: { MONSTER_ROSA: 51, MONSTER_ORIGINAL: 52, MONSTER_MANGO: 53, MONSTER_SIN_AZUCAR: 54, COCA: 55, SPRITE: 56, FANTA: 57, ACQUARIUS: 58 },
  looseDrinksRevenue: 65,
  products: { CERA_1: 67, CERA_2: 68, CERA_3: 69, POLVO: 70, ACEITE: 71 },
  productsRevenue: 78,
  income: 123,
  declared: { MEMBRESIA_EFECTIVO: 128, MEMBRESIA_BANCO: 129, BRUBANK: 130, BRUBANK_JUAN: 131, MP_JERE: 132, EFECTIVO: 133, CAMBIO: 134 },
  closeRow: 137,
} as const;

const EXPECTED_LABELS: [number, string][] = [
  [11, "CANTIDAD DE SERVICIOS"],
  [12, "CORTES SOLO"],
  [13, "CORTE Y BARBA SOLO"],
  [14, "BARBA Y CEJAS SOLO"],
  [15, "CORTES POR MES"],
  [21, "CORTES SOLO"],
  [24, "CORTES POR MES"],
  [30, "CORTES SOLO"],
  [33, "CORTES POR MES"],
  [51, "MONSTER ROSA"],
  [55, "COCA"],
  [58, "ACQUARIUS"],
  [67, "CERA 1"],
  [70, "POLVO"],
  [71, "ACEITE"],
  [123, "TOTAL cortes y venta"],
  [128, "MEMBRESIA EFECTIVO"],
  [130, "BRUBANK"],
  [133, "EFECTIVO"],
  [134, "CAMBIO DEJADO"],
];

export interface SheetParams {
  /** Tarifas "públicas" (B1, B3, B5), usadas por Ale y Beni. */
  base: Record<ServiceType, number>;
  /** Tarifas con las que la hoja valoriza a Jere (L1, L2, L3). */
  jere: Record<ServiceType, number>;
  drinkValue: number; // D1
  drinkValueKids: number; // D5 ("VALOR BEBIDA chicos")
  waxPrice: number; // D2
  powderPrice: number; // D3
  oilPrice: number; // D4
  waxCost: number; // E2
  powderCost: number; // E3
  oilCost: number; // E4
  looseDrinkPrice: Record<string, number>; // I2..I6
  looseDrinkCost: Record<string, number>; // G2..G6
  glassDrinkCost: number; // G7
}

export interface DayData {
  col: number;
  date: string;
  barbers: Record<BarberKey, { services: Record<ServiceType, number>; memberships: number }>;
  looseDrinks: Record<string, number>;
  products: Record<string, number>;
  declared: Record<string, number>;
  /** Valores calculados por la hoja para ese día, para contrastar. */
  sheet: {
    gross: Record<BarberKey, number>;
    labor: Record<BarberKey, number>;
    looseDrinksRevenue: number;
    productsRevenue: number;
    income: number;
    close: number;
  };
}

export interface MonthData {
  sheetName: string;
  params: SheetParams;
  days: DayData[];
  /** Columna(s) cuya fecha cae en otro mes (p. ej. AG = 1/10 dentro de SEP-26). */
  foreignDays: DayData[];
  totals: Record<string, number>; // columna AH por fila
}

export function validateLayout(ws: ExcelJS.Worksheet): string[] {
  const problems: string[] = [];
  for (const [row, label] of EXPECTED_LABELS) {
    const got = str(ws, row, 2);
    if (got.toLowerCase() !== label.toLowerCase()) problems.push(`B${row}: esperaba "${label}", hay "${got}"`);
  }
  return problems;
}

function readDay(ws: ExcelJS.Worksheet, col: number, date: string): DayData {
  const L = LAYOUT;
  const barbers = {} as DayData["barbers"];
  const gross = {} as Record<BarberKey, number>;
  const labor = {} as Record<BarberKey, number>;
  for (const k of Object.keys(L.barbers) as BarberKey[]) {
    const b = L.barbers[k];
    barbers[k] = {
      services: {
        CORTE: num(ws, b.services.CORTE, col),
        CORTE_BARBA: num(ws, b.services.CORTE_BARBA, col),
        BARBA_CEJAS: num(ws, b.services.BARBA_CEJAS, col),
      },
      memberships: num(ws, b.membership, col),
    };
    gross[k] = num(ws, b.gross, col);
    labor[k] = num(ws, b.labor, col);
  }
  const looseDrinks: Record<string, number> = {};
  for (const [name, row] of Object.entries(L.looseDrinks)) looseDrinks[name] = num(ws, row, col);
  const products: Record<string, number> = {};
  for (const [name, row] of Object.entries(L.products)) products[name] = num(ws, row, col);
  const declared: Record<string, number> = {};
  for (const [name, row] of Object.entries(L.declared)) declared[name] = num(ws, row, col);
  return {
    col,
    date,
    barbers,
    looseDrinks,
    products,
    declared,
    sheet: {
      gross,
      labor,
      looseDrinksRevenue: num(ws, L.looseDrinksRevenue, col),
      productsRevenue: num(ws, L.productsRevenue, col),
      income: num(ws, L.income, col),
      close: num(ws, L.closeRow, col),
    },
  };
}

export function readParams(ws: ExcelJS.Worksheet): SheetParams {
  const looseDrinkPrice: Record<string, number> = {
    MONSTER: num(ws, 2, 9),
    COCA: num(ws, 3, 9),
    FANTA: num(ws, 4, 9),
    SPRITE: num(ws, 5, 9),
    ACQUARIUS: num(ws, 6, 9),
  };
  const looseDrinkCost: Record<string, number> = {
    MONSTER: num(ws, 2, 7),
    COCA: num(ws, 3, 7),
    FANTA: num(ws, 4, 7),
    SPRITE: num(ws, 5, 7),
    ACQUARIUS: num(ws, 6, 7),
  };
  return {
    base: { CORTE: num(ws, 1, 2), CORTE_BARBA: num(ws, 3, 2), BARBA_CEJAS: num(ws, 5, 2) },
    jere: { CORTE: num(ws, 1, 12), CORTE_BARBA: num(ws, 2, 12), BARBA_CEJAS: num(ws, 3, 12) },
    drinkValue: num(ws, 1, 4),
    drinkValueKids: num(ws, 5, 4),
    waxPrice: num(ws, 2, 4),
    powderPrice: num(ws, 3, 4),
    oilPrice: num(ws, 4, 4),
    waxCost: num(ws, 2, 5),
    powderCost: num(ws, 3, 5),
    oilCost: num(ws, 4, 5),
    looseDrinkPrice,
    looseDrinkCost,
    glassDrinkCost: num(ws, 7, 7),
  };
}

/** Lee un mes. `yearMonth` = "2026-09". Los días de otro mes quedan en `foreignDays`. */
export function readMonth(ws: ExcelJS.Worksheet, yearMonth: string): MonthData {
  const problems = validateLayout(ws);
  if (problems.length) {
    throw new Error(`La hoja ${ws.name} no tiene la estructura esperada:\n  ${problems.join("\n  ")}`);
  }
  const days: DayData[] = [];
  const foreignDays: DayData[] = [];
  for (let col = FIRST_DAY_COL; col <= LAST_DAY_COL; col++) {
    const v = cellValue(ws.getCell(LAYOUT.dateRow, col));
    if (!(v instanceof Date)) continue;
    const date = isoDate(v);
    (date.startsWith(yearMonth) ? days : foreignDays).push(readDay(ws, col, date));
  }
  const totals: Record<string, number> = {};
  for (let r = 1; r <= 145; r++) totals[`AH${r}`] = num(ws, r, TOTAL_COL);
  return { sheetName: ws.name, params: readParams(ws), days, foreignDays, totals };
}

export { colLetter };
