import type { PrismaClient } from "@prisma/client";
import { computeDay } from "../domain/cash";
import { todayBA } from "../domain/money";
import type { ServiceCounts, ServiceType } from "../domain/types";
import { audit, DomainError, isAdmin, type Actor, type Db } from "./common";
import { loadPricing } from "./figures";
import { membershipLaborByBarber } from "./members";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const monthRange = (m: string) => ({ gte: `${m}-01`, lte: `${m}-31` });
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

export interface BarberMonth {
  /** Lo que le corresponde por los cortes de la planilla. */
  laborServices: number;
  /** Lo que le corresponde por las sesiones de socios que atendió. */
  laborMembership: number;
  entitled: number;
  /** Efectivo que retiró de la caja. */
  cashTaken: number;
  /** Lo que se ingresó en su cuenta propia (por ejemplo, Mercado Pago de Jere). */
  ownTransfers: number;
  /** Pagos que se le registraron (transferencias o efectivo del local). */
  paid: number;
  /** Lo que ya cobró en el mes. */
  collected: number;
  /** Mes: corresponde − cobrado. Positivo = falta pagarle; negativo = cobró de más. */
  balance: number;
}

/** Lo que se comparte entre varias llamadas para no repetir lecturas: precios y reglas, y lo de los socios de cada mes. */
export interface PayCtx {
  pricing: Promise<Awaited<ReturnType<typeof loadPricing>>>;
  memberLabor: Map<string, Promise<Map<string, number>>>;
}
export const newPayCtx = (db: Db): PayCtx => ({ pricing: loadPricing(db), memberLabor: new Map() });
const laborOf = async (db: Db, ctx: PayCtx, userId: string, month: string) => {
  let p = ctx.memberLabor.get(month);
  if (!p) ctx.memberLabor.set(month, (p = membershipLaborByBarber(db, month)));
  return (await p).get(userId) ?? 0;
};

/** Cifras de un barbero en un mes, sin guardar nada (a diferencia de la compensación de fin de mes). */
export async function barberMonth(db: Db, userId: string, month: string, ctx: PayCtx = newPayCtx(db)): Promise<BarberMonth> {
  const { tariffs, rules } = await ctx.pricing;
  const sales = await db.sale.findMany({ where: { userId, kind: "SERVICE", deletedAt: null, date: monthRange(month) } });
  const byDate = new Map<string, ServiceCounts>();
  for (const s of sales) {
    const c = byDate.get(s.date) ?? {};
    c[s.serviceType as ServiceType] = (c[s.serviceType as ServiceType] ?? 0) + s.quantity;
    byDate.set(s.date, c);
  }
  let laborServices = 0;
  for (const [date, services] of byDate) laborServices += computeDay({ date, tariffs, barbers: [{ barberId: userId, rules: rules.get(userId) ?? [], services }] }).labor;
  const laborMembership = await laborOf(db, ctx, userId, month);

  const withdrawals = await db.cashBoxEntry.findMany({ where: { userId, kind: "RETIRO_BARBERO", deletedAt: null, date: monthRange(month) } });
  const cashTaken = withdrawals.reduce((a, e) => a - e.amount, 0);
  const own = await db.paymentAccount.findMany({ where: { ownerUserId: userId, deletedAt: null } });
  const ownTransfers = own.length
    ? (await db.cashCloseLine.findMany({ where: { account: { in: own.map((a) => a.key) }, close: { deletedAt: null, date: monthRange(month) } } })).reduce((a, l) => a + l.amount, 0)
    : 0;
  const paid = (await db.barberPayment.findMany({ where: { userId, deletedAt: null, date: monthRange(month) } })).reduce((a, p) => a + p.amount, 0);

  const entitled = laborServices + laborMembership;
  const collected = cashTaken + ownTransfers + paid;
  return { laborServices, laborMembership, entitled, cashTaken, ownTransfers, paid, collected, balance: entitled - collected };
}

