export interface CloseInput {
  expectedIncome: number;
  /** null cuando no se conoce el medio de pago de cada venta (datos históricos). */
  expectedCash: number | null;
  expectedTransfers: number | null;
  declaredCash: number;
  declaredTransfers: number;
  changeLeft: number;
  note?: string | null;
  /** Ventas del día sin medio de pago cargado. */
  unpaidSales?: number;
}

export type CloseErrorCode =
  | "MONTO_INVALIDO"
  | "VENTAS_SIN_MEDIO_DE_PAGO"
  | "NOTA_OBLIGATORIA";

export interface CloseCheck {
  ok: boolean;
  declaredTotal: number;
  /** declarado − esperado. Negativo = falta plata. */
  difference: number;
  cashDifference: number | null;
  transfersDifference: number | null;
  needsNote: boolean;
  errors: { code: CloseErrorCode; message: string }[];
  /** Efectivo que se suma a la fila de efectivo acumulado. */
  cashToBox: number;
}

const isMoney = (n: number) => Number.isInteger(n) && n >= 0;

/**
 * Reglas para cerrar el día:
 *  - los montos son pesos enteros ≥ 0;
 *  - no se cierra con ventas sin medio de pago (no se podría controlar efectivo vs transferencias);
 *  - si hay diferencia total, o (conociendo el medio de pago) diferencia entre efectivo o entre transferencias,
 *    la nota es obligatoria. Una diferencia que se compensa entre medios también la exige, porque cambia el efectivo
 *    que queda en la caja.
 */
export function validateClose(input: CloseInput): CloseCheck {
  const errors: CloseCheck["errors"] = [];
  for (const [label, v] of [
    ["efectivo", input.declaredCash],
    ["transferencias", input.declaredTransfers],
    ["cambio dejado", input.changeLeft],
  ] as const) {
    if (!isMoney(v)) errors.push({ code: "MONTO_INVALIDO", message: `El monto de ${label} debe ser un entero mayor o igual a 0.` });
  }
  if ((input.unpaidSales ?? 0) > 0) {
    errors.push({ code: "VENTAS_SIN_MEDIO_DE_PAGO", message: `Hay ${input.unpaidSales} venta(s) sin medio de pago: completalas antes de cerrar.` });
  }
  const declaredTotal = input.declaredCash + input.declaredTransfers;
  const difference = declaredTotal - input.expectedIncome;
  const cashDifference = input.expectedCash === null ? null : input.declaredCash - input.expectedCash;
  const transfersDifference = input.expectedTransfers === null ? null : input.declaredTransfers - input.expectedTransfers;
  const needsNote = difference !== 0 || (cashDifference ?? 0) !== 0 || (transfersDifference ?? 0) !== 0;
  if (needsNote && !(input.note ?? "").trim()) {
    errors.push({ code: "NOTA_OBLIGATORIA", message: "Hay diferencia en la caja: dejá una nota explicando el motivo." });
  }
  return { ok: errors.length === 0, declaredTotal, difference, cashDifference, transfersDifference, needsNote, errors, cashToBox: input.declaredCash };
}
