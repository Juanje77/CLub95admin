import type { PrismaClient } from "@prisma/client";
import { daysSince, DEFAULT_MEMBER_PRICES, memberBalance, memberContribution } from "../domain/members";
import { todayBA } from "../domain/money";
import { pickEffective } from "../domain/rules";
import type { BarberRule } from "../domain/types";
import { audit, DomainError, isAdmin, type Actor, type Db } from "./common";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEMBER_TYPES = ["CORTE", "CORTE_BARBA"] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];
export const PAY_METHODS = ["EFECTIVO", "BANCO"] as const;

function requireAdmin(actor: Actor) {
  if (!isAdmin(actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño manejan los socios y sus cobros.");
}
function checkDate(date: string, now: Date) {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new DomainError("FECHA_INVALIDA", "La fecha es inválida.");
  if (date > todayBA(now)) throw new DomainError("FECHA_FUTURA", "La fecha no puede ser futura.");
}
function checkMoney(n: number, label = "monto") {
  if (!Number.isInteger(n) || n <= 0 || n > 100_000_000) throw new DomainError("MONTO_INVALIDO", `El ${label} debe ser un entero mayor a 0.`);
}
const monthRange = (month: string) => ({ gte: `${month}-01`, lte: `${month}-31` });

/** Precio por visita de cada tipo de membresía (Setting "memberPrices"; por defecto $ 15.000 y $ 16.500). */
export async function defaultMemberPrice(db: Db, type: MemberType): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: "memberPrices" } });
  try {
    const parsed = row ? (JSON.parse(row.value) as Partial<Record<MemberType, number>>) : {};
    return parsed[type] ?? DEFAULT_MEMBER_PRICES[type];
  } catch {
    return DEFAULT_MEMBER_PRICES[type];
  }
}

// --- Socios ---------------------------------------------------------------------------------------------------------------

export async function createMember(
  db: PrismaClient,
  p: { actor: Actor; name: string; serviceType: string; userId: string | null; price?: number; plan?: string; phone?: string; startDate?: string; note?: string; now?: Date },
) {
  requireAdmin(p.actor);
  const name = p.name.trim();
  if (!name) throw new DomainError("NOMBRE_OBLIGATORIO", "Ingresá el nombre del socio.");
  if (!(MEMBER_TYPES as readonly string[]).includes(p.serviceType)) throw new DomainError("TIPO_INVALIDO", "El tipo debe ser corte o corte y barba.");
  const now = p.now ?? new Date();
  const startDate = p.startDate || todayBA(now);
  if (!DATE_RE.test(startDate)) throw new DomainError("FECHA_INVALIDA", "La fecha es inválida.");
  if (p.userId) {
    const b = await db.user.findUnique({ where: { id: p.userId } });
    if (!b || !b.isBarber) throw new DomainError("BARBERO_INVALIDO", "El barbero asignado no es válido.");
  }
  const price = p.price ?? (await defaultMemberPrice(db, p.serviceType as MemberType));
  checkMoney(price, "precio");
  return db.$transaction(async (tx) => {
    const m = await tx.member.create({
      data: { name, plan: p.plan?.trim() || "BLACK", serviceType: p.serviceType, userId: p.userId, phone: p.phone?.trim() || null, startDate, note: p.note?.trim() || null },
    });
    await tx.memberPrice.create({ data: { memberId: m.id, validFrom: startDate, price } });
    await audit(tx, { userId: p.actor.id, entity: "Member", entityId: m.id, action: "CREATE", after: { name, serviceType: p.serviceType, price, userId: p.userId } });
    return m;
  });
}

