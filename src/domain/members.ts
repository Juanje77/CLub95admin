import { splitService } from "./commission";
import type { BarberRule } from "./types";

export const MEMBER_PLANS = ["BLACK", "GOLD"] as const;
export type MemberPlan = (typeof MEMBER_PLANS)[number];

/** Precio por sesión según plan y tipo (los de la planilla de socios de octubre 2026). Se cambian en Setting "memberPrices". */
export const DEFAULT_MEMBER_PRICES = {
  BLACK: { CORTE: 16250, CORTE_BARBA: 17500 },
  GOLD: { CORTE: 20000, CORTE_BARBA: 23000 },
} as const;

export type MonthStatus = "PAGO" | "PARCIAL" | "INPAGO" | "SIN_MOVIMIENTO";

/** Estado de un mes de un socio: pagó todo, pagó una parte, no pagó nada, o no hubo movimiento. */
export function monthStatus(due: number, paid: number): MonthStatus {
  if (due <= 0 && paid <= 0) return "SIN_MOVIMIENTO";
  if (paid >= due) return "PAGO";
  return paid > 0 ? "PARCIAL" : "INPAGO";
}

export interface MonthEntry {
  month: string;
  sessions: number;
  charge: number;
  adjust: number;
  paid: number;
}
export interface StatementRow extends MonthEntry {
  /** Lo que se debía ese mes: sesiones × precio + ajustes. */
  due: number;
  /** Cobrado − debido del mes (como la columna DIFERENCIA de la planilla). */
  diff: number;
  /** Saldo acumulado hasta ese mes (positivo = el socio debe). */
  balance: number;
  status: MonthStatus;
}

/** Cuenta corriente mes a mes: arrastra el saldo de un mes al siguiente. */
export function buildStatement(entries: MonthEntry[]): StatementRow[] {
  let balance = 0;
  return [...entries]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((e) => {
      const due = e.charge + e.adjust;
      balance += due - e.paid;
      return { ...e, due, diff: e.paid - due, balance, status: monthStatus(due, e.paid) };
    });
}

/** Saldo al cierre del último mes anterior a `month` (lo que se arrastra). Nunca negativo. */
export function carriedInto(rows: StatementRow[], month: string): number {
  const last = rows.filter((r) => r.month < month).at(-1);
  return Math.max(0, last?.balance ?? 0);
}

/** Mes más antiguo que todavía deja saldo positivo: a ese mes se imputa un cobro cuando no se indica otro. */
export function oldestUnpaidMonth(rows: StatementRow[]): string | null {
  return rows.find((r) => r.balance > 0)?.month ?? null;
}

/** Saldo de la cuenta corriente de un socio. Positivo = el socio debe; negativo = tiene saldo a favor. */
export function memberBalance(i: { charges: number; adjustments: number; payments: number }): number {
  return i.charges + i.adjustments - i.payments;
}

/**
 * Cuánto aporta una asistencia al barbero y al local. Como un servicio: el barbero cobra
 * (precio − bebida) × su comisión y el resto queda para el local (la bebida se compensa por su costo).
 */
export function memberContribution(price: number, rule: BarberRule): { price: number; barber: number; local: number; drink: number } {
  const s = splitService(price, rule);
  return { price, barber: s.labor, local: price - s.labor, drink: s.drink };
}

/** Días corridos entre dos fechas YYYY-MM-DD (b − a). */
export function daysSince(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