/** Una fila diaria del mayor de un barbero que cobra en su cuenta. Todo en pesos; `debt` > 0 = el barbero le debe al local. */
export interface LedgerRow {
  date: string;
  /** Fila del cierre de mes con lo de los socios (no es un día). */
  members: boolean;
  /** Lo que cobró ese día en su cuenta propia (Mercado Pago). */
  collected: number;
  /** Lo que le corresponde cobrar (su 60 % de precio − bebida). */
  entitled: number;
  /** Lo que debería enviar al local: lo cobrado menos lo que le corresponde (el 40 % + la bebida). */
  shouldSend: number;
  /** Lo que el local le dio: efectivo que retiró, adelantos y el pago de fin de mes. */
  received: number;
  /** Lo que envió al local (transferencia a la cuenta del dueño o efectivo). */
  sent: number;
  /** Saldo acumulado: arrastre + debería enviar + lo que recibió − lo que envió. */
  debt: number;
}

/**
 * Mayor del mes, un renglón por día con movimiento: cobró en su cuenta, debería cobrar, debería enviar (40 % + bebida), lo que recibió del local,
 * lo que envió y saldo acumulado. Parte del saldo que arrastra de meses anteriores (`carried`, con el signo de "se le debe al barbero").
 */
export async function barberLedger(db: Db, userId: string, month: string, carried: number, ctx: PayCtx = newPayCtx(db)): Promise<LedgerRow[]> {
  const { tariffs, rules } = await ctx.pricing;
  const days = new Map<string, { collected: number; entitled: number; received: number; sent: number; members: boolean }>();
  const day = (date: string, members = false) => {
    let d = days.get(date);
    if (!d) days.set(date, (d = { collected: 0, entitled: 0, received: 0, sent: 0, members }));
    return d;
  };
  const sales = await db.sale.findMany({ where: { userId, kind: "SERVICE", deletedAt: null, date: monthRange(month) } });
  const byDate = new Map<string, ServiceCounts>();
  for (const x of sales) {
    const c = byDate.get(x.date) ?? {};
    c[x.serviceType as ServiceType] = (c[x.serviceType as ServiceType] ?? 0) + x.quantity;
    byDate.set(x.date, c);
  }
  for (const [date, services] of byDate) day(date).entitled += computeDay({ date, tariffs, barbers: [{ barberId: userId, rules: rules.get(userId) ?? [], services }] }).labor;
  const own = await db.paymentAccount.findMany({ where: { ownerUserId: userId, deletedAt: null } });
  if (own.length) {
    const lines = await db.cashCloseLine.findMany({ where: { account: { in: own.map((a) => a.key) }, close: { deletedAt: null, date: monthRange(month) } }, include: { close: true } });
    for (const l of lines) day(l.close.date).collected += l.amount;
  }
  for (const e of await db.cashBoxEntry.findMany({ where: { userId, kind: "RETIRO_BARBERO", deletedAt: null, date: monthRange(month) } })) day(e.date).received += -e.amount;
  for (const x of await db.barberPayment.findMany({ where: { userId, deletedAt: null, date: monthRange(month) } })) {
    if (x.amount >= 0) day(x.date).received += x.amount;
    else day(x.date).sent += -x.amount;
  }
  const labor = await laborOf(db, ctx, userId, month);
  if (labor) day(`${month}-31`, true).entitled += labor;
  let debt = -carried;
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, d]) => {
      const shouldSend = d.collected - d.entitled;
      debt += shouldSend + d.received - d.sent;
      return { date, members: d.members, collected: d.collected, entitled: d.entitled, shouldSend, received: d.received, sent: d.sent, debt };
    });
}

export interface BarberOpening {
  /** Mes desde el que rige este saldo inicial (YYYY-MM). Lo anterior no se arrastra. */
  month: string;
  /** Con el signo de la cuenta corriente: positivo = el barbero le debe al local; negativo = el local le debe. */
  debt: number;
  note?: string;
}

async function loadOpenings(db: Db): Promise<Record<string, BarberOpening>> {
  const row = await db.setting.findUnique({ where: { key: "barberOpening" } });
  if (!row) return {};
  try {
    return JSON.parse(row.value) as Record<string, BarberOpening>;
  } catch {
    return {};
  }
}