export async function updateMember(
  db: PrismaClient,
  p: { actor: Actor; id: string; name?: string; userId?: string | null; serviceType?: string; phone?: string; note?: string; active?: boolean },
) {
  requireAdmin(p.actor);
  const cur = await db.member.findUnique({ where: { id: p.id } });
  if (!cur || cur.deletedAt) throw new DomainError("SOCIO_INEXISTENTE", "Ese socio no existe.");
  if (p.name !== undefined && !p.name.trim()) throw new DomainError("NOMBRE_OBLIGATORIO", "Ingresá el nombre del socio.");
  if (p.serviceType !== undefined && !(MEMBER_TYPES as readonly string[]).includes(p.serviceType)) throw new DomainError("TIPO_INVALIDO", "El tipo debe ser corte o corte y barba.");
  const row = await db.member.update({
    where: { id: p.id },
    data: {
      ...(p.name !== undefined ? { name: p.name.trim() } : {}),
      ...(p.userId !== undefined ? { userId: p.userId } : {}),
      ...(p.serviceType !== undefined ? { serviceType: p.serviceType } : {}),
      ...(p.phone !== undefined ? { phone: p.phone.trim() || null } : {}),
      ...(p.note !== undefined ? { note: p.note.trim() || null } : {}),
      ...(p.active !== undefined ? { active: p.active } : {}),
    },
  });
  await audit(db, { userId: p.actor.id, entity: "Member", entityId: p.id, action: "UPDATE", before: { name: cur.name, userId: cur.userId, serviceType: cur.serviceType, active: cur.active }, after: { name: row.name, userId: row.userId, serviceType: row.serviceType, active: row.active } });
  return row;
}

/** Cambia el precio por visita desde una fecha; las asistencias anteriores conservan su precio. */
export async function addMemberPrice(db: PrismaClient, p: { actor: Actor; memberId: string; validFrom: string; price: number; now?: Date }) {
  requireAdmin(p.actor);
  checkMoney(p.price, "precio");
  if (!DATE_RE.test(p.validFrom)) throw new DomainError("FECHA_INVALIDA", "La fecha es inválida.");
  if (p.validFrom < todayBA(p.now ?? new Date()) && p.actor.role !== "DUENO") throw new DomainError("VIGENCIA_PASADA", "Un cambio no puede regir desde una fecha pasada. Pedile al dueño que lo corrija.");
  if (!(await db.member.findUnique({ where: { id: p.memberId } }))) throw new DomainError("SOCIO_INEXISTENTE", "Ese socio no existe.");
  const row = await db.memberPrice.upsert({
    where: { memberId_validFrom: { memberId: p.memberId, validFrom: p.validFrom } },
    update: { price: p.price },
    create: { memberId: p.memberId, validFrom: p.validFrom, price: p.price },
  });
  await audit(db, { userId: p.actor.id, entity: "MemberPrice", entityId: row.id, action: "CREATE", after: { memberId: p.memberId, validFrom: p.validFrom, price: p.price } });
  return row;
}

// --- Asistencia -----------------------------------------------------------------------------------------------------------------
// Tildar a un socio el día que viene. Cada asistencia se cobra al precio vigente y suma al barbero que lo atendió.

export async function setAttendance(db: PrismaClient, p: { actor: Actor; memberId: string; date: string; present: boolean; barberId?: string | null; now?: Date }) {
  const now = p.now ?? new Date();
  checkDate(p.date, now);
  const today = todayBA(now);
  const admin = isAdmin(p.actor);
  if (!admin && p.date !== today) throw new DomainError("DIA_PASADO_REQUIERE_ADMIN", "Marcar la asistencia de un día pasado requiere permiso del admin.");
  return db.$transaction(async (tx) => {
    const member = await tx.member.findUnique({ where: { id: p.memberId } });
    if (!member || member.deletedAt || !member.active) throw new DomainError("SOCIO_INEXISTENTE", "Ese socio no existe o está dado de baja.");
    const existing = await tx.attendance.findUnique({ where: { memberId_date: { memberId: p.memberId, date: p.date } } });
    const live = !!existing && !existing.deletedAt;

    if (p.present) {
      if (live) return { changed: false };
      // Barbero que atendió: el que marca (si es barbero) o el indicado / el asignado al socio.
      const servedBy = admin ? (p.barberId ?? member.userId ?? (p.actor.id)) : p.actor.id;
      const barber = await tx.user.findUnique({ where: { id: servedBy } });
      if (!barber || !barber.isBarber) throw new DomainError("BARBERO_INVALIDO", "Elegí el barbero que lo atendió.");
      if (existing) await tx.attendance.update({ where: { id: existing.id }, data: { deletedAt: null, userId: servedBy, createdById: p.actor.id } });
      else await tx.attendance.create({ data: { memberId: p.memberId, date: p.date, userId: servedBy, createdById: p.actor.id } });
      await audit(tx, { userId: p.actor.id, entity: "Attendance", entityId: `${p.memberId}:${p.date}`, action: "CREATE", after: { member: member.name, date: p.date, servedBy } });
      return { changed: true };
    }

    if (!live) return { changed: false };
    if (!admin && existing!.userId !== p.actor.id) throw new DomainError("SOLO_PROPIO", "Solo podés sacar las asistencias que marcaste vos.");
    await tx.attendance.update({ where: { id: existing!.id }, data: { deletedAt: new Date() } });
    await audit(tx, { userId: p.actor.id, entity: "Attendance", entityId: `${p.memberId}:${p.date}`, action: "DELETE", before: { member: member.name, date: p.date } });
    return { changed: true };
  });
}

