import type { PrismaClient } from "@prisma/client";
import { buildStatement, carriedInto, DEFAULT_MEMBER_PRICES, daysSince, memberContribution, MEMBER_PLANS, oldestUnpaidMonth, type MemberPlan, type MonthEntry, type MonthStatus, type StatementRow } from "../domain/members";
import { todayBA } from "../domain/money";
import { pickEffective } from "../domain/rules";
import type { BarberRule } from "../domain/types";
import { audit, DomainError, isAdmin, type Actor, type Db } from "./common";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEMBER_TYPES = ["CORTE", "CORTE_BARBA"] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];
export const PAY_METHODS = ["EFECTIVO", "BANCO"] as const;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

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

/**
 * Precio por sesión de cada plan y tipo (Setting "memberPrices"). Acepta el formato nuevo { BLACK: { CORTE, CORTE_BARBA }, GOLD: {…} }
 * y el viejo { CORTE, CORTE_BARBA } (que se toma como BLACK). Lo que falte sale de los precios por defecto.
 */
export async function defaultMemberPrice(db: Db, type: MemberType, plan: MemberPlan = "BLACK"): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: "memberPrices" } });
  try {
    const parsed = row ? (JSON.parse(row.value) as Record<string, unknown>) : {};
    const byPlan = (parsed[plan] ?? (plan === "BLACK" ? parsed : {})) as Partial<Record<MemberType, number>>;
    const v = byPlan[type];
    return typeof v === "number" && v > 0 ? v : DEFAULT_MEMBER_PRICES[plan][type];
  } catch {
    return DEFAULT_MEMBER_PRICES[plan][type];
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
  const plan = p.plan?.trim().toUpperCase() || "BLACK";
  if (!(MEMBER_PLANS as readonly string[]).includes(plan)) throw new DomainError("PLAN_INVALIDO", "El plan debe ser Black o Gold.");
  const price = p.price ?? (await defaultMemberPrice(db, p.serviceType as MemberType, plan as MemberPlan));
  checkMoney(price, "precio");
  return db.$transaction(async (tx) => {
    const m = await tx.member.create({
      data: { name, plan, serviceType: p.serviceType, userId: p.userId, phone: p.phone?.trim() || null, startDate, note: p.note?.trim() || null },
    });
    await tx.memberPrice.create({ data: { memberId: m.id, validFrom: startDate, price } });
    await audit(tx, { userId: p.actor.id, entity: "Member", entityId: m.id, action: "CREATE", after: { name, plan, serviceType: p.serviceType, price, userId: p.userId } });
    return m;
  });
}

