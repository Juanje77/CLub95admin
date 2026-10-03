import { computeDay } from "../domain/cash";
import type { BarberRule, ServiceCounts, ServiceType, TariffEntry } from "../domain/types";
import { SERVICE_TYPES } from "../domain/types";
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
