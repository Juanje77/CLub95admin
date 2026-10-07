import type { DayResult } from "./cash";

export interface MonthSummary {
  days: number;
  services: number;
  servicesGross: number;
  extraSales: number;
  income: number;
  laborByBarber: Record<string, number>;
  labor: number;
  /** "Libre" = ingresos − mano de obra. */
  free: number;
}

export function summarizeMonth(days: DayResult[]): MonthSummary {
  const laborByBarber: Record<string, number> = {};
  let services = 0;
  let servicesGross = 0;
  let extraSales = 0;
  let labor = 0;
  for (const d of days) {
    servicesGross += d.servicesGross;
    extraSales += d.extraSales;
    labor += d.labor;
    for (const b of d.barbers) {
      services += b.services;
      laborByBarber[b.barberId] = (laborByBarber[b.barberId] ?? 0) + b.labor;
    }
  }
  const income = servicesGross + extraSales;
  return { days: days.length, services, servicesGross, extraSales, income, laborByBarber, labor, free: income - labor };
}
