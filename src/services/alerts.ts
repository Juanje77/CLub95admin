import type { PrismaClient } from "@prisma/client";
import { computeCloseAlerts, DEFAULT_ALERT_SETTINGS, type AlertSettings, type CloseAlert, type DayState, type SettlementState } from "../domain/alerts";
import type { BoxKind } from "../domain/cashbox";
import { todayBA } from "../domain/money";
import { getDayCoverage } from "./figures";
import { recurringStatus } from "./expenses";

export async function loadAlertSettings(db: PrismaClient): Promise<AlertSettings> {
  const row = await db.setting.findUnique({ where: { key: "alerts" } });
  if (!row) return DEFAULT_ALERT_SETTINGS;
  try {
    return { ...DEFAULT_ALERT_SETTINGS, ...(JSON.parse(row.value) as Partial<AlertSettings>) };
  } catch {
    return DEFAULT_ALERT_SETTINGS;
  }
}

function shiftDate(date: string, deltaDays: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

function previousPeriods(today: string, n: number): string[] {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 2 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * Calcula las alertas de cierre con el estado actual de la base, las guarda (sin duplicar) y da de baja
 * las que ya no aplican. Pensado para correr periódicamente (p. ej. cada 15 minutos).
 */
export async function syncAlerts(db: PrismaClient, opts: { now?: Date; windowDays?: number } = {}): Promise<CloseAlert[]> {
  const now = opts.now ?? new Date();
  const today = todayBA(now);
  const from = shiftDate(today, -((opts.windowDays ?? 14) - 1));
  const settings = await loadAlertSettings(db);

  const sales = await db.sale.findMany({ where: { deletedAt: null, date: { gte: from, lte: today } } });
  const closes = await db.cashClose.findMany({ where: { deletedAt: null, date: { gte: from, lte: today } } });
  const closeByDate = new Map(closes.map((c) => [c.date, c]));
  const withdrawalDates = new Set((await db.cashBoxEntry.findMany({ where: { kind: "RETIRO_BARBERO", deletedAt: null, date: { gte: from, lte: today } } })).map((e) => e.date));
  const days: DayState[] = [];
  for (let d = from; d <= today; d = shiftDate(d, 1)) {
    const ds = sales.filter((s) => s.date === d);
    const c = closeByDate.get(d);
    const withdrawalExcess = withdrawalDates.has(d)
      ? (await getDayCoverage(db, d)).filter((x) => x.excess > 0).map((x) => ({ name: x.name, amount: x.excess, cashAllowed: x.cashAllowed, cashWithdrawn: x.cashWithdrawn }))
      : [];
    days.push({
      date: d,
      withdrawalExcess,
      salesCount: ds.length,
      unpaidSales: ds.filter((s) => s.source === "APP" && s.kind !== "MEMBERSHIP" && s.unitPrice > 0 && !s.paymentMethod).length,
      close: c
        ? {
            status: c.status as "OPEN" | "CLOSED",
            difference: c.difference,
            note: c.note,
            changeLeft: c.changeLeft,
            declaredCash: c.declaredCash,
            declaredTransfers: c.declaredTransfers,
            closedOn: c.closedAt ? todayBA(c.closedAt) : null,
            reopened: c.status === "OPEN" && c.reopenedAt !== null,
          }
        : null,
    });
  }
  const closedDays = (await db.closedDay.findMany({ where: { deletedAt: null, date: { gte: from, lte: today } } })).map((c) => c.date);
  const box = (await db.cashBoxEntry.findMany({ where: { deletedAt: null } })).map((e) => ({ id: e.id, date: e.date, kind: e.kind as BoxKind, amount: e.amount, expectedAmount: e.expectedAmount }));

  // Compensaciones: barberos con servicios en los últimos 2 meses cerrados.
  const settlements: SettlementState[] = [];
  for (const period of previousPeriods(today, 2)) {
    const range = { gte: `${period}-01`, lte: `${period}-31` };
    const barbers = await db.sale.groupBy({ by: ["userId"], where: { deletedAt: null, kind: { in: ["SERVICE", "MEMBERSHIP"] }, userId: { not: null }, date: range } });
    for (const b of barbers) {
      const user = await db.user.findUnique({ where: { id: b.userId! } });
      if (!user) continue;
      const s = await db.barberSettlement.findUnique({ where: { userId_period: { userId: user.id, period } } });
      settlements.push({ period, userId: user.id, name: user.name, status: s && !s.deletedAt ? (s.status as "DRAFT" | "CONFIRMED") : null });
    }
  }

  const lowStock = (await db.product.findMany({ where: { deletedAt: null, active: true, minStock: { gt: 0 } } })).filter((p) => p.stock <= p.minStock).map((p) => ({ name: p.name, stock: p.stock, minStock: p.minStock }));

  const month = today.slice(0, 7);
  const recurringDue = (await recurringStatus(db, month, now)).filter((r) => r.due).map((r) => ({ id: r.id, concept: r.concept, dayOfMonth: r.dayOfMonth, month }));

  const alerts = computeCloseAlerts({ now, days, closedDays, box, settlements, settings, lowStock, recurringDue });

  const keys = new Set(alerts.map((a) => a.key));
  for (const a of alerts) {
    await db.alert.upsert({
      where: { key: a.key },
      create: { key: a.key, code: a.code, severity: a.severity, audience: a.audience.join(","), date: a.date ?? null, message: a.message },
      update: { severity: a.severity, audience: a.audience.join(","), message: a.message, resolvedAt: null },
    });
  }
  const stale = await db.alert.findMany({ where: { resolvedAt: null, key: { notIn: [...keys] } } });
  for (const s of stale) await db.alert.update({ where: { id: s.id }, data: { resolvedAt: now } });
  return alerts;
}
