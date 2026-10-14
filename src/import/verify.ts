import { computeDay } from "../domain/cash";
import type { BarberRule, ServiceType, TariffEntry } from "../domain/types";
import { SERVICE_TYPES } from "../domain/types";
import type { BarberKey, DayData, MonthData } from "./month";
import { SYSTEM_RULES, SYSTEM_TARIFFS } from "./rules";
import { colLetter } from "./sheet";

export interface Issue {
  severity: "INFO" | "WARN" | "ERROR";
  code: string;
  message: string;
}

const KEYS: BarberKey[] = ["JERE", "ALE", "BENI"];

/** Tarifas de la hoja para un barbero, con vigencia desde el primer día del mes. */
function sheetTariffs(prices: Record<ServiceType, number>, from: string): TariffEntry[] {
  return SERVICE_TYPES.map((t) => ({ serviceType: t, validFrom: from, price: prices[t] }));
}

/** Reglas "como las calcula la planilla": D1 para todos (aunque a Ale/Beni les cobre D1×2 en bebidas). */
function sheetRule(key: BarberKey, drink: number, from: string): BarberRule[] {
  const bp = key === "ALE" ? 10000 : 6000;
  return [{ validFrom: from, commissionBp: bp, drinkDeduction: drink, drinkCost: drink }];
}

export function looseDrinksRevenue(day: DayData, m: MonthData): number {
  const p = m.params.looseDrinkPrice;
  const d = day.looseDrinks;
  const monster = (d.MONSTER_ROSA ?? 0) + (d.MONSTER_ORIGINAL ?? 0) + (d.MONSTER_MANGO ?? 0) + (d.MONSTER_SIN_AZUCAR ?? 0);
  return monster * (p.MONSTER ?? 0) + (d.COCA ?? 0) * (p.COCA ?? 0) + (d.SPRITE ?? 0) * (p.SPRITE ?? 0) + (d.FANTA ?? 0) * (p.FANTA ?? 0) + (d.ACQUARIUS ?? 0) * (p.ACQUARIUS ?? 0);
}

export function productsRevenue(day: DayData, m: MonthData): number {
  const p = m.params;
  const d = day.products;
  return ((d.CERA_1 ?? 0) + (d.CERA_2 ?? 0) + (d.CERA_3 ?? 0)) * p.waxPrice + (d.POLVO ?? 0) * p.powderPrice + (d.ACEITE ?? 0) * p.oilPrice;
}

export function extraSales(day: DayData, m: MonthData): number {
  return looseDrinksRevenue(day, m) + productsRevenue(day, m);
}

/** Pagos declarados que cubren servicios y ventas (sin membresías ni cambio dejado). */
export function declaredPayments(day: DayData): number {
  const d = day.declared;
  return (d.BRUBANK ?? 0) + (d.BRUBANK_JUAN ?? 0) + (d.MP_JERE ?? 0) + (d.EFECTIVO ?? 0);
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("es-AR");
}

/**
 * 1) Fidelidad: recalcula cada día con las reglas de la planilla y exige que coincida con lo que ella calculó.
 * 2) Diferencias: compara con las reglas del sistema (las que indicó el dueño) y las informa.
 */
