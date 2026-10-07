import type { PrismaClient } from "@prisma/client";
import { todayBA } from "../domain/money";
import { audit, DomainError, isAdmin, type Actor, type Db } from "./common";

export const CATEGORIES = ["VARIABLE", "ESTRUCTURA", "INVERSION", "REPOSICION"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  VARIABLE: "Gastos variables",
  ESTRUCTURA: "Gastos de estructura",
  INVERSION: "Inversiones",
  REPOSICION: "Reposición (compras de mercadería)",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RECEIPT_CHARS = 700_000; // ~500 KB de imagen en base64

function requireAdmin(actor: Actor) {
  if (!isAdmin(actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño manejan los gastos.");
}
function checkDate(date: string, now: Date, allowFuture = false) {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new DomainError("FECHA_INVALIDA", "La fecha es inválida.");
  if (!allowFuture && date > todayBA(now)) throw new DomainError("FECHA_FUTURA", "No se puede cargar un gasto con fecha futura.");
}
function checkAmount(n: number) {
  if (!Number.isInteger(n) || n <= 0 || n > 1_000_000_000) throw new DomainError("MONTO_INVALIDO", "El monto debe ser un entero mayor a 0.");
}
function checkReceipt(r: string | null | undefined) {
  if (!r) return null;
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(r)) throw new DomainError("COMPROBANTE_INVALIDO", "El comprobante debe ser una foto JPEG.");
  if (r.length > MAX_RECEIPT_CHARS) throw new DomainError("COMPROBANTE_GRANDE", "La foto del comprobante es demasiado grande.");
  return r;
}

// --- Gastos ----------------------------------------------------------------------------------------------------------------

export async function addExpense(
  db: PrismaClient,
  p: { actor: Actor; date: string; conceptId: string; amount: number; description?: string; receiptData?: string | null; now?: Date },
) {
  requireAdmin(p.actor);
  checkDate(p.date, p.now ?? new Date());
  checkAmount(p.amount);
  const receiptData = checkReceipt(p.receiptData);
  const concept = await db.expenseConcept.findUnique({ where: { id: p.conceptId } });
  if (!concept || concept.deletedAt || !concept.active) throw new DomainError("CONCEPTO_INVALIDO", "Elegí un concepto de la lista.");
  const row = await db.expense.create({
    data: { date: p.date, conceptId: p.conceptId, amount: p.amount, description: p.description?.trim() || null, receiptData, source: "APP", createdById: p.actor.id },
  });
  await audit(db, { userId: p.actor.id, entity: "Expense", entityId: row.id, action: "CREATE", after: { date: p.date, concept: concept.name, amount: p.amount } });
  return row;
}

export async function updateExpense(
  db: PrismaClient,
  p: { actor: Actor; id: string; date?: string; conceptId?: string; amount?: number; description?: string; now?: Date },
) {
  requireAdmin(p.actor);
  const cur = await db.expense.findUnique({ where: { id: p.id } });
  if (!cur || cur.deletedAt) throw new DomainError("GASTO_INEXISTENTE", "Ese gasto no existe.");
  if (p.date !== undefined) checkDate(p.date, p.now ?? new Date());
  if (p.amount !== undefined) checkAmount(p.amount);
  if (p.conceptId !== undefined) {
    const c = await db.expenseConcept.findUnique({ where: { id: p.conceptId } });
    if (!c || c.deletedAt || !c.active) throw new DomainError("CONCEPTO_INVALIDO", "Elegí un concepto de la lista.");
  }
  const row = await db.expense.update({
    where: { id: p.id },
    data: { ...(p.date !== undefined ? { date: p.date } : {}), ...(p.conceptId !== undefined ? { conceptId: p.conceptId } : {}), ...(p.amount !== undefined ? { amount: p.amount } : {}), ...(p.description !== undefined ? { description: p.description.trim() || null } : {}) },
  });
  await audit(db, { userId: p.actor.id, entity: "Expense", entityId: p.id, action: "UPDATE", before: { date: cur.date, conceptId: cur.conceptId, amount: cur.amount, description: cur.description }, after: { date: row.date, conceptId: row.conceptId, amount: row.amount, description: row.description } });
  return row;
}

/** Baja lógica: el gasto deja de contar pero queda en el historial con quién lo borró. */
export async function deleteExpense(db: PrismaClient, p: { actor: Actor; id: string }) {
  requireAdmin(p.actor);
  const cur = await db.expense.findUnique({ where: { id: p.id }, include: { concept: true } });
  if (!cur || cur.deletedAt) throw new DomainError("GASTO_INEXISTENTE", "Ese gasto no existe.");
  await db.expense.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
  await audit(db, { userId: p.actor.id, entity: "Expense", entityId: p.id, action: "DELETE", before: { date: cur.date, concept: cur.concept.name, amount: cur.amount } });
}

export interface ExpenseListRow {
  id: string;
  date: string;
  conceptId: string;
  concept: string;
  category: Category;
  amount: number;
  description: string | null;
  hasReceipt: boolean;
}

export interface ExpenseSummary {
  total: number;
  byCategory: Record<Category, number>;
  byConcept: { concept: string; category: Category; total: number; count: number }[];
}

export function monthRange(month: string) {
  return { gte: `${month}-01`, lte: `${month}-31` };
}

export async function listExpenses(db: Db, p: { month: string; conceptId?: string }): Promise<{ rows: ExpenseListRow[]; summary: ExpenseSummary }> {
  const all = await db.expense.findMany({
    where: { deletedAt: null, date: monthRange(p.month) },
    include: { concept: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const summary: ExpenseSummary = { total: 0, byCategory: { VARIABLE: 0, ESTRUCTURA: 0, INVERSION: 0, REPOSICION: 0 }, byConcept: [] };
  const byConcept = new Map<string, { concept: string; category: Category; total: number; count: number }>();
  for (const e of all) {
    const cat = e.concept.category as Category;
    summary.total += e.amount;
    summary.byCategory[cat] = (summary.byCategory[cat] ?? 0) + e.amount;
    const cur = byConcept.get(e.concept.name) ?? { concept: e.concept.name, category: cat, total: 0, count: 0 };
    cur.total += e.amount;
    cur.count++;
    byConcept.set(e.concept.name, cur);
  }
  summary.byConcept = [...byConcept.values()].sort((a, b) => b.total - a.total);
  const rows = all
    .filter((e) => !p.conceptId || e.conceptId === p.conceptId)
    .map((e) => ({ id: e.id, date: e.date, conceptId: e.conceptId, concept: e.concept.name, category: e.concept.category as Category, amount: e.amount, description: e.description, hasReceipt: !!e.receiptData }));
  return { rows, summary };
}

export async function getReceipt(db: Db, id: string): Promise<string | null> {
  const e = await db.expense.findUnique({ where: { id }, select: { receiptData: true, deletedAt: true } });
  return e && !e.deletedAt ? e.receiptData : null;
}

// --- Conceptos administrables --------------------------------------------------------------------------------------------------
// Lista cerrada: se elige de acá al cargar. Eso reemplaza al control "MAL CARGADO EL CONCEPTO" de la planilla.

export async function createConcept(db: PrismaClient, p: { actor: Actor; name: string; category: string }) {
  requireAdmin(p.actor);
  const name = p.name.trim().toUpperCase();
  if (!name) throw new DomainError("NOMBRE_OBLIGATORIO", "Ingresá el nombre del concepto.");
  if (!(CATEGORIES as readonly string[]).includes(p.category)) throw new DomainError("CATEGORIA_INVALIDA", "Categoría inválida.");
  const existing = await db.expenseConcept.findUnique({ where: { name } });
  if (existing && !existing.deletedAt) throw new DomainError("CONCEPTO_EXISTE", "Ya existe un concepto con ese nombre.");
  const row = existing
    ? await db.expenseConcept.update({ where: { id: existing.id }, data: { deletedAt: null, active: true, category: p.category } })
    : await db.expenseConcept.create({ data: { name, category: p.category } });
  await audit(db, { userId: p.actor.id, entity: "ExpenseConcept", entityId: row.id, action: "CREATE", after: { name, category: p.category } });
  return row;
}

export async function setConceptActive(db: PrismaClient, p: { actor: Actor; id: string; active: boolean }) {
  requireAdmin(p.actor);
  const c = await db.expenseConcept.findUnique({ where: { id: p.id } });
  if (!c || c.deletedAt) throw new DomainError("CONCEPTO_INVALIDO", "Ese concepto no existe.");
  await db.expenseConcept.update({ where: { id: p.id }, data: { active: p.active } });
  await audit(db, { userId: p.actor.id, entity: "ExpenseConcept", entityId: p.id, action: "UPDATE", before: { active: c.active }, after: { active: p.active } });
}

// --- Gastos fijos recurrentes y recordatorio mensual -------------------------------------------------------------------------------

export async function createRecurring(db: PrismaClient, p: { actor: Actor; conceptId: string; dayOfMonth: number; amount?: number | null; description?: string }) {
  requireAdmin(p.actor);
  if (!Number.isInteger(p.dayOfMonth) || p.dayOfMonth < 1 || p.dayOfMonth > 28) throw new DomainError("DIA_INVALIDO", "El día del mes debe estar entre 1 y 28.");
  if (p.amount != null) checkAmount(p.amount);
  const c = await db.expenseConcept.findUnique({ where: { id: p.conceptId } });
  if (!c || c.deletedAt || !c.active) throw new DomainError("CONCEPTO_INVALIDO", "Elegí un concepto de la lista.");
  const row = await db.recurringExpense.create({ data: { conceptId: p.conceptId, dayOfMonth: p.dayOfMonth, amount: p.amount ?? null, description: p.description?.trim() || null } });
  await audit(db, { userId: p.actor.id, entity: "RecurringExpense", entityId: row.id, action: "CREATE", after: { concept: c.name, dayOfMonth: p.dayOfMonth, amount: p.amount } });
  return row;
}

export async function deleteRecurring(db: PrismaClient, p: { actor: Actor; id: string }) {
  requireAdmin(p.actor);
  const r = await db.recurringExpense.findUnique({ where: { id: p.id } });
  if (!r || r.deletedAt) throw new DomainError("RECURRENTE_INEXISTENTE", "Ese gasto fijo no existe.");
  await db.recurringExpense.update({ where: { id: p.id }, data: { deletedAt: new Date(), active: false } });
  await audit(db, { userId: p.actor.id, entity: "RecurringExpense", entityId: p.id, action: "DELETE" });
}

export interface RecurringRow {
  id: string;
  conceptId: string;
  concept: string;
  dayOfMonth: number;
  amount: number | null;
  description: string | null;
  /** Ya hay un gasto de ese concepto cargado en el mes. */
  done: boolean;
  /** Ya pasó el día de vencimiento y no está cargado. */
  due: boolean;
}

/** Gastos fijos y su estado en el mes: pendiente (vencido si ya pasó el día) o cargado. */
export async function recurringStatus(db: Db, month: string, now: Date = new Date()): Promise<RecurringRow[]> {
  const today = todayBA(now);
  const recs = await db.recurringExpense.findMany({ where: { deletedAt: null, active: true }, include: { concept: true }, orderBy: { dayOfMonth: "asc" } });
  const exps = await db.expense.findMany({ where: { deletedAt: null, date: monthRange(month) }, select: { conceptId: true } });
  const loaded = new Set(exps.map((e) => e.conceptId));
  return recs.map((r) => {
    const dueDate = `${month}-${String(r.dayOfMonth).padStart(2, "0")}`;
    const done = loaded.has(r.conceptId);
    return { id: r.id, conceptId: r.conceptId, concept: r.concept.name, dayOfMonth: r.dayOfMonth, amount: r.amount, description: r.description, done, due: !done && today >= dueDate };
  });
}

// --- Otros ingresos (publicidad, alquiler de yerba…) ---------------------------------------------------------------------------------

export async function addExtraIncome(db: PrismaClient, p: { actor: Actor; date: string; concept: string; amount: number; note?: string; now?: Date }) {
  requireAdmin(p.actor);
  checkDate(p.date, p.now ?? new Date());
  checkAmount(p.amount);
  const concept = p.concept.trim();
  if (!concept) throw new DomainError("CONCEPTO_INVALIDO", "Ingresá el concepto (publicidad, alquiler de yerba…).");
  const row = await db.extraIncome.create({ data: { date: p.date, concept, amount: p.amount, note: p.note?.trim() || null, createdById: p.actor.id } });
  await audit(db, { userId: p.actor.id, entity: "ExtraIncome", entityId: row.id, action: "CREATE", after: { date: p.date, concept, amount: p.amount } });
  return row;
}

export async function deleteExtraIncome(db: PrismaClient, p: { actor: Actor; id: string }) {
  requireAdmin(p.actor);
  const r = await db.extraIncome.findUnique({ where: { id: p.id } });
  if (!r || r.deletedAt) throw new DomainError("INGRESO_INEXISTENTE", "Ese ingreso no existe.");
  await db.extraIncome.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
  await audit(db, { userId: p.actor.id, entity: "ExtraIncome", entityId: p.id, action: "DELETE", before: { concept: r.concept, amount: r.amount } });
}

export async function listExtraIncome(db: Db, month: string) {
  return db.extraIncome.findMany({ where: { deletedAt: null, date: monthRange(month) }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
}