// --- Cuenta corriente: cobros y ajustes ----------------------------------------------------------------------------------------------

export async function registerPayment(db: PrismaClient, p: { actor: Actor; memberId: string; date: string; amount: number; method: string; note?: string; now?: Date }) {
  requireAdmin(p.actor);
  checkDate(p.date, p.now ?? new Date());
  checkMoney(p.amount);
  if (!(PAY_METHODS as readonly string[]).includes(p.method)) throw new DomainError("MEDIO_DE_PAGO_INVALIDO", "Elegí efectivo o banco/Mercado Pago.");
  if (!(await db.member.findUnique({ where: { id: p.memberId } }))) throw new DomainError("SOCIO_INEXISTENTE", "Ese socio no existe.");
  const row = await db.memberLedger.create({
    data: { memberId: p.memberId, date: p.date, period: p.date.slice(0, 7), kind: "PAGO", credit: p.amount, method: p.method, note: p.note?.trim() || null },
  });
  await audit(db, { userId: p.actor.id, entity: "MemberLedger", entityId: row.id, action: "CREATE", after: { memberId: p.memberId, kind: "PAGO", amount: p.amount, method: p.method } });
  return row;
}

/** Ajuste manual con motivo: positivo suma deuda (cargo extra), negativo la baja (descuento o saldo a favor). */
export async function adjustMember(db: PrismaClient, p: { actor: Actor; memberId: string; date: string; amount: number; reason: string; now?: Date }) {
  requireAdmin(p.actor);
  checkDate(p.date, p.now ?? new Date());
  if (!Number.isInteger(p.amount) || p.amount === 0 || Math.abs(p.amount) > 100_000_000) throw new DomainError("MONTO_INVALIDO", "El ajuste debe ser un entero distinto de 0.");
  if (!p.reason.trim()) throw new DomainError("MOTIVO_OBLIGATORIO", "Indicá el motivo del ajuste.");
  if (!(await db.member.findUnique({ where: { id: p.memberId } }))) throw new DomainError("SOCIO_INEXISTENTE", "Ese socio no existe.");
  const row = await db.memberLedger.create({
    data: { memberId: p.memberId, date: p.date, period: p.date.slice(0, 7), kind: "AJUSTE", debit: p.amount > 0 ? p.amount : 0, credit: p.amount < 0 ? -p.amount : 0, note: p.reason.trim() },
  });
  await audit(db, { userId: p.actor.id, entity: "MemberLedger", entityId: row.id, action: "CREATE", after: { memberId: p.memberId, kind: "AJUSTE", amount: p.amount, reason: p.reason.trim() } });
  return row;
}

export async function voidLedgerEntry(db: PrismaClient, p: { actor: Actor; id: string; reason: string }) {
  requireAdmin(p.actor);
  if (!p.reason.trim()) throw new DomainError("MOTIVO_OBLIGATORIO", "Indicá el motivo.");
  const e = await db.memberLedger.findUnique({ where: { id: p.id } });
  if (!e || e.deletedAt) throw new DomainError("MOVIMIENTO_INEXISTENTE", "Ese movimiento no existe.");
  await db.memberLedger.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
  await audit(db, { userId: p.actor.id, entity: "MemberLedger", entityId: p.id, action: "DELETE", before: { kind: e.kind, debit: e.debit, credit: e.credit }, after: { reason: p.reason.trim() } });
}

// --- Lectura ---------------------------------------------------------------------------------------------------------------------

