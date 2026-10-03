import type { PrismaClient } from "@prisma/client";
import { shiftMonth } from "../domain/money";
import { priceFor } from "../domain/rules";
import { SERVICE_TYPES, type ServiceType, type TariffEntry } from "../domain/types";
import { listExpenses, listExtraIncome } from "./expenses";
import { loadPricing } from "./figures";
import { getMonthGrid, type GridDayCol } from "./grid";
import { membershipMonthTotals } from "./members";

const WEEKDAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export interface BarberReport {
  id: string;
  name: string;
  services: number;
  memberships: number;
  /** Lo generado por sus servicios (precio de lista). */
  gross: number;
  laborServices: number;
  laborMemberships: number;
  labor: number;
  /** Lo que dejó al local en servicios y membresías. */
  forLocal: number;
  activeDays: number;
}

export interface MonthReport {
  month: string;
  quantities: Record<ServiceType, number> & { MEMBERSHIP: number };
  income: {
    byType: Record<ServiceType, number>;
    services: number;
    memberships: number;
    drinks: number;
    products: number;
    extra: { concept: string; amount: number }[];
    extraTotal: number;
    total: number;
  };
  labor: { byBarber: BarberReport[]; total: number };
  /** "Libre" = ingresos − mano de obra. */
  free: number;
  costs: { drinks: number; products: number; memberDrinks: number; total: number };
  /** Margen bruto = libre − costos. */
  grossMargin: number;
  expenses: { variable: number; structure: number; investment: number; total: number; replenishment: number };
  /** Resultado final = margen bruto − gastos variables, de estructura e inversiones ("NETO A DISTRIBUIR"). */
  result: number;
  /** Suma de la "ganancia del día" de la planilla (sin membresías, ingresos extra ni gastos). */
  dailyProfitTotal: number;
  activeDays: number;
  gaps: { date: string; difference: number; note: string | null }[];
  gapsTotal: number;
  bestDays: { date: string; income: number; services: number }[];
  worstDays: { date: string; income: number; services: number }[];
  membershipsPaid: number;
}

export interface WeekdayStat {
  weekday: number;
  label: string;
  days: number;
  avgIncome: number;
  avgServices: number;
}

const servicesIn = (d: GridDayCol) => Object.values(d.services).reduce((a, c) => a + SERVICE_TYPES.reduce((s, t) => s + (c[t] ?? 0), 0), 0);

