import { splitService } from "./commission";
import type { BarberRule } from "./types";

/**
 * Lo que le corresponde al barbero por un socio de membresía en el mes: se calcula como un servicio
 * (precio de la membresía − bebida, por la comisión del barbero). La membresía no se cobra en caja.
 */
export function membershipLabor(price: number, rule: BarberRule): number {
  return splitService(price, rule).labor;
}

export interface SettlementInput {
  laborServices: number;
  laborMembership: number;
  adjustments?: number;
  /** Lo que el barbero ya cobró en el mes: retiros en efectivo + transferencias a su cuenta propia. */
  collected: number;
}

export interface SettlementResult {
  entitled: number;
  balance: number;
  direction: "LOCAL_DEBE" | "BARBERO_DEBE" | "SALDADO";
}

/**
 * Compensación de fin de mes: balance = lo que le corresponde − lo que ya cobró.
 * Positivo: el local le debe al barbero. Negativo: el barbero cobró de más y devuelve.
 */
export function settle(input: SettlementInput): SettlementResult {
  const entitled = input.laborServices + input.laborMembership + (input.adjustments ?? 0);
  const balance = entitled - input.collected;
  return { entitled, balance, direction: balance > 0 ? "LOCAL_DEBE" : balance < 0 ? "BARBERO_DEBE" : "SALDADO" };
}
