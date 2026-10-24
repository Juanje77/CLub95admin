import type { PrismaClient } from "@prisma/client";
import { computeDay } from "../domain/cash";
import { todayBA } from "../domain/money";
import type { ServiceCounts, ServiceType } from "../domain/types";
import { audit, DomainError, isAdmin, type Actor, type Db } from "./common";
import { loadPricing } from "./figures";
import { membershipLaborFor } from "./members";

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

/** Cifras de un barbero en un mes, sin guardar nada (a diferencia de la compensación de fin de mes). */
export async function barberMonth(db: Db, userId: string, month: string): Promise<BarberMonth> {
  const { tariffs, rules } = await loadPricing(db);
  const sales = await db.sale.findMany({ where: { userId, kind: "SERVICE", deletedAt: null, date: monthRange(month) } });
  const byDate = new Map<string, ServiceCounts>();
  for (const s of sales) {
    const c = byDate.get(s.date) ?? {};
    c[s.serviceType as ServiceType] = (c[s.serviceType as ServiceType] ?? 0) + s.quantity;
    byDate.set(s.date, c);
  }
  let laborServices = 0;
  for (const [date, services] of byDate) laborServices += computeDay({ date, tariffs, barbers: [{ barberId: userId, rules: rules.get(userId) ?? [], services }] }).labor;
  const laborMembership = await membershipLaborFor(db, userId, month);

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

export interface BarberPayable extends BarberMonth {
  userId: string;
  name: string;
  /** Se paga solo: retira su parte de la cuenta donde entran los cortes (Ale). No suma a lo que hay que pagar. */
  selfPaid: boolean;
  /** Lo que quedó de meses anteriores (positivo = se le debía; negativo = había cobrado de más). */
  carried: number;
  /** Lo que falta pagarle hoy: lo arrastrado más lo del mes. Negativo = cobró de más y tiene que devolver. */
  toPay: number;
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
  const months: string[] = [];
  if (first) for (let m = first; m < month; m = nextMonth(m)) months.push(m);

  const barbers: BarberPayable[] = [];
  for (const u of users) {
    let carried = 0;
    for (const m of months) carried += (await barberMonth(db, u.id, m)).balance;
    const cur = await barberMonth(db, u.id, month);
    const selfPaid = u.role === "ADMIN";
    // Un barbero inactivo sin movimientos ni saldo no aporta nada a la lista.
    if (!u.active && cur.entitled === 0 && cur.collected === 0 && carried === 0) continue;
    barbers.push({ ...cur, userId: u.id, name: u.name, selfPaid, carried, toPay: carried + cur.balance });
  }
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    month,
    barbers,
    totalToPay: barbers.filter((b) => !b.selfPaid).reduce((s, b) => s + Math.max(0, b.toPay), 0),
    payments: paymentRows.map((p) => ({ id: p.id, userId: p.userId, name: nameOf.get(p.userId) ?? "", date: p.date, amount: p.amount, method: p.method, note: p.note })),
  };
}

export async function addBarberPayment(db: PrismaClient, p: { actor: Actor; userId: string; date: string; amount: number; method: string; note?: string; now?: Date }) {
  if (!isAdmin(p.actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño registran pagos a los barberos.");
  if (!DATE_RE.test(p.date) || Number.isNaN(Date.parse(`${p.date}T12:00:00Z`))) throw new DomainError("FECHA_INVALIDA", "La fecha es inválida.");
  if (p.date > todayBA(p.now ?? new Date())) throw new DomainError("FECHA_FUTURA", "La fecha no puede ser futura.");
  if (!Number.isInteger(p.amount) || p.amount <= 0 || p.amount > 1_000_000_000) throw new DomainError("MONTO_INVALIDO", "El monto debe ser un entero mayor a 0.");
  if (!["BANCO", "EFECTIVO"].includes(p.method)) throw new DomainError("MEDIO_DE_PAGO_INVALIDO", "Elegí transferencia o efectivo.");
  const barber = await db.user.findUnique({ where: { id: p.userId } });
  if (!barber || !barber.isBarber) throw new DomainError("BARBERO_INVALIDO", "Ese usuario no es un barbero.");
  const row = await db.barberPayment.create({ data: { userId: p.userId, date: p.date, amount: p.amount, method: p.method, note: p.note?.trim() || null, createdById: p.actor.id } });
  await audit(db, { userId: p.actor.id, entity: "BarberPayment", entityId: row.id, action: "CREATE", after: { barber: barber.name, date: p.date, amount: p.amount, method: p.method } });
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
