import { computeDay } from "../domain/cash";
import type { BarberRule, ServiceCounts, ServiceType, TariffEntry } from "../domain/types";
import { SERVICE_TYPES } from "../domain/types";
import { coverage, type BarberCoverage } from "../domain/coverage";
import type { Db } from "./common";

export interface DayFigures {
  date: string;
  salesCount: number;
  /** Ventas con importe y sin medio de pago. */
  unpaidSales: number;
  expectedIncome: number;
  /** null si hay ventas sin medio de pago (no se puede separar efectivo de transferencias). */
  expectedCash: number | null;
  expectedTransfers: number | null;
  labor: number;
  expectedNet: number;
}

export async function loadPricing(db: Db): Promise<{ tariffs: TariffEntry[]; rules: Map<string, BarberRule[]> }> {
  const tariffs = (await db.tariff.findMany({ where: { deletedAt: null } })).map((t) => ({ serviceType: t.serviceType as ServiceType, validFrom: t.validFrom, price: t.price }));
  const rules = new Map<string, BarberRule[]>();
  for (const r of await db.barberRule.findMany({ where: { deletedAt: null } })) {
    const list = rules.get(r.userId) ?? [];
    list.push({ validFrom: r.validFrom, commissionBp: r.commissionBp, drinkDeduction: r.drinkDeduction, drinkCost: r.drinkCost });
    rules.set(r.userId, list);
  }
  return { tariffs, rules };
}

/** Ingresos esperados, mano de obra y reparto por medio de pago de un día, a partir de las ventas cargadas. */
export async function getDayFigures(db: Db, date: string): Promise<DayFigures> {
  const sales = await db.sale.findMany({ where: { date, deletedAt: null } });
  const { tariffs, rules } = await loadPricing(db);

  let expectedIncome = 0;
  let cash = 0;
  let transfers = 0;
  let unpaid = 0;
  const byBarber = new Map<string, ServiceCounts>();
  for (const s of sales) {
    const amount = s.quantity * s.unitPrice;
    if (s.kind === "SERVICE" && s.userId && s.serviceType) {
      const c = byBarber.get(s.userId) ?? {};
      c[s.serviceType as ServiceType] = (c[s.serviceType as ServiceType] ?? 0) + s.quantity;
      byBarber.set(s.userId, c);
    }
    if (s.kind === "MEMBERSHIP" || amount === 0) continue;
    expectedIncome += amount;
    if (s.paymentMethod === "EFECTIVO") cash += amount;
    else if (s.paymentMethod === "TRANSFERENCIA" || s.paymentMethod === "MP") transfers += amount;
    else unpaid++;
  }

  let labor = 0;
  if (byBarber.size > 0) {
    const day = computeDay({
      date,
      tariffs,
      barbers: [...byBarber].map(([barberId, services]) => ({ barberId, services, rules: rules.get(barberId) ?? [] })),
    });
    labor = day.labor;
  }
  void SERVICE_TYPES;
  return {
    date,
    salesCount: sales.length,
    unpaidSales: unpaid,
    expectedIncome,
    expectedCash: unpaid > 0 ? null : cash,
    expectedTransfers: unpaid > 0 ? null : transfers,
    labor,
    expectedNet: expectedIncome - labor,
  };
}

export interface BarberDayCoverage extends BarberCoverage {
  name: string;
}

/** Por barbero: lo que tiene que cobrar el día, lo que recaudó el banco en sus ventas y el efectivo retirado. */
export async function getDayCoverage(db: Db, date: string): Promise<BarberDayCoverage[]> {
  const sales = await db.sale.findMany({ where: { date, deletedAt: null, kind: "SERVICE", userId: { not: null } } });
  const withdrawals = await db.cashBoxEntry.findMany({ where: { date, kind: "RETIRO_BARBERO", deletedAt: null, userId: { not: null } } });
  const { tariffs, rules } = await loadPricing(db);

  const ids = new Set<string>([...sales.map((s) => s.userId!), ...withdrawals.map((w) => w.userId!)]);
  const out: BarberDayCoverage[] = [];
  for (const id of ids) {
    const mine = sales.filter((s) => s.userId === id);
    const services: ServiceCounts = {};
    let transfers = 0;
    for (const s of mine) {
      services[s.serviceType as ServiceType] = (services[s.serviceType as ServiceType] ?? 0) + s.quantity;
      if (s.paymentMethod === "TRANSFERENCIA" || s.paymentMethod === "MP") transfers += s.quantity * s.unitPrice;
    }
    const labor = mine.length ? computeDay({ date, tariffs, barbers: [{ barberId: id, rules: rules.get(id) ?? [], services }] }).labor : 0;
    const cashWithdrawn = withdrawals.filter((w) => w.userId === id).reduce((a, w) => a - w.amount, 0);
    const user = await db.user.findUnique({ where: { id } });
    out.push({ ...coverage({ barberId: id, labor, transfers, cashWithdrawn }), name: user?.name ?? id });
  }
  return out;
}
