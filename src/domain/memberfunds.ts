import { splitService } from "./commission";
import type { BarberRule } from "./types";

/**
 * Las tres cuentas de los socios, que se llevan aparte del día a día:
 *  - Efectivo a rendir = efectivo cobrado a socios − cortes de Ale (lo que Ale se queda por sus sesiones).
 *  - Bebida = lo que se descuenta de cada sesión por la bebida (Lucio y Ale $ 3.000, Jere $ 1.500 según su regla).
 *  - Ganancia de un barbero (Lucio) = lo que queda para el local de sus sesiones, ya sin la bebida ni su parte.
 */
export interface SessionFigures {
  /** Lo que cobra el barbero por la sesión. */
  labor: number;
  /** Lo que va a la cuenta de bebida. */
  drink: number;
  /** Lo que queda para el local sin la bebida. */
  profit: number;
}

export function sessionFigures(price: number, qty: number, rule: BarberRule): SessionFigures {
  const s = splitService(price, rule);
  return { labor: s.labor * qty, drink: s.drink * qty, profit: s.local * qty };
}

export const FUNDS = ["EFECTIVO", "BEBIDA", "GANANCIA"] as const;
export type Fund = (typeof FUNDS)[number];
export const FUND_KINDS: Record<Fund, readonly string[]> = {
  EFECTIVO: ["RENDICION", "AJUSTE"],
  BEBIDA: ["GASTO", "AJUSTE"],
  GANANCIA: ["RETIRO", "AJUSTE"],
};
export const KIND_LABEL: Record<string, string> = { RENDICION: "Rendición", GASTO: "Compra de bebida", RETIRO: "Retiro de ganancia", AJUSTE: "Ajuste" };
