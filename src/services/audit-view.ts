import type { Db } from "./common";

export interface AuditRow {
  id: string;
  at: Date;
  user: string;
  entity: string;
  entityId: string;
  action: string;
  /** Resumen legible de lo que cambió. */
  detail: string;
}

const ENTITY_LABEL: Record<string, string> = {
  SaleCell: "Cantidad en la planilla",
  Sale: "Venta",
  CashClose: "Cierre de caja",
  CashBoxEntry: "Efectivo acumulado",
  Expense: "Gasto",
  ExpenseConcept: "Concepto de gasto",
  RecurringExpense: "Gasto fijo",
  ExtraIncome: "Otro ingreso",
  Member: "Socio",
  MemberPrice: "Precio de socio",
  MemberLedger: "Cuenta de socio",
  Attendance: "Asistencia de socio",
  User: "Usuario",
  BarberRule: "Comisión",
  Tariff: "Tarifa",
  Product: "Producto",
  ProductPrice: "Precio de producto",
  BarberSettlement: "Compensación mensual",
  ClosedDay: "Día sin actividad",
  ImportBatch: "Importación",
};
const ACTION_LABEL: Record<string, string> = { CREATE: "Creó", UPDATE: "Modificó", DELETE: "Borró", CLOSE: "Cerró", REOPEN: "Reabrió", IMPORT: "Importó" };

export const entityLabel = (e: string) => ENTITY_LABEL[e] ?? e;
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;
export const AUDIT_ENTITIES = Object.keys(ENTITY_LABEL);

function parse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Nunca se muestran PIN ni hashes aunque alguien los hubiera guardado. */
const HIDDEN = /pin|hash|secret|password/i;

function brief(o: Record<string, unknown> | null): string {
  if (!o) return "";
  return Object.entries(o)
    .filter(([k, v]) => v !== null && v !== undefined && !HIDDEN.test(k))
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export function summarize(before: string | null, after: string | null): string {
  const b = brief(parse(before));
  const a = brief(parse(after));
  if (b && a) return `${b}  →  ${a}`;
  return a || b;
}

export async function listAudit(db: Db, opts: { entity?: string; userId?: string; limit?: number; before?: Date } = {}): Promise<AuditRow[]> {
  const rows = await db.auditLog.findMany({
    where: { ...(opts.entity ? { entity: opts.entity } : {}), ...(opts.userId ? { userId: opts.userId } : {}), ...(opts.before ? { at: { lt: opts.before } } : {}) },
    orderBy: { at: "desc" },
    take: Math.min(opts.limit ?? 100, 300),
  });
  const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, at: r.at, user: r.userId ? (nameOf.get(r.userId) ?? "—") : "Sistema", entity: r.entity, entityId: r.entityId, action: r.action, detail: summarize(r.before, r.after) }));
}
