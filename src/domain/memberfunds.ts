import type { BarberRule } from "./types";

/**
 * Las tres cuentas de los socios, que se llevan aparte del día a día:
 *  - Efectivo a rendir = efectivo cobrado a socios − cortes de Ale (lo que Ale se queda por sus sesiones).
 *  - Bebida = lo que se descuenta de cada sesión por la bebida (Lucio y Ale $ 3.000, Jere $ 1.500 según su regla).
 *  - Ganancia de un barbero (Lucio) = lo que queda para el local de sus sesiones, ya sin la bebida ni su parte.
 */
export interface SessionFigures {
  /** Lo que cobra el barbero (su % de la base). */
  labor: number;
  /** Lo que va a la cuenta de bebida: bebida × cortes del mes, haya pagado o no el socio. */
  drink: number;
  /** Lo que queda para el local sin la bebida (el resto de la base). */
  profit: number;
  /** Base del reparto: lo cobrado − la bebida × los cortes del mes (nunca negativa). */
  base: number;
}

/**
 * Reparto de lo que pagó un socio por `qty` cortes del mes, como en la planilla de socios: se saca la bebida × los cortes
 * y a lo que queda se le aplica el porcentaje del barbero (60 %) y el resto es del local (40 %). Si el socio no pagó, no hay base.
 */
export function paidFigures(paid: number, qty: number, rule: BarberRule): SessionFigures {
  const drink = rule.drinkDeduction * qty;
  const base = Math.max(paid - drink, 0);
  const labor = Math.round((base * rule.commissionBp) / 10000);
  return { labor, drink, profit: base - labor, base };
}

export const FUNDS = ["EFECTIVO", "BEBIDA", "GANANCIA"] as const;
export type Fund = (typeof FUNDS)[number];
export const FUND_KINDS: Record<Fund, readonly string[]> = {
  EFECTIVO: ["RENDICION", "AJUSTE"],
  BEBIDA: ["GASTO", "AJUSTE"],
  GANANCIA: ["RETIRO", "AJUSTE"],
};
export const KIND_LABEL: Record<string, string> = { RENDICION: "Rendición", GASTO: "Compra de bebida", RETIRO: "Retiro de ganancia", AJUSTE: "Ajuste" };
