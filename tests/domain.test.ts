import { describe, expect, it } from "vitest";
import { formatARS, formatDate, todayBA } from "../src/domain/money";
import { pickEffective, priceFor } from "../src/domain/rules";
import { splitService } from "../src/domain/commission";
import { closeDifference, computeDay } from "../src/domain/cash";
import { summarizeMonth } from "../src/domain/monthly";
import type { BarberRule, TariffEntry } from "../src/domain/types";

const tariffs: TariffEntry[] = [
  { serviceType: "CORTE", validFrom: "2026-06-01", price: 17000 },
  { serviceType: "CORTE", validFrom: "2026-08-01", price: 20000 },
  { serviceType: "CORTE_BARBA", validFrom: "2026-08-01", price: 22000 },
  { serviceType: "BARBA_CEJAS", validFrom: "2026-08-01", price: 15000 },
];
const jere: BarberRule[] = [{ validFrom: "2026-09-01", commissionBp: 6000, drinkDeduction: 1500, drinkCost: 1500 }];
const beni: BarberRule[] = [{ validFrom: "2026-09-01", commissionBp: 6000, drinkDeduction: 3000, drinkCost: 3000 }];
const ale: BarberRule[] = [{ validFrom: "2026-09-01", commissionBp: 10000, drinkDeduction: 3000, drinkCost: 3000 }];

describe("formato", () => {
  it("formatea pesos y fechas", () => {
    expect(formatARS(12500)).toBe("$ 12.500");
    expect(formatARS(1234567)).toBe("$ 1.234.567");
    expect(formatARS(-6270)).toBe("-$ 6.270");
    expect(formatARS(0)).toBe("$ 0");
    expect(formatDate("2026-09-03")).toBe("03/09/2026");
  });
  it("usa la zona horaria de Buenos Aires", () => {
    expect(todayBA(new Date("2026-09-03T01:30:00Z"))).toBe("2026-09-02");
  });
});

describe("vigencias", () => {
  it("toma la tarifa vigente a la fecha", () => {
    expect(priceFor(tariffs, "CORTE", "2026-07-31")).toBe(17000);
    expect(priceFor(tariffs, "CORTE", "2026-08-01")).toBe(20000);
  });
  it("falla si no hay tarifa", () => {
    expect(() => priceFor(tariffs, "CORTE_BARBA", "2026-07-01")).toThrow();
  });
  it("pickEffective devuelve undefined antes de la primera vigencia", () => {
    expect(pickEffective([{ validFrom: "2026-09-01" }], "2026-08-31")).toBeUndefined();
  });
});

describe("comisión", () => {
  it("Ale cobra el 100% de la diferencia: 17.000 y 19.000", () => {
    const r = ale[0]!;
    expect(splitService(20000, r).labor).toBe(17000);
    expect(splitService(22000, r).labor).toBe(19000);
    expect(splitService(15000, r).labor).toBe(12000);
  });
  it("Jere: 60% de (precio − 1.500)", () => {
    const r = jere[0]!;
    expect(splitService(20000, r).labor).toBe(11100);
    expect(splitService(22000, r).labor).toBe(12300);
    expect(splitService(20000, r).local).toBe(7400);
  });
  it("Beni/Lucio: 60% de (precio − 3.000)", () => {
    const r = beni[0]!;
    expect(splitService(20000, r).labor).toBe(10200);
    expect(splitService(22000, r).labor).toBe(11400);
  });
  it("multiplica por cantidad y no deja la base negativa", () => {
    expect(splitService(20000, ale[0]!, 3).labor).toBe(51000);
    expect(splitService(1000, ale[0]!).labor).toBe(0);
  });
});

describe("caja del día", () => {
  const day = {
    date: "2026-09-10",
    tariffs,
    barbers: [
      { barberId: "jere", rules: jere, services: { CORTE: 2, CORTE_BARBA: 1 } },
      { barberId: "ale", rules: ale, services: { CORTE: 1 } },
      { barberId: "beni", rules: beni, services: { BARBA_CEJAS: 1 }, memberships: 2 },
    ],
    extraSales: 25000,
  };
  const r = computeDay(day);

  it("suma ingresos por servicios y ventas sueltas", () => {
    expect(r.servicesGross).toBe(40000 + 22000 + 20000 + 15000); // 97.000
    expect(r.expectedIncome).toBe(122000);
  });
  it("calcula la mano de obra de cada barbero", () => {
    const by = Object.fromEntries(r.barbers.map((b) => [b.barberId, b.labor]));
    expect(by).toEqual({ jere: 34500, ale: 17000, beni: 7200 });
    expect(r.labor).toBe(58700);
  });
  it("dinero que debe haber = ingresos − mano de obra", () => {
    expect(r.expectedNet).toBe(63300);
  });
  it("registra las membresías sin cobrarlas en caja", () => {
    expect(r.barbers.find((b) => b.barberId === "beni")!.memberships).toBe(2);
  });
  it("la diferencia de cierre ignora el cambio dejado", () => {
    expect(closeDifference(r.expectedIncome, 122000)).toBe(0);
    expect(closeDifference(r.expectedIncome, 119000)).toBe(-3000);
    expect(closeDifference(r.expectedIncome, 125000)).toBe(3000);
  });
});

describe("resumen mensual", () => {
  it("acumula días y mano de obra por barbero", () => {
    const mk = (date: string, jereCortes: number) =>
      computeDay({
        date,
        tariffs,
        barbers: [{ barberId: "jere", rules: jere, services: { CORTE: jereCortes } }],
      });
    const m = summarizeMonth([mk("2026-09-01", 1), mk("2026-09-02", 2)]);
    expect(m.days).toBe(2);
    expect(m.services).toBe(3);
    expect(m.income).toBe(60000);
    expect(m.laborByBarber.jere).toBe(11100 * 3);
    expect(m.free).toBe(60000 - 33300);
  });
});