export async function updateMember(
  db: PrismaClient,
  p: { actor: Actor; id: string; name?: string; userId?: string | null; serviceType?: string; plan?: string; phone?: string; note?: string; active?: boolean },
) {
  requireAdmin(p.actor);
  const cur = await db.member.findUnique({ where: { id: p.id } });
  if (!cur || cur.deletedAt) throw new DomainError("SOCIO_INEXISTENTE", "Ese socio no existe.");
  if (p.name !== undefined && !p.name.trim()) throw new DomainError("NOMBRE_OBLIGATORIO", "Ingresá el nombre del socio.");
  if (p.serviceType !== undefined && !(MEMBER_TYPES as readonly string[]).includes(p.serviceType)) throw new DomainError("TIPO_INVALIDO", "El tipo debe ser corte o corte y barba.");
  if (p.plan !== undefined && !(MEMBER_PLANS as readonly string[]).includes(p.plan)) throw new DomainError("PLAN_INVALIDO", "El plan debe ser Black o Gold.");
  const row = await db.member.update({
    where: { id: p.id },
    data: {
      ...(p.name !== undefined ? { name: p.name.trim() } : {}),
      ...(p.plan !== undefined ? { plan: p.plan } : {}),
      ...(p.userId !== undefined ? { userId: p.userId } : {}),
      ...(p.serviceType !== undefined ? { serviceType: p.serviceType } : {}),
      ...(p.phone !== undefined ? { phone: p.phone.trim() || null } : {}),
      ...(p.note !== undefined ? { note: p.note.trim() || null } : {}),
      ...(p.active !== undefined ? { active: p.active } : {}),
    },
  });
  await audit(db, { userId: p.actor.id, entity: "Member", entityId: p.id, action: "UPDATE", before: { name: cur.name, plan: cur.plan, userId: cur.userId, serviceType: cur.serviceType, active: cur.active }, after: { name: row.name, plan: row.plan, userId: row.userId, serviceType: row.serviceType, active: row.active } });
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

/**
 * Sesiones del mes de un socio cargadas a mano (la columna SESIONES de la planilla). Con `null` se borra y vuelve a contar las
 * asistencias tildadas. Se cobra sesiones × precio vigente.
 */
export async function setMemberSessions(db: PrismaClient, p: { actor: Actor; memberId: string; month: string; sessions: number | null }) {
  requireAdmin(p.actor);
  if (!MONTH_RE.test(p.month)) throw new DomainError("MES_INVALIDO", "El mes es inválido.");
  if (p.sessions !== null && (!Number.isInteger(p.sessions) || p.sessions < 0 || p.sessions > 31)) throw new DomainError("SESIONES_INVALIDAS", "Las sesiones deben ser un número entre 0 y 31.");
  const member = await db.member.findUnique({ where: { id: p.memberId } });
  if (!member || member.deletedAt) throw new DomainError("SOCIO_INEXISTENTE", "Ese socio no existe.");
  const cur = await db.memberMonth.findUnique({ where: { memberId_month: { memberId: p.memberId, month: p.month } } });
  if (p.sessions === null) {
    if (cur) await db.memberMonth.delete({ where: { id: cur.id } });
  } else {
    await db.memberMonth.upsert({
      where: { memberId_month: { memberId: p.memberId, month: p.month } },
      update: { sessions: p.sessions },
      create: { memberId: p.memberId, month: p.month, sessions: p.sessions },
    });
  }
  if ((cur?.sessions ?? null) !== p.sessions) {
    await audit(db, { userId: p.actor.id, entity: "MemberMonth", entityId: `${p.memberId}:${p.month}`, action: cur ? (p.sessions === null ? "DELETE" : "UPDATE") : "CREATE", before: cur ? { sessions: cur.sessions } : undefined, after: { member: member.name, month: p.month, sessions: p.sessions } });
  }
}

// --- Cuenta corriente: cobros y ajustes ----------------------------------------------------------------------------------------------

/**
 * Cobro de un socio. `period` es el mes de servicio que cubre (la columna "MES QUE CORRESPONDE" de la planilla): si no se indica,
 * se imputa al mes más viejo que todavía tiene deuda y, si no debe nada, al mes del cobro (pago adelantado).
 */
export async function registerPayment(db: PrismaClient, p: { actor: Actor; memberId: string; date: string; amount: number; method: string; period?: string; note?: string; now?: Date }) {
  requireAdmin(p.actor);
  checkDate(p.date, p.now ?? new Date());
  checkMoney(p.amount);
  if (!(PAY_METHODS as readonly string[]).includes(p.method)) throw new DomainError("MEDIO_DE_PAGO_INVALIDO", "Elegí efectivo o banco/Mercado Pago.");
  if (p.period !== undefined && !MONTH_RE.test(p.period)) throw new DomainError("MES_INVALIDO", "El mes al que corresponde el cobro es inválido.");
  if (!(await db.member.findUnique({ where: { id: p.memberId } }))) throw new DomainError("SOCIO_INEXISTENTE", "Ese socio no existe.");
  const period = p.period ?? oldestUnpaidMonth(await getMemberStatement(db, p.memberId)) ?? p.date.slice(0, 7);
  const row = await db.memberLedger.create({
    data: { memberId: p.memberId, date: p.date, period, kind: "PAGO", credit: p.amount, method: p.method, note: p.note?.trim() || null },
  });
  await audit(db, { userId: p.actor.id, entity: "MemberLedger", entityId: row.id, action: "CREATE", after: { memberId: p.memberId, kind: "PAGO", amount: p.amount, method: p.method, period } });
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
  /** Precio por sesión vigente en el mes. */
  price: number;
  /** Fechas del mes en que vino (asistencia tildada). */
  attended: string[];
  /** Sesiones del mes: las cargadas a mano o, si no hay, las asistencias tildadas. */
  visits: number;
  /** Las sesiones del mes están cargadas a mano (no salen de la asistencia). */
  manual: boolean;
  /** Total del mes: sesiones × precio (sin ajustes). */
  charged: number;
  /** Cobrado para este mes de servicio (sin importar cuándo se cobró). */
  paid: number;
  /** Cobrado menos lo debido del mes (columna DIFERENCIA de la planilla). */
  diff: number;
  status: MonthStatus;
  /** Fecha del último cobro imputado a este mes. */
  lastPayDate: string | null;
  /** Saldo total a hoy (todos los meses): positivo = debe. */
  balance: number;
  /** Lo que se debía al cierre del mes anterior y sigue sin pagarse. */
  carried: number;
  /** Primer mes que dejó deuda sin cubrir. */
  oldestUnpaid: string | null;
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

/** Precio por sesión vigente a `date`. Si la fecha es anterior al primer precio cargado, se usa ese primero (nunca queda en 0 en silencio). */
function priceFor(prices: { validFrom: string; price: number }[], date: string): number {
  const eff = pickEffective(prices, date);
  if (eff) return eff.price;
  const first = [...prices].sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1))[0];
  return first?.price ?? 0;
}

