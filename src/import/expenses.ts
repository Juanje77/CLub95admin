import type ExcelJS from "exceljs";
import { cellValue, isoDate, num, str } from "./sheet";
import type { Issue } from "./verify";

import { CONCEPT_CATEGORY, type ExpenseCategory } from "../domain/concepts";
export { CONCEPT_CATEGORY, type ExpenseCategory };

export interface ExpenseRow {
  row: number;
  date: string;
  monthText: string;
  concept: string; // normalizado en mayúsculas
  rawConcept: string;
  amount: number;
  description: string;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function readExpenses(ws: ExcelJS.Worksheet): ExpenseRow[] {
  const out: ExpenseRow[] = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const d = cellValue(ws.getCell(r, 1));
    const concept = str(ws, r, 3);
    if (!(d instanceof Date) || !concept) continue;
    out.push({
      row: r,
      date: isoDate(d),
      monthText: str(ws, r, 2).toLowerCase(),
      concept: concept.toUpperCase(),
      rawConcept: concept,
      amount: num(ws, r, 4),
      description: str(ws, r, 5),
    });
  }
  return out;
}

/** Columna de TOTALES de cada mes (C = enero). */
export function totalsColumn(yearMonth: string): number {
  const m = Number(yearMonth.slice(5, 7));
  return 2 + m;
}

export function verifyExpenses(all: ExpenseRow[], totals: ExcelJS.Worksheet, yearMonth: string): { rows: ExpenseRow[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const monthName = MONTHS[Number(yearMonth.slice(5, 7)) - 1]!;
  const byDate = all.filter((e) => e.date.startsWith(yearMonth));
  const byText = all.filter((e) => e.monthText === monthName);
  // La hoja TOTALES suma por el texto de la columna MES, no por la fecha: si no coinciden, hay un gasto "en otro mes".
  for (const e of all) {
    const dateMonthName = MONTHS[Number(e.date.slice(5, 7)) - 1];
    if (e.monthText !== dateMonthName && (e.date.startsWith(yearMonth) || e.monthText === monthName)) {
      issues.push({ severity: "WARN", code: "GASTO_MES_NO_COINCIDE", message: `Gastos fila ${e.row}: fecha ${e.date} pero MES="${e.monthText}" (${e.rawConcept} $ ${e.amount.toLocaleString("es-AR")})` });
    }
  }
  for (const e of byDate) {
    if (!(e.concept in CONCEPT_CATEGORY)) {
      issues.push({ severity: "ERROR", code: "CONCEPTO_DESCONOCIDO", message: `Gastos fila ${e.row}: concepto "${e.rawConcept}" sin categoría` });
    }
    if (e.rawConcept !== e.rawConcept.toUpperCase()) {
      issues.push({ severity: "INFO", code: "CONCEPTO_NORMALIZADO", message: `Gastos fila ${e.row}: "${e.rawConcept}" se carga como "${e.concept}"` });
    }
  }
  // Control contra TOTALES por concepto (rango de gastos, filas 50-95).
  const col = totalsColumn(yearMonth);
  const sumsText = new Map<string, number>();
  for (const e of byText) sumsText.set(e.concept, (sumsText.get(e.concept) ?? 0) + e.amount);
  const labelsSeen = new Set<string>();
  for (let r = 50; r <= 95; r++) {
    const label = str(totals, r, 2).toUpperCase();
    if (!(label in CONCEPT_CATEGORY) || label === "TV" || label === "ESTUFA") continue;
    labelsSeen.add(label);
    const sheetVal = num(totals, r, col);
    const mine = sumsText.get(label) ?? 0;
    if (Math.abs(sheetVal - mine) > 0.5) {
      issues.push({ severity: "WARN", code: "GASTOS_VS_TOTALES", message: `${label}: TOTALES ${sheetVal.toLocaleString("es-AR")} vs suma de Gastos ${mine.toLocaleString("es-AR")}` });
    }
  }
  for (const [concept, amount] of sumsText) {
    if (!labelsSeen.has(concept)) {
      issues.push({ severity: "WARN", code: "GASTO_NO_ESTA_EN_TOTALES", message: `${concept} ($ ${amount.toLocaleString("es-AR")}) está en Gastos pero no tiene fila en TOTALES: no entra en el resultado del mes` });
    }
  }
  return { rows: byDate, issues };
}
