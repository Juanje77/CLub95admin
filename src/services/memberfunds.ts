import type { PrismaClient } from "@prisma/client";
import { FUND_KINDS, FUNDS, paidFigures, type Fund } from "../domain/memberfunds";
import { todayBA } from "../domain/money";
import { audit, DomainError, isAdmin, type Actor, type Db } from "./common";
import { allMemberLines } from "./members";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export interface MonthFundsRow {
  month: string;
  /** Efectivo cobrado a socios en el mes (por fecha de cobro). */
  cash: number;
  /** Lo que Ale se queda por sus sesiones de socios del mes. */
  aleCuts: number;
  /** Bebida del mes: lo descontado en todas las sesiones. */
  drink: number;
  /** Ganancia del mes de los barberos con cuenta de ganancia (Lucio). */
  profit: number;
  sessions: number;
}
export interface FundEntryRow { id: string; fund: string; date: string; kind: string; amount: number; note: string | null }
export interface DrinkByBarber { barberId: string; name: string; sessions: number; amount: number }
export interface MemberFunds {
  month: string;
  profitBarbers: string[];
  /** Saldos acumulados desde el primer dato. */
  balances: { efectivo: number; bebida: number; ganancia: number };
  /** Cómo se compone cada saldo (acumulado). */
  parts: {
    cashCollected: number;
    aleCuts: number;
    efectivoEntries: number;
    drink: number;
    bebidaEntries: number;
    profit: number;
    gananciaEntries: number;
  };
  /** El mes elegido. */
  current: MonthFundsRow;
  drinkByBarber: DrinkByBarber[];
  months: MonthFundsRow[];
  entries: FundEntryRow[];
}

/** Barberos con cuenta de ganancia propia (Setting "memberFunds"; por defecto Lucio). */
async function profitBarberNames(db: Db): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: "memberFunds" } });
  try {
    const v = row ? (JSON.parse(row.value) as { profitBarbers?: unknown }).profitBarbers : undefined;
    if (Array.isArray(v) && v.every((x) => typeof x === "string") && v.length) return v as string[];
  } catch {
    /* se usa el valor por defecto */
  }
  return ["Lucio"];
}