export interface MemberRow {
  id: string;
  name: string;
  plan: string;
  serviceType: string;
  userId: string | null;
  barberName: string;
  active: boolean;
  phone: string | null;
  price: number;
  /** Fechas del mes en que vino. */
  attended: string[];
  visits: number;
  charged: number;
  paid: number;
  /** Saldo total a hoy (todos los meses): positivo = debe. */
  balance: number;
  /** Lo que se debía al cierre del mes anterior y sigue sin pagarse. */
  carried: number;
  lastVisit: string | null;
  daysSinceVisit: number | null;
  barberShare: number;
  localShare: number;
}

export interface MembersMonth {
  month: string;
  members: MemberRow[];
  totals: { active: number; visits: number; charged: number; paid: number; debt: number; barberShare: number; localShare: number };
}

/** Precio por visita vigente a `date`. Si la fecha es anterior al primer precio cargado, se usa ese primero (nunca queda en 0 en silencio). */
function priceFor(prices: { validFrom: string; price: number }[], date: string): number {
  const eff = pickEffective(prices, date);
  if (eff) return eff.price;
  const first = [...prices].sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1))[0];
  return first?.price ?? 0;
}

export async function getMembersMonth(db: Db, month: string, now: Date = new Date()): Promise<MembersMonth> {
  const today = todayBA(now);
  const prevEnd = new Date(Date.parse(`${month}-01T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const [members, attendance, ledger, users, ruleRows] = await Promise.all([
    db.member.findMany({ where: { deletedAt: null }, include: { prices: true }, orderBy: [{ name: "asc" }] }),
    db.attendance.findMany({ where: { deletedAt: null, date: { lte: `${month}-31` } } }),
    db.memberLedger.findMany({ where: { deletedAt: null } }),
    db.user.findMany({ where: { isBarber: true } }),
    db.barberRule.findMany({ where: { deletedAt: null } }),
  ]);
  const rulesBy = new Map<string, BarberRule[]>();
  for (const r of ruleRows) rulesBy.set(r.userId, [...(rulesBy.get(r.userId) ?? []), { validFrom: r.validFrom, commissionBp: r.commissionBp, drinkDeduction: r.drinkDeduction, drinkCost: r.drinkCost }]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const rows: MemberRow[] = members.map((m) => {
    const mine = attendance.filter((a) => a.memberId === m.id);
    const led = ledger.filter((l) => l.memberId === m.id);
    const chargesUpTo = (to: string) => mine.filter((a) => a.date <= to).reduce((s, a) => s + priceFor(m.prices, a.date), 0);
    const adjUpTo = (to: string) => led.filter((l) => l.kind === "AJUSTE" && l.date <= to).reduce((s, l) => s + l.debit - l.credit, 0);
    const payUpTo = (to: string) => led.filter((l) => l.kind === "PAGO" && l.date <= to).reduce((s, l) => s + l.credit, 0);
    const inMonth = mine.filter((a) => a.date.startsWith(month));
    let barberShare = 0;
    let localShare = 0;
    for (const a of inMonth) {
      const rule = pickEffective(rulesBy.get(a.userId ?? m.userId ?? "") ?? [], a.date);
      const price = priceFor(m.prices, a.date);
      if (!rule) {
        localShare += price;
        continue;
      }
      const c = memberContribution(price, rule);
      barberShare += c.barber;
      localShare += c.local;
    }
    const lastVisit = mine.reduce<string | null>((best, a) => (!best || a.date > best ? a.date : best), null);
    return {
      id: m.id, name: m.name, plan: m.plan, serviceType: m.serviceType, userId: m.userId,
      barberName: (m.userId && nameOf.get(m.userId)) || "Sin asignar", active: m.active, phone: m.phone,
      price: priceFor(m.prices, month === today.slice(0, 7) ? today : `${month}-28`),
      attended: inMonth.map((a) => a.date).sort(), visits: inMonth.length,
      charged: inMonth.reduce((s, a) => s + priceFor(m.prices, a.date), 0),
      paid: led.filter((l) => l.kind === "PAGO" && l.date.startsWith(month)).reduce((s, l) => s + l.credit, 0),
      balance: memberBalance({ charges: chargesUpTo("9999-12-31"), adjustments: adjUpTo("9999-12-31"), payments: payUpTo("9999-12-31") }),
      carried: Math.max(0, memberBalance({ charges: chargesUpTo(prevEnd), adjustments: adjUpTo(prevEnd), payments: payUpTo("9999-12-31") })),
      lastVisit,
      daysSinceVisit: lastVisit ? daysSince(lastVisit, today) : null,
      barberShare, localShare,
    };
  });
  const active = rows.filter((r) => r.active || r.visits > 0 || r.balance !== 0);
  return {
    month,
    members: active,
    totals: {
      active: rows.filter((r) => r.active).length,
      visits: active.reduce((a, r) => a + r.visits, 0),
      charged: active.reduce((a, r) => a + r.charged, 0),
      paid: active.reduce((a, r) => a + r.paid, 0),
      debt: active.reduce((a, r) => a + Math.max(0, r.balance), 0),
      barberShare: active.reduce((a, r) => a + r.barberShare, 0),
      localShare: active.reduce((a, r) => a + r.localShare, 0),
    },
  };
}

export async function getMemberLedger(db: Db, memberId: string) {
  return db.memberLedger.findMany({ where: { memberId, deletedAt: null }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
}

/** Lo que le corresponde cobrar a un barbero en el mes por las asistencias de socios que atendió. */
export async function membershipLaborFor(db: Db, userId: string, period: string): Promise<number> {
  const att = await db.attendance.findMany({ where: { deletedAt: null, userId, date: monthRange(period) }, include: { member: { include: { prices: true } } } });
  if (att.length === 0) return 0;
  const rules = (await db.barberRule.findMany({ where: { userId, deletedAt: null } })).map((r) => ({ validFrom: r.validFrom, commissionBp: r.commissionBp, drinkDeduction: r.drinkDeduction, drinkCost: r.drinkCost }));
  let total = 0;
  for (const a of att) {
    const rule = pickEffective(rules, a.date);
    if (rule) total += memberContribution(priceFor(a.member.prices, a.date), rule).barber;
  }
  return total;
}

/** Totales del mes para el panel: ingreso devengado (visitas × precio), mano de obra por barbero y costo de la bebida entregada. */
export async function membershipMonthTotals(db: Db, month: string) {
  const att = await db.attendance.findMany({ where: { deletedAt: null, date: monthRange(month) }, include: { member: { include: { prices: true } } } });
  const rules = new Map<string, BarberRule[]>();
  for (const r of await db.barberRule.findMany({ where: { deletedAt: null } })) rules.set(r.userId, [...(rules.get(r.userId) ?? []), { validFrom: r.validFrom, commissionBp: r.commissionBp, drinkDeduction: r.drinkDeduction, drinkCost: r.drinkCost }]);
  let income = 0;
  let drinkCost = 0;
  const laborByBarber: Record<string, number> = {};
  const visitsByBarber: Record<string, number> = {};
  for (const a of att) {
    const price = priceFor(a.member.prices, a.date);
    income += price;
    const who = a.userId ?? a.member.userId ?? "";
    visitsByBarber[who] = (visitsByBarber[who] ?? 0) + 1;
    const rule = pickEffective(rules.get(who) ?? [], a.date);
    if (rule) {
      laborByBarber[who] = (laborByBarber[who] ?? 0) + memberContribution(price, rule).barber;
      drinkCost += rule.drinkCost;
    }
  }
  const paid = (await db.memberLedger.findMany({ where: { deletedAt: null, kind: "PAGO", date: monthRange(month) } })).reduce((s, l) => s + l.credit, 0);
  return { visits: att.length, income, paid, drinkCost, laborByBarber, visitsByBarber };
}

/** Datos para las alertas: socios con deuda vencida y socios que dejaron de venir. */
export async function memberAlertData(db: Db, now: Date, opts: { inactiveDays: number; debtDay: number }) {
  const today = todayBA(now);
  const dayOfMonth = Number(today.slice(8, 10));
  const { members } = await getMembersMonth(db, today.slice(0, 7), now);
  const debts = dayOfMonth >= opts.debtDay ? members.filter((m) => m.active && m.carried > 0).map((m) => ({ id: m.id, name: m.name, amount: m.carried })) : [];
  const inactive = members
    .filter((m) => m.active && m.daysSinceVisit !== null && m.daysSinceVisit >= opts.inactiveDays)
    .map((m) => ({ id: m.id, name: m.name, days: m.daysSinceVisit! }));
  return { debts, inactive };
}