/**
 * Fija el saldo con el que arranca la cuenta corriente de un barbero en un mes (por ejemplo, Jere arranca octubre en cero).
 * Desde ese mes el saldo parte de este número y no arrastra lo anterior. `debt: null` lo quita y vuelve a arrastrar todo el historial.
 */
export async function setBarberOpening(db: PrismaClient, p: { actor: Actor; userId: string; month: string; debt: number | null; note?: string }) {
  if (!isAdmin(p.actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño editan el saldo de la cuenta corriente.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month)) throw new DomainError("MES_INVALIDO", "El mes es inválido.");
  const barber = await db.user.findUnique({ where: { id: p.userId } });
  if (!barber || !barber.isBarber) throw new DomainError("BARBERO_INVALIDO", "Ese usuario no es un barbero.");
  if (p.debt !== null && (!Number.isInteger(p.debt) || Math.abs(p.debt) > 1_000_000_000)) throw new DomainError("MONTO_INVALIDO", "El saldo debe ser un número entero.");
  const all = await loadOpenings(db);
  const before = all[p.userId] ?? null;
  if (p.debt === null) delete all[p.userId];
  else all[p.userId] = { month: p.month, debt: p.debt, ...(p.note?.trim() ? { note: p.note.trim().slice(0, 200) } : {}) };
  const value = JSON.stringify(all);
  await db.setting.upsert({ where: { key: "barberOpening" }, update: { value }, create: { key: "barberOpening", value } });
  await audit(db, { userId: p.actor.id, entity: "Setting", entityId: `barberOpening:${p.userId}`, action: "UPDATE", before, after: all[p.userId] ?? null });
}

export interface BarberPayable extends BarberMonth {
  userId: string;
  name: string;
  /** Se paga solo: retira su parte de la cuenta donde entran los cortes (Ale). No suma a lo que hay que pagar. */
  selfPaid: boolean;
  /** Lo que quedó de meses anteriores (positivo = se le debía; negativo = había cobrado de más). */
  carried: number;
  /** Lo que falta pagarle hoy: lo arrastrado más lo del mes. Negativo = cobró de más y tiene que devolver. */
  toPay: number;
  /** Movimientos del mes con saldo corrido (cuenta corriente). */
  ledger: LedgerRow[];
  /** Saldo inicial fijado a mano que rige para este mes (si lo hay). */
  opening: BarberOpening | null;
}
export interface BarberPaymentRow { id: string; userId: string; name: string; date: string; amount: number; method: string; note: string | null }
export interface BarberPayables {
  month: string;
  barbers: BarberPayable[];
  /** Suma de lo que falta pagar a los barberos que no se pagan solos (solo saldos a favor de ellos). */
  totalToPay: number;
  payments: BarberPaymentRow[];
}

