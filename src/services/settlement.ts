import type { PrismaClient } from "@prisma/client";
import { computeDay } from "../domain/cash";
import { settle } from "../domain/settlement";
import type { ServiceCounts, ServiceType } from "../domain/types";
import { audit, DomainError, isAdmin, type Actor } from "./common";
import { loadPricing } from "./figures";
import { membershipLaborFor } from "./members";

function monthRange(period: string) {
  return { gte: `${period}-01`, lte: `${period}-31` };
}

/**
 * Compensación de fin de mes de un barbero: lo que le corresponde (servicios + membresías + ajustes)
 * contra lo que ya cobró (retiros en efectivo + transferencias a su cuenta propia). Deja un borrador editable.
 * La parte de membresías se calcula sola desde la asistencia de socios (se puede pisar con `laborMembership`).
 */
export async function computeSettlement(db: PrismaClient, p: { userId: string; period: string; laborMembership?: number; adjustments?: number; note?: string }) {
  const existing = await db.barberSettlement.findUnique({ where: { userId_period: { userId: p.userId, period: p.period } } });
  if (existing?.status === "CONFIRMED" && !existing.deletedAt) throw new DomainError("YA_CONFIRMADA", "Esa compensación ya fue confirmada.");

  const { tariffs, rules } = await loadPricing(db);
  const sales = await db.sale.findMany({ where: { userId: p.userId, kind: "SERVICE", deletedAt: null, date: monthRange(p.period) } });
  const byDate = new Map<string, ServiceCounts>();
  for (const s of sales) {
    const c = byDate.get(s.date) ?? {};
    c[s.serviceType as ServiceType] = (c[s.serviceType as ServiceType] ?? 0) + s.quantity;
    byDate.set(s.date, c);
  }
  let laborServices = 0;
  for (const [date, services] of byDate) {
    laborServices += computeDay({ date, tariffs, barbers: [{ barberId: p.userId, rules: rules.get(p.userId) ?? [], services }] }).labor;
  }

  const withdrawals = await db.cashBoxEntry.findMany({ where: { userId: p.userId, kind: "RETIRO_BARBERO", deletedAt: null, date: monthRange(p.period) } });
  const cashTaken = withdrawals.reduce((a, e) => a - e.amount, 0);
  const ownAccounts = await db.paymentAccount.findMany({ where: { ownerUserId: p.userId, deletedAt: null } });
  let ownTransfers = 0;
  if (ownAccounts.length) {
    const lines = await db.cashCloseLine.findMany({
      where: { account: { in: ownAccounts.map((a) => a.key) }, close: { deletedAt: null, date: monthRange(p.period) } },
    });
    ownTransfers = lines.reduce((a, l) => a + l.amount, 0);
  }
  // Lo que le toca por los socios que atendió sale de la asistencia; se puede pisar a mano pasando `laborMembership`.
  const laborMembership = p.laborMembership ?? (await membershipLaborFor(db, p.userId, p.period));
  const adjustments = p.adjustments ?? existing?.adjustments ?? 0;
  const collected = cashTaken + ownTransfers;
  const result = settle({ laborServices, laborMembership, adjustments, collected });
  const data = { laborServices, laborMembership, adjustments, collected, balance: result.balance, status: "DRAFT", note: p.note ?? existing?.note ?? null, deletedAt: null };
  const row = existing
    ? await db.barberSettlement.update({ where: { id: existing.id }, data })
    : await db.barberSettlement.create({ data: { userId: p.userId, period: p.period, ...data } });
  return { settlement: row, result, detail: { cashTaken, ownTransfers } };
}

export async function confirmSettlement(db: PrismaClient, p: { userId: string; period: string; actor: Actor; now?: Date }) {
  if (!isAdmin(p.actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño confirman la compensación.");
  const s = await db.barberSettlement.findUnique({ where: { userId_period: { userId: p.userId, period: p.period } } });
  if (!s || s.deletedAt) throw new DomainError("NO_EXISTE", "Primero hay que calcular la compensación.");
  if (s.status === "CONFIRMED") return s;
  const row = await db.barberSettlement.update({ where: { id: s.id }, data: { status: "CONFIRMED", confirmedAt: p.now ?? new Date(), confirmedById: p.actor.id } });
  await audit(db, { userId: p.actor.id, entity: "BarberSettlement", entityId: s.id, action: "UPDATE", before: { status: s.status }, after: { status: "CONFIRMED", balance: s.balance } });
  return row;
}