export function verifyMonth(m: MonthData): { issues: Issue[]; stats: Record<string, number> } {
  const issues: Issue[] = [];
  const from = m.days[0]?.date ?? "2026-01-01";
  const stats: Record<string, number> = { daysChecked: 0, fidelityMismatches: 0 };

  // --- 1) Fidelidad de la lectura ---------------------------------------------------------------------------
  const deltaLabor: Record<BarberKey, number> = { JERE: 0, ALE: 0, BENI: 0 };
  for (const day of m.days) {
    stats.daysChecked!++;
    for (const k of KEYS) {
      const prices = k === "JERE" ? m.params.jere : m.params.base;
      const r = computeDay({
        date: day.date,
        tariffs: sheetTariffs(prices, from),
        barbers: [{ barberId: k, rules: sheetRule(k, m.params.drinkValue, from), services: day.barbers[k].services }],
      });
      const b = r.barbers[0]!;
      if (b.gross !== day.sheet.gross[k] || b.labor !== day.sheet.labor[k]) {
        stats.fidelityMismatches!++;
        issues.push({
          severity: "ERROR",
          code: "LECTURA_NO_COINCIDE",
          message: `${day.date} ${k}: recalculado bruto ${fmt(b.gross)} / M.O. ${fmt(b.labor)}; la planilla dice ${fmt(day.sheet.gross[k])} / ${fmt(day.sheet.labor[k])}`,
        });
      }
    }
    const revDrinks = looseDrinksRevenue(day, m);
    if (revDrinks !== day.sheet.looseDrinksRevenue) {
      issues.push({ severity: "ERROR", code: "BEBIDAS_NO_COINCIDEN", message: `${day.date}: bebidas sueltas ${fmt(revDrinks)} vs planilla ${fmt(day.sheet.looseDrinksRevenue)}` });
    }
    const revProd = productsRevenue(day, m);
    if (revProd !== day.sheet.productsRevenue) {
      issues.push({ severity: "ERROR", code: "PRODUCTOS_NO_COINCIDEN", message: `${day.date}: ceras/polvo/aceite ${fmt(revProd)} vs planilla ${fmt(day.sheet.productsRevenue)}` });
    }
    // Total "cortes y venta" (fila 123): el día 1 de cada mes la fórmula omite las ceras.
    const grossAll = KEYS.reduce((a, k) => a + day.sheet.gross[k], 0);
    const expectedRow123 = grossAll + revDrinks + revProd;
    if (day.sheet.income !== expectedRow123) {
      const omitted = day.sheet.income === grossAll + revDrinks && revProd > 0;
      issues.push({
        severity: "WARN",
        code: omitted ? "FILA123_OMITE_CERAS" : "FILA123_NO_COINCIDE",
        message: omitted
          ? `${day.date}: "Total cortes y venta" (fila 123) omite ${fmt(revProd)} de ceras; el total del día queda subestimado en la planilla`
          : `${day.date}: fila 123 vale ${fmt(day.sheet.income)} y debería ser ${fmt(expectedRow123)}`,
      });
    }
  }

  // --- 2) Reglas del sistema vs planilla --------------------------------------------------------------------
  for (const k of KEYS) {
    let sheetLabor = 0;
    let sysLabor = 0;
    let sysGross = 0;
    let sheetGross = 0;
    for (const day of m.days) {
      const r = computeDay({ date: day.date, tariffs: SYSTEM_TARIFFS, barbers: [{ barberId: k, rules: SYSTEM_RULES[k], services: day.barbers[k].services }] });
      sysLabor += r.labor;
      sysGross += r.servicesGross;
      sheetLabor += day.sheet.labor[k];
      sheetGross += day.sheet.gross[k];
    }
    deltaLabor[k] = sysLabor - sheetLabor;
    if (sysGross !== sheetGross) {
      issues.push({ severity: "WARN", code: "BRUTO_DIFIERE", message: `${k}: ingresos por servicios ${fmt(sheetGross)} en la planilla vs ${fmt(sysGross)} con las tarifas vigentes` });
    }
    if (deltaLabor[k] !== 0) {
      issues.push({
        severity: "WARN",
        code: "MANO_DE_OBRA_DIFIERE",
        message: `${k}: mano de obra ${fmt(sheetLabor)} en la planilla vs ${fmt(sysLabor)} con las reglas vigentes (${deltaLabor[k]! > 0 ? "+" : ""}${fmt(deltaLabor[k]!)})`,
      });
    }
  }

  // Precio con el que la hoja valoriza a Jere vs tarifa vigente.
  for (const t of SERVICE_TYPES) {
    const sys = SYSTEM_TARIFFS.find((x) => x.serviceType === t)!.price;
    if (m.params.jere[t] !== sys) {
      issues.push({ severity: "WARN", code: "TARIFA_JERE_DIFIERE", message: `Tarifa ${t} de Jere en la hoja: ${fmt(m.params.jere[t])}; tarifa vigente para todos: ${fmt(sys)}` });
    }
    if (m.params.base[t] !== sys) {
      issues.push({ severity: "WARN", code: "TARIFA_BASE_DIFIERE", message: `Tarifa ${t} (B1/B3/B5) en la hoja: ${fmt(m.params.base[t])}; tarifa vigente: ${fmt(sys)}` });
    }
  }

  // Bebida de Ale/Beni: la hoja vende/cuenta D1×2 pero descuenta solo D1 en la comisión.
  const nAleBeni = m.days.reduce((a, d) => a + SERVICE_TYPES.reduce((s, t) => s + d.barbers.ALE.services[t] + d.barbers.BENI.services[t], 0), 0);
  if (nAleBeni > 0 && m.params.drinkValueKids !== m.params.drinkValue) {
    issues.push({
      severity: "WARN",
      code: "BEBIDA_ALE_BENI",
      message: `La hoja descuenta $ ${fmt(m.params.drinkValue)} de bebida en la comisión de Ale y Beni, pero cuenta $ ${fmt(m.params.drinkValue * 2)} en "venta de bebidas" (D1×2); la regla indicada es $ ${fmt(m.params.drinkValueKids)}. ${nAleBeni} servicios afectados.`,
    });
  }

  // --- 3) Columnas de otro mes ---------------------------------------------------------------------------------
  for (const fd of m.foreignDays) {
    issues.push({
      severity: "WARN",
      code: "DIA_DE_OTRO_MES",
      message: `La columna ${colLetter(fd.col)} de ${m.sheetName} es ${fd.date}: no se importa acá (pertenece a su mes) pero la planilla suma sus montos en el total del mes (bruto ${fmt(KEYS.reduce((a, k) => a + fd.sheet.gross[k], 0))}, M.O. ${fmt(KEYS.reduce((a, k) => a + fd.sheet.labor[k], 0))}).`,
    });
  }

  // --- 4) Descuadres de caja ------------------------------------------------------------------------------------
  let descuadres = 0;
  let sumDiff = 0;
  let daysWithoutClose = 0;
  for (const day of m.days) {
    const payments = declaredPayments(day);
    if (payments === 0 && day.declared.CAMBIO === 0) {
      const hadActivity = KEYS.some((k) => SERVICE_TYPES.some((t) => day.barbers[k].services[t] > 0));
      if (hadActivity) daysWithoutClose++;
      continue;
    }
    const income = KEYS.reduce((a, k) => a + day.sheet.gross[k], 0) + extraSales(day, m);
    const diff = payments - income;
    if (diff !== 0) {
      descuadres++;
      sumDiff += diff;
      issues.push({ severity: "INFO", code: "DESCUADRE_DIA", message: `${day.date}: ingresos ${fmt(income)}, cobros declarados ${fmt(payments)} → ${diff > 0 ? "sobra" : "falta"} ${fmt(Math.abs(diff))}` });
    }
  }
  stats.descuadres = descuadres;
  stats.descuadreTotal = sumDiff;
  stats.diasSinCierre = daysWithoutClose;
  if (daysWithoutClose > 0) {
    issues.push({ severity: "WARN", code: "DIAS_SIN_CIERRE", message: `${daysWithoutClose} días con servicios y sin cobros declarados en la planilla.` });
  }
  return { issues, stats };
}
