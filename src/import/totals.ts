import type ExcelJS from "exceljs";
import { SERVICE_TYPES, type ServiceType } from "../domain/types";
import { num } from "./sheet";
import { totalsColumn } from "./expenses";
import type { BarberKey, DayData, MonthData } from "./month";
import type { Issue } from "./verify";

const KEYS: BarberKey[] = ["JERE", "ALE", "BENI"];
// Filas de TOTALES: cantidades por tipo, ingresos por tipo, mano de obra por barbero.
const QTY_ROW: Record<ServiceType, number> = { CORTE: 3, CORTE_BARBA: 5, BARBA_CEJAS: 7 };
const INCOME_ROW: Record<ServiceType, number> = { CORTE: 10, CORTE_BARBA: 12, BARBA_CEJAS: 14 };
const LABOR_ROW: Record<BarberKey, number> = { JERE: 28, ALE: 30, BENI: 31 };

function aggregate(days: DayData[], m: MonthData) {
  const qty = { CORTE: 0, CORTE_BARBA: 0, BARBA_CEJAS: 0 } as Record<ServiceType, number>;
  const income = { CORTE: 0, CORTE_BARBA: 0, BARBA_CEJAS: 0 } as Record<ServiceType, number>;
  const memberships = { n: 0 };
  const labor = { JERE: 0, ALE: 0, BENI: 0 } as Record<BarberKey, number>;
  for (const d of days) {
    for (const k of KEYS) {
      const prices = k === "JERE" ? m.params.jere : m.params.base;
      for (const t of SERVICE_TYPES) {
        qty[t] += d.barbers[k].services[t];
        income[t] += d.barbers[k].services[t] * prices[t];
      }
      memberships.n += d.barbers[k].memberships;
      labor[k] += d.sheet.labor[k];
    }
  }
  return { qty, income, labor, memberships: memberships.n };
}

/** Compara los totales del mes contra la columna del mes en TOTALES. */
export function verifyTotals(m: MonthData, totals: ExcelJS.Worksheet, yearMonth: string): { issues: Issue[]; matched: number; compared: number } {
  const issues: Issue[] = [];
  const col = totalsColumn(yearMonth);
  const own = aggregate(m.days, m);
  const withForeign = aggregate([...m.days, ...m.foreignDays], m);
  let matched = 0;
  let compared = 0;
  const check = (label: string, sheetVal: number, a: number, b: number) => {
    compared++;
    if (sheetVal === a) matched++;
    else if (sheetVal === b) {
      matched++;
      if (a !== b) issues.push({ severity: "INFO", code: "TOTALES_INCLUYE_OTRO_MES", message: `${label}: TOTALES ${sheetVal.toLocaleString("es-AR")} incluye el día de otro mes (solo del mes: ${a.toLocaleString("es-AR")})` });
    } else {
      issues.push({ severity: "ERROR", code: "TOTALES_NO_COINCIDEN", message: `${label}: TOTALES ${sheetVal.toLocaleString("es-AR")} vs importado ${a.toLocaleString("es-AR")} (con día de otro mes ${b.toLocaleString("es-AR")})` });
    }
  };
  for (const t of SERVICE_TYPES) {
    check(`Cantidad ${t}`, num(totals, QTY_ROW[t], col), own.qty[t], withForeign.qty[t]);
    check(`Ingresos ${t}`, num(totals, INCOME_ROW[t], col), own.income[t], withForeign.income[t]);
  }
  for (const k of KEYS) check(`M.O. ${k}`, num(totals, LABOR_ROW[k], col), own.labor[k], withForeign.labor[k]);
  check("Cortes por membresía (cantidad)", num(totals, 9, col), own.memberships, withForeign.memberships);

  const memberIncome = num(totals, 16, col);
  if (own.memberships > 0 && memberIncome === 0) {
    issues.push({ severity: "WARN", code: "MEMBRESIAS_SIN_INGRESO", message: `TOTALES registra ${own.memberships} cortes por membresía pero $ 0 de ingreso por membresías (fila "CORTES X MES" vacía): el mes queda sin esos ingresos ni su mano de obra.` });
  }
  return { issues, matched, compared };
}
