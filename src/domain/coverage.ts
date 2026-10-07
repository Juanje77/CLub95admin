/**
 * Los barberos cobran de lo recaudado en el banco (transferencias). Solo si el banco no alcanzó a cubrir lo que
 * les corresponde cobrar ese día pueden completar con efectivo de la caja. Todo retiro en efectivo por encima de
 * ese faltante es una excepción: pide motivo y avisa al admin.
 */
export interface CoverageInput {
  barberId: string;
  /** Lo que el barbero tiene que cobrar por sus servicios del día (mano de obra). */
  labor: number;
  /** Transferencias recaudadas en sus ventas del día. */
  transfers: number;
  /** Efectivo que ya se retiró ese día. */
  cashWithdrawn: number;
}

export interface BarberCoverage extends CoverageInput {
  /** Parte de su mano de obra que cubre el banco. */
  coveredByBank: number;
  /** Efectivo que puede retirar: lo que el banco no cubrió. */
  cashAllowed: number;
  /** Lo que todavía puede retirar en efectivo sin que sea excepción. */
  remaining: number;
  /** Efectivo retirado por encima de lo permitido. */
  excess: number;
}

export function coverage(input: CoverageInput): BarberCoverage {
  const coveredByBank = Math.min(input.labor, input.transfers);
  const cashAllowed = Math.max(0, input.labor - input.transfers);
  return {
    ...input,
    coveredByBank,
    cashAllowed,
    remaining: Math.max(0, cashAllowed - input.cashWithdrawn),
    excess: Math.max(0, input.cashWithdrawn - cashAllowed),
  };
}

/** Efectos de sumar un retiro nuevo: cuánto de ese retiro es excepción (y por lo tanto exige motivo). */
export function checkWithdrawal(current: CoverageInput, amount: number): { after: BarberCoverage; needsNote: boolean; excessOfThisWithdrawal: number } {
  const before = coverage(current);
  const after = coverage({ ...current, cashWithdrawn: current.cashWithdrawn + amount });
  return { after, needsNote: after.excess > 0, excessOfThisWithdrawal: after.excess - before.excess };
}
