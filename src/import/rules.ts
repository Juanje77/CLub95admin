import type { BarberRule, TariffEntry } from "../domain/types";
import type { BarberKey } from "./month";

/** Reglas vigentes desde septiembre 2026, según el dueño (comunicadas por chat). */
export const SYSTEM_FROM = "2026-09-01";

export const SYSTEM_TARIFFS: TariffEntry[] = [
  { serviceType: "CORTE", validFrom: SYSTEM_FROM, price: 20000 },
  { serviceType: "CORTE_BARBA", validFrom: SYSTEM_FROM, price: 22000 },
  { serviceType: "BARBA_CEJAS", validFrom: SYSTEM_FROM, price: 15000 },
];

export const SYSTEM_RULES: Record<BarberKey, BarberRule[]> = {
  JERE: [{ validFrom: SYSTEM_FROM, commissionBp: 6000, drinkDeduction: 1500, drinkCost: 1500 }],
  // Ale lleva la parte administrativa y cobra el 100% de (precio − bebida): 17.000 / 19.000.
  ALE: [{ validFrom: SYSTEM_FROM, commissionBp: 10000, drinkDeduction: 3000, drinkCost: 3000 }],
  BENI: [{ validFrom: SYSTEM_FROM, commissionBp: 6000, drinkDeduction: 3000, drinkCost: 3000 }],
};

export const BARBER_NAMES: Record<BarberKey, string> = { JERE: "Jere", ALE: "Ale", BENI: "Beni / Lucio (hasta sep-26)" };
