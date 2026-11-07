import type { BarberRule } from "./types";

export interface ServiceSplit {
  /** Precio cobrado al cliente. */
  gross: number;
  /** Bebida incluida que se descuenta antes de la comisión. */
  drink: number;
  /** Base sobre la que se calcula la comisión: gross − bebida (nunca negativa). */
  base: number;
  /** Lo que cobra el barbero. */
  labor: number;
  /** Lo que queda para el local (base − labor); la bebida se compensa por separado. */
  local: number;
}

/**
 * Reparto de un servicio. Con Ale (100%) labor = precio − bebida: 20.000 → 17.000, 22.000 → 19.000.
 * Con Jere/Beni (60%) y bebida de 1.500/3.000 se calcula sobre la base ya descontada.
 */
export function splitService(price: number, rule: BarberRule, quantity = 1): ServiceSplit {
  const gross = price * quantity;
  const drink = rule.drinkDeduction * quantity;
  const base = Math.max(gross - drink, 0);
  const labor = Math.round((base * rule.commissionBp) / 10000);
  return { gross, drink, base, labor, local: base - labor };
}