export async function getMonthReport(db: PrismaClient, month: string, now: Date = new Date()): Promise<MonthReport> {
  const [grid, pricing, memberTotals, exp, extra] = await Promise.all([
    getMonthGrid(db, month, now),
    loadPricing(db),
    membershipMonthTotals(db, month),
    listExpenses(db, { month }),
    listExtraIncome(db, month),
  ]);
  const tariffs = pricing.tariffs as TariffEntry[];

  const quantities = { CORTE: 0, CORTE_BARBA: 0, BARBA_CEJAS: 0, MEMBERSHIP: memberTotals.visits };
  const byType = { CORTE: 0, CORTE_BARBA: 0, BARBA_CEJAS: 0 } as Record<ServiceType, number>;
  let drinks = 0;
  let products = 0;
  let costsDrinks = 0;
  let costsProducts = 0;
  let dailyProfitTotal = 0;
  let activeDays = 0;
  const bar = new Map<string, BarberReport>();
  const ensure = (id: string, name: string) => {
    let b = bar.get(id);
    if (!b) bar.set(id, (b = { id, name, services: 0, memberships: 0, gross: 0, laborServices: 0, laborMemberships: 0, labor: 0, forLocal: 0, activeDays: 0 }));
    return b;
  };
  const nameOf = new Map(grid.barbers.map((b) => [b.id, b.name]));

  for (const d of grid.days) {
    let dayServices = 0;
    for (const [uid, counts] of Object.entries(d.services)) {
      for (const t of SERVICE_TYPES) {
        const q = counts[t] ?? 0;
        if (!q) continue;
        quantities[t] += q;
        dayServices += q;
        try {
          byType[t] += q * priceFor(tariffs, t, d.date);
        } catch {
          /* día sin tarifa: ya figura como error en la grilla */
        }
      }
      void uid;
    }
    drinks += d.result.drinksRevenue;
    products += d.result.productsRevenue;
    costsDrinks += d.result.costs.drinksIncluded + d.result.costs.drinksLoose;
    costsProducts += d.result.costs.products;
    dailyProfitTotal += d.result.profit.total;
    if (d.result.income > 0 || dayServices > 0) activeDays++;
    for (const b of d.result.barbers) {
      const r = ensure(b.userId, nameOf.get(b.userId) ?? "—");
      r.services += b.services;
      r.gross += b.gross;
      r.laborServices += b.labor;
      r.forLocal += b.localCut;
      if (b.services > 0) r.activeDays++;
    }
  }
  for (const [uid, labor] of Object.entries(memberTotals.laborByBarber)) {
    if (!uid) continue;
    ensure(uid, nameOf.get(uid) ?? "—").laborMemberships = labor;
  }
  for (const [uid, visits] of Object.entries(memberTotals.visitsByBarber)) {
    if (!uid) continue;
    ensure(uid, nameOf.get(uid) ?? "—").memberships = visits;
  }
  for (const r of bar.values()) r.labor = r.laborServices + r.laborMemberships;

  const servicesIncome = SERVICE_TYPES.reduce((a, t) => a + byType[t], 0);
  const extraTotal = extra.reduce((a, e) => a + e.amount, 0);
  const extraByConcept = new Map<string, number>();
  for (const e of extra) extraByConcept.set(e.concept, (extraByConcept.get(e.concept) ?? 0) + e.amount);
  const incomeTotal = servicesIncome + memberTotals.income + drinks + products + extraTotal;

  const barbers = [...bar.values()].sort((a, b) => b.gross + b.laborMemberships - (a.gross + a.laborMemberships));
  const laborTotal = barbers.reduce((a, b) => a + b.labor, 0);
  const free = incomeTotal - laborTotal;
  const costsTotal = costsDrinks + costsProducts + memberTotals.drinkCost;
  const grossMargin = free - costsTotal;
  // La reposición (compra de mercadería) no es un gasto del resultado: el costo ya está en "costos" por lo consumido.
  const expenses = {
    variable: exp.summary.byCategory.VARIABLE,
    structure: exp.summary.byCategory.ESTRUCTURA,
    investment: exp.summary.byCategory.INVERSION,
    replenishment: exp.summary.byCategory.REPOSICION,
    total: exp.summary.byCategory.VARIABLE + exp.summary.byCategory.ESTRUCTURA + exp.summary.byCategory.INVERSION,
  };

  const gaps = grid.days.filter((d) => d.difference !== null && d.difference !== 0).map((d) => ({ date: d.date, difference: d.difference!, note: d.note }));
  const withIncome = grid.days.filter((d) => d.result.income > 0).map((d) => ({ date: d.date, income: d.result.income, services: servicesIn(d) }));
  const sorted = [...withIncome].sort((a, b) => b.income - a.income);

  return {
    month,
    quantities,
    income: {
      byType,
      services: servicesIncome,
      memberships: memberTotals.income,
      drinks,
      products,
      extra: [...extraByConcept].map(([concept, amount]) => ({ concept, amount })),
      extraTotal,
      total: incomeTotal,
    },
    labor: { byBarber: barbers, total: laborTotal },
    free,
    costs: { drinks: costsDrinks, products: costsProducts, memberDrinks: memberTotals.drinkCost, total: costsTotal },
    grossMargin,
    expenses,
    result: grossMargin - expenses.total,
    dailyProfitTotal,
    activeDays,
    gaps,
    gapsTotal: gaps.reduce((a, g) => a + g.difference, 0),
    bestDays: sorted.slice(0, 5),
    worstDays: sorted.length > 5 ? sorted.slice(-5).reverse() : [],
    membershipsPaid: memberTotals.paid,
  };
}

export interface PanelData {
  report: MonthReport;
  /** Últimos meses (el último es el elegido) para el comparativo. */
  series: { month: string; income: number; labor: number; grossMargin: number; result: number; gaps: number; activeDays: number }[];
  weekdays: WeekdayStat[];
}

/** Datos completos del panel: el mes, el comparativo de los últimos `months` meses y el promedio por día de la semana (últimos 3 meses). */
export async function getPanel(db: PrismaClient, month: string, opts: { months?: number; now?: Date } = {}): Promise<PanelData> {
  const now = opts.now ?? new Date();
  const n = opts.months ?? 6;
  const months = Array.from({ length: n }, (_, i) => shiftMonth(month, i - (n - 1)));
  const reports = await Promise.all(months.map((m) => getMonthReport(db, m, now)));
  const report = reports[reports.length - 1]!;
  const series = reports.map((r) => ({ month: r.month, income: r.income.total, labor: r.labor.total, grossMargin: r.grossMargin, result: r.result, gaps: r.gaps.length, activeDays: r.activeDays }));

  // Promedio por día de la semana con los últimos 3 meses (solo días con ventas).
  const grids = await Promise.all(months.slice(-3).map((m) => getMonthGrid(db, m, now)));
  const acc = WEEKDAY_NAMES.map((label, weekday) => ({ weekday, label, days: 0, income: 0, services: 0 }));
  for (const g of grids) {
    for (const d of g.days) {
      if (d.result.income <= 0) continue;
      const w = new Date(`${d.date}T12:00:00Z`).getUTCDay();
      acc[w]!.days++;
      acc[w]!.income += d.result.income;
      acc[w]!.services += servicesIn(d);
    }
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  const weekdays = order.map((w) => ({ weekday: w, label: acc[w]!.label, days: acc[w]!.days, avgIncome: acc[w]!.days ? Math.round(acc[w]!.income / acc[w]!.days) : 0, avgServices: acc[w]!.days ? Math.round((acc[w]!.services / acc[w]!.days) * 10) / 10 : 0 }));
  return { report, series, weekdays };
}
