import { computeDay } from "./cash";
import type { BarberRule, ServiceCounts, TariffEntry } from "./types";

/** Producto con su precio y costo vigentes ese día. `kind` BEBIDA = bebida suelta; el resto (CERA, POLVO, ACEITE) son productos. */
export interface CatalogItem {
  id: string;
  name: string;
  kind: string;
  price: number;
  cost: number;
}

export interface GridDayInput {
  date: string;
  tariffs: TariffEntry[];
  /** Solo los barberos con actividad ese día. */
  barbers: { userId: string; rules: BarberRule[]; services: ServiceCounts; memberships: number }[];
  /** Cantidad vendida por producto (id → cantidad). */
  products: Record<string, number>;
  catalog: Record<string, CatalogItem>;
}

export interface GridBarberResult {
  userId: string;
  services: number;
  memberships: number;
  /** Lo generado por sus servicios (precio de lista). */
  gross: number;
  /** Bebida incluida que se descuenta antes de la comisión. */
  drink: number;
  /** Lo que cobra el barbero. */
  labor: number;
  /** Lo que queda para el local de los servicios: (bruto − bebida) − mano de obra. */
  localCut: number;
}

export interface GridDayResult {
  date: string;
  barbers: GridBarberResult[];
  servicesGross: number;
  drinksRevenue: number;
  productsRevenue: number;
  /** Servicios + bebidas sueltas + ceras/polvo/aceite. */
  income: number;
  labor: number;
  /** "Dinero total que debe haber" = ingresos − mano de obra. */
  expectedNet: number;
  costs: { drinksIncluded: number; drinksLoose: number; products: number; total: number };
  /**
   * Ganancia del día para el local (como "GANANCIA DEL DIA" de la planilla):
   * parte del local en los servicios + margen de la bebida incluida + margen de bebidas sueltas + margen de ceras/polvo/aceite.
   * Las membresías se liquidan aparte (no entran acá).
   */
  profit: { servicesCut: number; drinksIncludedMargin: number; drinksLooseMargin: number; productsMargin: number; total: number };
}

export function computeGridDay(input: GridDayInput): GridDayResult {
  const day = computeDay({
    date: input.date,
    tariffs: input.tariffs,
    barbers: input.barbers.map((b) => ({ barberId: b.userId, rules: b.rules, services: b.services, memberships: b.memberships })),
  });

  const barbers: GridBarberResult[] = day.barbers.map((b) => ({
    userId: b.barberId,
    services: b.services,
    memberships: b.memberships,
    gross: b.gross,
    drink: b.drinkDeduction,
    labor: b.labor,
    localCut: b.local,
  }));

  let drinksRevenue = 0;
  let drinksCost = 0;
  let productsRevenue = 0;
  let productsCost = 0;
  for (const [id, qty] of Object.entries(input.products)) {
    const item = input.catalog[id];
    if (!item || qty <= 0) continue;
    if (item.kind === "BEBIDA") {
      drinksRevenue += qty * item.price;
      drinksCost += qty * item.cost;
    } else {
      productsRevenue += qty * item.price;
      productsCost += qty * item.cost;
    }
  }

  const drinksIncludedRevenue = day.barbers.reduce((a, b) => a + b.drinkDeduction, 0);
  const drinksIncludedCost = day.barbers.reduce((a, b) => a + b.drinkCost, 0);
  const servicesCut = barbers.reduce((a, b) => a + b.localCut, 0);
  const income = day.servicesGross + drinksRevenue + productsRevenue;
  const labor = day.labor;

  const profit = {
    servicesCut,
    drinksIncludedMargin: drinksIncludedRevenue - drinksIncludedCost,
    drinksLooseMargin: drinksRevenue - drinksCost,
    productsMargin: productsRevenue - productsCost,
    total: 0,
  };
  profit.total = profit.servicesCut + profit.drinksIncludedMargin + profit.drinksLooseMargin + profit.productsMargin;

  return {
    date: input.date,
    barbers,
    servicesGross: day.servicesGross,
    drinksRevenue,
    productsRevenue,
    income,
    labor,
    expectedNet: income - labor,
    costs: { drinksIncluded: drinksIncludedCost, drinksLoose: drinksCost, products: productsCost, total: drinksIncludedCost + drinksCost + productsCost },
    profit,
  };
}

/** Un día sin ninguna actividad (todo en cero). */
export function emptyGridDay(date: string): GridDayResult {
  return {
    date,
    barbers: [],
    servicesGross: 0,
    drinksRevenue: 0,
    productsRevenue: 0,
    income: 0,
    labor: 0,
    expectedNet: 0,
    costs: { drinksIncluded: 0, drinksLoose: 0, products: 0, total: 0 },
    profit: { servicesCut: 0, drinksIncludedMargin: 0, drinksLooseMargin: 0, productsMargin: 0, total: 0 },
  };
}