interface MemberData {
  id: string;
  userId: string | null;
  prices: { validFrom: string; price: number }[];
  attendance: { date: string; userId: string | null }[];
  overrides: Map<string, number>;
  ledger: { kind: string; period: string; date: string; debit: number; credit: number }[];
}

/** Una línea a liquidar: `qty` sesiones a `price`, atendidas por `who` en `date` (para elegir la regla vigente del barbero). */
interface Line { who: string; date: string; price: number; qty: number }

/** Líneas de un mes: cada asistencia tildada o, si las sesiones están cargadas a mano, todas juntas con el barbero asignado. */
function linesFor(m: MemberData, month: string): Line[] {
  const manual = m.overrides.get(month);
  if (manual !== undefined) return manual > 0 ? [{ who: m.userId ?? "", date: `${month}-28`, price: priceFor(m.prices, `${month}-01`), qty: manual }] : [];
  return m.attendance.filter((a) => a.date.startsWith(month)).map((a) => ({ who: a.userId ?? m.userId ?? "", date: a.date, price: priceFor(m.prices, a.date), qty: 1 }));
}

/** Cuenta corriente de un socio mes a mes: sesiones, cargos, ajustes y cobros (por mes de servicio). */
function entriesOf(m: MemberData): MonthEntry[] {
  const months = new Set<string>([...m.overrides.keys(), ...m.attendance.map((a) => a.date.slice(0, 7)), ...m.ledger.map((l) => l.period)]);
  return [...months].map((month) => {
    const lines = linesFor(m, month);
    return {
      month,
      sessions: lines.reduce((s, l) => s + l.qty, 0),
      charge: lines.reduce((s, l) => s + l.price * l.qty, 0),
      adjust: m.ledger.filter((l) => l.kind === "AJUSTE" && l.period === month).reduce((s, l) => s + l.debit - l.credit, 0),
      paid: m.ledger.filter((l) => l.kind === "PAGO" && l.period === month).reduce((s, l) => s + l.credit, 0),
    };
  });
}

function rulesByUser(rows: { userId: string; validFrom: string; commissionBp: number; drinkDeduction: number; drinkCost: number }[]) {
  const by = new Map<string, BarberRule[]>();
  for (const r of rows) by.set(r.userId, [...(by.get(r.userId) ?? []), { validFrom: r.validFrom, commissionBp: r.commissionBp, drinkDeduction: r.drinkDeduction, drinkCost: r.drinkCost }]);
  return by;
}

async function loadMembers(db: Db, where: { id?: string } = {}) {
  const [members, attendance, months, ledger] = await Promise.all([
    db.member.findMany({ where: { deletedAt: null, ...where }, include: { prices: true }, orderBy: [{ name: "asc" }] }),
    db.attendance.findMany({ where: { deletedAt: null, ...(where.id ? { memberId: where.id } : {}) } }),
    db.memberMonth.findMany({ where: where.id ? { memberId: where.id } : {} }),
    db.memberLedger.findMany({ where: { deletedAt: null, ...(where.id ? { memberId: where.id } : {}) } }),
  ]);
  const data = new Map<string, MemberData>();
  for (const m of members) {
    data.set(m.id, {
      id: m.id,
      userId: m.userId,
      prices: m.prices,
      attendance: attendance.filter((a) => a.memberId === m.id),
      overrides: new Map(months.filter((x) => x.memberId === m.id).map((x) => [x.month, x.sessions])),
      ledger: ledger.filter((l) => l.memberId === m.id),
    });
  }
  return { members, data };
}

/** Cuenta corriente de un socio: una fila por mes con sesiones, total, cobrado, diferencia, estado y saldo acumulado. */
export async function getMemberStatement(db: Db, memberId: string): Promise<StatementRow[]> {
  const { data } = await loadMembers(db, { id: memberId });
  const m = data.get(memberId);
  return m ? buildStatement(entriesOf(m)) : [];
}

