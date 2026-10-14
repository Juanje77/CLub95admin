import { priceFor, ruleFor } from "./rules";
import { splitService } from "./commission";
import { SERVICE_TYPES, type BarberRule, type ServiceCounts, type TariffEntry } from "./types";

export interface BarberDayInput {
  barberId: string;
  rules: BarberRule[];
  services: ServiceCounts;
  /** Asistencias de socios (membresía): no cobran en caja, el barbero se compensa aparte. */
  memberships?: number;
}

export interface DayInput {
  date: string;
  tariffs: TariffEntry[];
  barbers: BarberDayInput[];
  /** Ventas sueltas (bebidas sin corte, ceras, polvo, aceite) en pesos, ya valorizadas. */
  extraSales?: number;
}

export interface BarberDayResult {
  barberId: string;
  services: number;
  gross: number;
  drinkDeduction: number;
  drinkCost: number;
  labor: number;
  local: number;
  memberships: number;
}

export interface DayResult {
  date: string;
  barbers: BarberDayResult[];
  servicesGross: number;
  extraSales: number;
  /** Total que tuvo que entrar a caja. */
  expectedIncome: number;
  labor: number;
  /** "Dinero total que debe haber" = ingresos − mano de obra. */
  expectedNet: number;
}

export function computeDay(input: DayInput): DayResult {
  const barbers: BarberDayResult[] = input.barbers.map((b) => {
    const rule = ruleFor(b.rules, input.date);
    let services = 0;
    let gross = 0;
    let labor = 0;
    let local = 0;
    for (const t of SERVICE_TYPES) {
      const q = b.services[t] ?? 0;
      if (!q) continue;
      const s = splitService(priceFor(input.tariffs, t, input.date), rule, q);
      services += q;
      gross += s.gross;
      labor += s.labor;
      local += s.local;
    }
    return {
      barberId: b.barberId,
      services,
      gross,
      drinkDeduction: rule.drinkDeduction * services,
      drinkCost: rule.drinkCost * services,
      labor,
      local,
      memberships: b.memberships ?? 0,
    };
  });
  const servicesGross = barbers.reduce((a, b) => a + b.gross, 0);
  const extraSales = input.extraSales ?? 0;
  const labor = barbers.reduce((a, b) => a + b.labor, 0);
  const expectedIncome = servicesGross + extraSales;
  return {
    date: input.date,
    barbers,
    servicesGross,
    extraSales,
    expectedIncome,
    labor,
    expectedNet: expectedIncome - labor,
  };
}

/**
 * Diferencia de cierre = cobros declarados − ingresos esperados.
 * El cambio dejado no es ingreso: se informa aparte y no entra en la diferencia.
 * Negativo = falta plata; positivo = sobra.
 */
export function closeDifference(expectedIncome: number, declaredPayments: number): number {
  return declaredPayments - expectedIncome;
}