export async function getMemberFunds(db: Db, month: string): Promise<MemberFunds> {
  const [lines, users, cashPays, entries, names] = await Promise.all([
    allMemberLines(db),
    db.user.findMany({ where: { isBarber: true } }),
    db.memberLedger.findMany({ where: { deletedAt: null, kind: "PAGO", method: "EFECTIVO" } }),
    db.memberFundEntry.findMany({ where: { deletedAt: null }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
    profitBarberNames(db),
  ]);
  const aleIds = new Set(users.filter((u) => u.role === "ADMIN").map((u) => u.id));
  const profitIds = new Set(users.filter((u) => names.some((n) => norm(n) === norm(u.name))).map((u) => u.id));
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const byMonth = new Map<string, MonthFundsRow>();
  const row = (m: string) => {
    let r = byMonth.get(m);
    if (!r) byMonth.set(m, (r = { month: m, cash: 0, aleCuts: 0, drink: 0, profit: 0, sessions: 0 }));
    return r;
  };
  const drinkBy = new Map<string, DrinkByBarber>();
  for (const l of lines) {
    const r = row(l.month);
    r.sessions += l.qty;
    if (!l.rule) continue;
    const f = paidFigures(l.paid, l.qty, l.rule);
    r.drink += f.drink;
    if (aleIds.has(l.who)) r.aleCuts += f.labor;
    if (profitIds.has(l.who)) r.profit += f.profit;
    if (l.month === month) {
      const d = drinkBy.get(l.who) ?? { barberId: l.who, name: nameOf.get(l.who) ?? "Sin asignar", sessions: 0, amount: 0 };
      d.sessions += l.qty;
      d.amount += f.drink;
      drinkBy.set(l.who, d);
    }
  }
  for (const p of cashPays) row(p.date.slice(0, 7)).cash += p.credit;
  row(month);

  const all = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  const sum = (k: "cash" | "aleCuts" | "drink" | "profit") => all.reduce((s, r) => s + r[k], 0);
  const ent = (fund: Fund) => entries.filter((e) => e.fund === fund).reduce((s, e) => s + e.amount, 0);
  const parts = {
    cashCollected: sum("cash"), aleCuts: sum("aleCuts"), efectivoEntries: ent("EFECTIVO"),
    drink: sum("drink"), bebidaEntries: ent("BEBIDA"),
    profit: sum("profit"), gananciaEntries: ent("GANANCIA"),
  };
  return {
    month,
    profitBarbers: names,
    balances: {
      efectivo: parts.cashCollected - parts.aleCuts + parts.efectivoEntries,
      bebida: parts.drink + parts.bebidaEntries,
      ganancia: parts.profit + parts.gananciaEntries,
    },
    parts,
    current: row(month),
    drinkByBarber: [...drinkBy.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
    months: all.filter((r) => r.month <= month).slice(-6).reverse(),
    entries: entries.slice(0, 60).map((e) => ({ id: e.id, fund: e.fund, date: e.date, kind: e.kind, amount: e.amount, note: e.note })),
  };
}

/**
 * Movimiento manual de una cuenta. Rendición, compra de bebida y retiro de ganancia bajan el saldo (se carga el monto en positivo);
 * el ajuste lleva signo y motivo obligatorio (sirve para el saldo inicial).
 */
export async function addFundEntry(db: PrismaClient, p: { actor: Actor; fund: string; kind: string; amount: number; date: string; note?: string; now?: Date }) {
  if (!isAdmin(p.actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño manejan las cuentas de socios.");
  if (!(FUNDS as readonly string[]).includes(p.fund)) throw new DomainError("CUENTA_INVALIDA", "La cuenta es inválida.");
  if (!FUND_KINDS[p.fund as Fund].includes(p.kind)) throw new DomainError("MOVIMIENTO_INVALIDO", "Ese movimiento no corresponde a esa cuenta.");
  if (!DATE_RE.test(p.date) || Number.isNaN(Date.parse(`${p.date}T12:00:00Z`))) throw new DomainError("FECHA_INVALIDA", "La fecha es inválida.");
  if (p.date > todayBA(p.now ?? new Date())) throw new DomainError("FECHA_FUTURA", "La fecha no puede ser futura.");
  const adjust = p.kind === "AJUSTE";
  if (!Number.isInteger(p.amount) || p.amount === 0 || Math.abs(p.amount) > 1_000_000_000 || (!adjust && p.amount < 0)) {
    throw new DomainError("MONTO_INVALIDO", adjust ? "El ajuste debe ser un entero distinto de 0." : "El monto debe ser un entero mayor a 0.");
  }
  if (adjust && !(p.note ?? "").trim()) throw new DomainError("MOTIVO_OBLIGATORIO", "Indicá el motivo del ajuste.");
  const amount = adjust ? p.amount : -p.amount;
  const row = await db.memberFundEntry.create({ data: { fund: p.fund, date: p.date, kind: p.kind, amount, note: p.note?.trim() || null, createdById: p.actor.id } });
  await audit(db, { userId: p.actor.id, entity: "MemberFundEntry", entityId: row.id, action: "CREATE", after: { fund: p.fund, kind: p.kind, amount, date: p.date } });
  return row;
}

export async function voidFundEntry(db: PrismaClient, p: { actor: Actor; id: string; reason: string }) {
  if (!isAdmin(p.actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño manejan las cuentas de socios.");
  if (!p.reason.trim()) throw new DomainError("MOTIVO_OBLIGATORIO", "Indicá el motivo.");
  const e = await db.memberFundEntry.findUnique({ where: { id: p.id } });
  if (!e || e.deletedAt) throw new DomainError("MOVIMIENTO_INEXISTENTE", "Ese movimiento no existe.");
  await db.memberFundEntry.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
  await audit(db, { userId: p.actor.id, entity: "MemberFundEntry", entityId: p.id, action: "DELETE", before: { fund: e.fund, kind: e.kind, amount: e.amount }, after: { reason: p.reason.trim() } });
}