export async function getMembersMonth(db: Db, month: string, now: Date = new Date()): Promise<MembersMonth> {
  const today = todayBA(now);
  const [{ members, data }, users, ruleRows] = await Promise.all([loadMembers(db), db.user.findMany({ where: { isBarber: true } }), db.barberRule.findMany({ where: { deletedAt: null } })]);
  const rulesBy = rulesByUser(ruleRows);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const rows: MemberRow[] = members.map((m) => {
    const d = data.get(m.id)!;
    const statement = buildStatement(entriesOf(d));
    const cur = statement.find((r) => r.month === month);
    const lines = linesFor(d, month);
    let barberShare = 0;
    let localShare = 0;
    for (const l of lines) {
      const rule = pickEffective(rulesBy.get(l.who) ?? [], l.date);
      if (!rule) {
        localShare += l.price * l.qty;
        continue;
      }
      const c = memberContribution(l.price, rule);
      barberShare += c.barber * l.qty;
      localShare += c.local * l.qty;
    }
    const lastVisit = d.attendance.reduce<string | null>((best, a) => (!best || a.date > best ? a.date : best), null);
    const payDates = d.ledger.filter((l) => l.kind === "PAGO" && l.period === month).map((l) => l.date).sort();
    return {
      id: m.id, name: m.name, plan: m.plan, serviceType: m.serviceType, userId: m.userId,
      barberName: (m.userId && nameOf.get(m.userId)) || "Sin asignar", active: m.active, phone: m.phone,
      price: priceFor(m.prices, month === today.slice(0, 7) ? today : `${month}-28`),
      attended: d.attendance.filter((a) => a.date.startsWith(month)).map((a) => a.date).sort(),
      visits: cur?.sessions ?? 0,
      manual: d.overrides.has(month),
      charged: cur?.charge ?? 0,
      paid: cur?.paid ?? 0,
      diff: cur ? cur.paid - cur.charge : 0,
      status: cur?.status ?? "SIN_MOVIMIENTO",
      lastPayDate: payDates.at(-1) ?? null,
      balance: statement.at(-1)?.balance ?? 0,
      carried: carriedInto(statement, month),
      oldestUnpaid: oldestUnpaidMonth(statement),
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

/** Líneas a liquidar de todos los socios en un mes, con la regla vigente de cada barbero. */
async function monthLines(db: Db, month: string) {
  const [{ data }, ruleRows] = await Promise.all([loadMembers(db), db.barberRule.findMany({ where: { deletedAt: null } })]);
  const rulesBy = rulesByUser(ruleRows);
  const out: (Line & { rule: BarberRule | undefined })[] = [];
  for (const m of data.values()) for (const l of linesFor(m, month)) out.push({ ...l, rule: pickEffective(rulesBy.get(l.who) ?? [], l.date) });
  return out;
}

/** Lo que le corresponde cobrar a un barbero en el mes por las sesiones de socios que atendió. */
export async function membershipLaborFor(db: Db, userId: string, period: string): Promise<number> {
  return (await monthLines(db, period)).filter((l) => l.who === userId && l.rule).reduce((t, l) => t + memberContribution(l.price, l.rule!).barber * l.qty, 0);
}

/** Totales del mes para el panel: ingreso devengado (sesiones × precio), mano de obra por barbero y costo de la bebida entregada. */
export async function membershipMonthTotals(db: Db, month: string) {
  let visits = 0;
  let income = 0;
  let drinkCost = 0;
  const laborByBarber: Record<string, number> = {};
  const visitsByBarber: Record<string, number> = {};
  for (const l of await monthLines(db, month)) {
    visits += l.qty;
    income += l.price * l.qty;
    visitsByBarber[l.who] = (visitsByBarber[l.who] ?? 0) + l.qty;
    if (l.rule) {
      laborByBarber[l.who] = (laborByBarber[l.who] ?? 0) + memberContribution(l.price, l.rule).barber * l.qty;
      drinkCost += l.rule.drinkCost * l.qty;
    }
  }
  const paid = (await db.memberLedger.findMany({ where: { deletedAt: null, kind: "PAGO", date: monthRange(month) } })).reduce((s, l) => s + l.credit, 0);
  return { visits, income, paid, drinkCost, laborByBarber, visitsByBarber };
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
