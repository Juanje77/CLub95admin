import { splitService } from "./commission";
import type { BarberRule } from "./types";

export const DEFAULT_MEMBER_PRICES = { CORTE: 15000, CORTE_BARBA: 16500 } as const;

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
