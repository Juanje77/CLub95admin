import { describe, expect, it } from "vitest";
import { computeGridDay, emptyGridDay, type CatalogItem } from "../src/domain/grid";
import type { BarberRule, TariffEntry } from "../src/domain/types";

const tariffs: TariffEntry[] = [
  { serviceType: "CORTE", validFrom: "2026-09-01", price: 20000 },
  { serviceType: "CORTE_BARBA", validFrom: "2026-09-01", price: 22000 },
  { serviceType: "BARBA_CEJAS", validFrom: "2026-09-01", price: 15000 },
];
const rule = (bp: number, drink: number): BarberRule[] => [{ validFrom: "2026-09-01", commissionBp: bp, drinkDeduction: drink, drinkCost: drink }];
const catalog: Record<string, CatalogItem> = {
  coca: { id: "coca", name: "Coca-Cola", kind: "BEBIDA", price: 1700, cost: 1183 },
  cera: { id: "cera", name: "Cera 1", kind: "CERA", price: 25000, cost: 13000 },
};

const day = computeGridDay({
  date: "2026-09-10",
  tariffs,
  barbers: [
    { userId: "jere", rules: rule(6000, 1500), services: { CORTE: 2 }, memberships: 0 },
    { userId: "ale", rules: rule(10000, 3000), services: { CORTE: 1 }, memberships: 0 },
    { userId: "lucio", rules: rule(6000, 3000), services: { CORTE_BARBA: 1 }, memberships: 2 },
  ],
  products: { coca: 1, cera: 1 },
  catalog,
});

describe("grilla del día (como la hoja mensual de la planilla)", () => {
  it("ingresos: servicios + bebidas sueltas + ceras", () => {
    expect(day.servicesGross).toBe(82000);
    expect(day.drinksRevenue).toBe(1700);
    expect(day.productsRevenue).toBe(25000);
    expect(day.income).toBe(108700);
  });

  it("mano de obra por barbero y dinero que debe haber", () => {
    const labor = Object.fromEntries(day.barbers.map((b) => [b.userId, b.labor]));
    expect(labor).toEqual({ jere: 22200, ale: 17000, lucio: 11400 });
    expect(day.labor).toBe(50600);
    expect(day.expectedNet).toBe(108700 - 50600);
  });

  it("lo que queda para el local en los servicios (Ale se lleva todo)", () => {
    const cut = Object.fromEntries(day.barbers.map((b) => [b.userId, b.localCut]));
    expect(cut).toEqual({ jere: 14800, ale: 0, lucio: 7600 });
  });

  it("costos de bebida incluida, bebida suelta y productos", () => {
    expect(day.costs).toEqual({ drinksIncluded: 9000, drinksLoose: 1183, products: 13000, total: 23183 });
  });

  it("ganancia del día = parte del local + márgenes de bebida y cera", () => {
    expect(day.profit).toEqual({ servicesCut: 22400, drinksIncludedMargin: 0, drinksLooseMargin: 517, productsMargin: 12000, total: 34917 });
  });

  it("las membresías se cuentan pero no suman ingresos ni ganancia del día", () => {
    expect(day.barbers.find((b) => b.userId === "lucio")!.memberships).toBe(2);
  });

  it("ignora productos desconocidos o con cantidad 0", () => {
    const d = computeGridDay({ date: "2026-09-10", tariffs, barbers: [], products: { nada: 3, coca: 0 }, catalog });
    expect(d.income).toBe(0);
  });

  it("un día vacío da todo en cero", () => {
    expect(emptyGridDay("2026-09-11").profit.total).toBe(0);
    expect(computeGridDay({ date: "2026-09-11", tariffs, barbers: [], products: {}, catalog }).expectedNet).toBe(0);
  });
});