/** Primer mes con movimiento de cualquier tipo, para arrastrar el saldo desde ahí. */
async function firstMonth(db: Db): Promise<string | null> {
  const [s, a, m, p] = await Promise.all([
    db.sale.findFirst({ where: { deletedAt: null }, orderBy: { date: "asc" }, select: { date: true } }),
    db.attendance.findFirst({ where: { deletedAt: null }, orderBy: { date: "asc" }, select: { date: true } }),
    db.memberMonth.findFirst({ orderBy: { month: "asc" }, select: { month: true } }),
    db.barberPayment.findFirst({ where: { deletedAt: null }, orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  const all = [s?.date.slice(0, 7), a?.date.slice(0, 7), m?.month, p?.date.slice(0, 7)].filter((x): x is string => !!x);
  return all.length ? all.sort()[0]! : null;
}

export async function getBarberPayables(db: Db, month: string): Promise<BarberPayables> {
  const [users, first, paymentRows] = await Promise.all([
    db.user.findMany({ where: { isBarber: true, deletedAt: null }, orderBy: { name: "asc" } }),
    firstMonth(db),
    db.barberPayment.findMany({ where: { deletedAt: null, date: monthRange(month) }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
  ]);
  const openings = await loadOpenings(db);
  const ctx = newPayCtx(db);
  const barbers: BarberPayable[] = [];
  for (const u of users) {
    // Si hay un saldo inicial fijado a mano para un mes que ya llegó, se parte de ahí y no se arrastra lo anterior.
    const op = openings[u.id] && openings[u.id]!.month <= month ? openings[u.id]! : null;
    const start = op ? op.month : first;
    const months: string[] = [];
    if (start) for (let m = start; m < month; m = nextMonth(m)) months.push(m);
    const past = await Promise.all(months.map((m) => barberMonth(db, u.id, m, ctx)));
    const carried = (op ? -op.debt : 0) + past.reduce((t, x) => t + x.balance, 0);
    const cur = await barberMonth(db, u.id, month, ctx);
    const selfPaid = u.role === "ADMIN";
    // Un barbero inactivo sin movimientos ni saldo no aporta nada a la lista.
    if (!u.active && cur.entitled === 0 && cur.collected === 0 && carried === 0) continue;
    barbers.push({ ...cur, userId: u.id, name: u.name, selfPaid, carried, toPay: carried + cur.balance, ledger: await barberLedger(db, u.id, month, carried, ctx), opening: op && op.month === month ? op : null });
  }
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    month,
    barbers,
    totalToPay: barbers.filter((b) => !b.selfPaid).reduce((s, b) => s + Math.max(0, b.toPay), 0),
    payments: paymentRows.map((p) => ({ id: p.id, userId: p.userId, name: nameOf.get(p.userId) ?? "", date: p.date, amount: p.amount, method: p.method, note: p.note })),
  };
}

export async function addBarberPayment(db: PrismaClient, p: { actor: Actor; userId: string; date: string; amount: number; method: string; note?: string; /** DEL_BARBERO: el barbero le devuelve plata al local (se guarda con signo negativo). */ direction?: "A_BARBERO" | "DEL_BARBERO"; now?: Date }) {
  if (!isAdmin(p.actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño registran pagos a los barberos.");
  if (!DATE_RE.test(p.date) || Number.isNaN(Date.parse(`${p.date}T12:00:00Z`))) throw new DomainError("FECHA_INVALIDA", "La fecha es inválida.");
  if (p.date > todayBA(p.now ?? new Date())) throw new DomainError("FECHA_FUTURA", "La fecha no puede ser futura.");
  if (!Number.isInteger(p.amount) || p.amount <= 0 || p.amount > 1_000_000_000) throw new DomainError("MONTO_INVALIDO", "El monto debe ser un entero mayor a 0.");
  if (!["BANCO", "EFECTIVO"].includes(p.method)) throw new DomainError("MEDIO_DE_PAGO_INVALIDO", "Elegí transferencia o efectivo.");
  const barber = await db.user.findUnique({ where: { id: p.userId } });
  if (!barber || !barber.isBarber) throw new DomainError("BARBERO_INVALIDO", "Ese usuario no es un barbero.");
  const back = p.direction === "DEL_BARBERO";
  const row = await db.barberPayment.create({ data: { userId: p.userId, date: p.date, amount: back ? -p.amount : p.amount, method: p.method, note: p.note?.trim() || null, createdById: p.actor.id } });
  await audit(db, { userId: p.actor.id, entity: "BarberPayment", entityId: row.id, action: "CREATE", after: { barber: barber.name, date: p.date, amount: back ? -p.amount : p.amount, method: p.method } });
  return row;
}

export async function voidBarberPayment(db: PrismaClient, p: { actor: Actor; id: string; reason: string }) {
  if (!isAdmin(p.actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño anulan pagos a los barberos.");
  if (!p.reason.trim()) throw new DomainError("MOTIVO_OBLIGATORIO", "Indicá el motivo.");
  const e = await db.barberPayment.findUnique({ where: { id: p.id } });
  if (!e || e.deletedAt) throw new DomainError("PAGO_INEXISTENTE", "Ese pago no existe.");
  await db.barberPayment.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
  await audit(db, { userId: p.actor.id, entity: "BarberPayment", entityId: p.id, action: "DELETE", before: { amount: e.amount, date: e.date }, after: { reason: p.reason.trim() } });
}
