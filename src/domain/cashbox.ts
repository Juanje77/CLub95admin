/**
 * Fila de efectivo acumulado. Cada cierre suma el efectivo del día; los retiros de barberos y las rendiciones al dueño restan.
 * El saldo es la suma de los montos con signo.
 */
export type BoxKind = "CIERRE" | "RETIRO_BARBERO" | "RENDICION" | "AJUSTE";

export interface BoxEntry {
  date: string; // YYYY-MM-DD
  kind: BoxKind;
  /** + entra a la caja, − sale. */
  amount: number;
  /** Solo en RENDICION: saldo que debía haber al momento de rendir. */
  expectedAmount?: number | null;
}

export interface LedgerRow extends BoxEntry {
  balance: number;
}

const KIND_ORDER: Record<BoxKind, number> = { CIERRE: 0, AJUSTE: 1, RETIRO_BARBERO: 2, RENDICION: 3 };

export function boxLedger(entries: BoxEntry[]): { rows: LedgerRow[]; balance: number } {
  // Dentro de un mismo día: primero lo que entra con el cierre y al final la rendición.
  const sorted = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] || a.i - b.i))
    .map((x) => x.e);
  let balance = 0;
  const rows = sorted.map((e) => {
    balance += e.amount;
    return { ...e, balance };
  });
  return { rows, balance };
}

export function boxBalance(entries: BoxEntry[]): number {
  return entries.reduce((a, e) => a + e.amount, 0);
}

export function lastRendicionDate(entries: BoxEntry[]): string | null {
  let last: string | null = null;
  for (const e of entries) if (e.kind === "RENDICION" && (!last || e.date > last)) last = e.date;
  return last;
}

/** Días corridos entre dos fechas YYYY-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export interface RendicionCheck {
  expected: number;
  handedOver: number;
  /** entregado − esperado. */
  difference: number;
  needsNote: boolean;
}

export function checkRendicion(balance: number, handedOver: number): RendicionCheck {
  const difference = handedOver - balance;
  return { expected: balance, handedOver, difference, needsNote: difference !== 0 };
}
