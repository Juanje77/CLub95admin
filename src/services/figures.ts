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
  let unknownSplit = false; // hay ventas cargadas por cantidad (sin medio de pago): no se puede separar efectivo de transferencias
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
    else {
      unknownSplit = true;
      // Solo las ventas cargadas una por una (APP) deben traer medio de pago; las de la grilla se declaran por cuenta al cerrar.
      if (s.source === "APP") unpaid++;
    }
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
    expectedCash: unknownSplit ? null : cash,
    expectedTransfers: unknownSplit ? null : transfers,
    labor,
    expectedNet: expectedIncome - labor,
  };
}

export interface BarberDayCoverage extends BarberCoverage {
  name: string;
}

/**
 * Por barbero: lo que tiene que cobrar el día y cuánto puede retirar en efectivo.
 * Los barberos cobran de lo recaudado en el banco: el faltante del día es (mano de obra total − transferencias declaradas)
 * y se reparte entre los barberos en proporción a lo que les corresponde. Mientras el día no tenga las transferencias
 * cargadas no se sabe qué cubrió el banco, así que no se marca ningún retiro como excepción.
 */
export async function getDayCoverage(db: Db, date: string): Promise<BarberDayCoverage[]> {
  const sales = await db.sale.findMany({ where: { date, deletedAt: null, kind: "SERVICE", userId: { not: null } } });
  const withdrawals = await db.cashBoxEntry.findMany({ where: { date, kind: "RETIRO_BARBERO", deletedAt: null, userId: { not: null } } });
  const close = await db.cashClose.findUnique({ where: { date } });
  const { tariffs, rules } = await loadPricing(db);

  const ids = new Set<string>([...sales.map((s) => s.userId!), ...withdrawals.map((w) => w.userId!)]);
  const laborBy = new Map<string, number>();
  for (const id of ids) {
    const mine = sales.filter((s) => s.userId === id);
    const services: ServiceCounts = {};
    for (const s of mine) services[s.serviceType as ServiceType] = (services[s.serviceType as ServiceType] ?? 0) + s.quantity;
    laborBy.set(id, mine.length ? computeDay({ date, tariffs, barbers: [{ barberId: id, rules: rules.get(id) ?? [], services }] }).labor : 0);
  }
  const totalLabor = [...laborBy.values()].reduce((a, b) => a + b, 0);
  const pool = close && !close.deletedAt && close.declaredTransfers + close.declaredCash > 0 ? close.declaredTransfers : null;
  const shortfall = pool === null ? null : Math.max(0, totalLabor - pool);

  const out: BarberDayCoverage[] = [];
  for (const id of ids) {
    const labor = laborBy.get(id) ?? 0;
    const allowed = shortfall === null ? labor : totalLabor > 0 ? Math.floor((shortfall * labor) / totalLabor) : 0;
    const cashWithdrawn = withdrawals.filter((w) => w.userId === id).reduce((a, w) => a - w.amount, 0);
    const user = await db.user.findUnique({ where: { id } });
    // `transfers` = la parte del banco atribuida al barbero (lo que su mano de obra no necesita de efectivo).
    out.push({ ...coverage({ barberId: id, labor, transfers: labor - allowed, cashWithdrawn }), name: user?.name ?? id });
  }
  return out;
}
