import { describe, expect, it } from "vitest";
import { validateClose } from "../src/domain/closing";
import { boxBalance, boxLedger, checkRendicion, daysBetween, lastRendicionDate, type BoxEntry } from "../src/domain/cashbox";
import { membershipLabor, settle } from "../src/domain/settlement";

const base = { expectedIncome: 100000, expectedCash: 20000, expectedTransfers: 80000, declaredCash: 20000, declaredTransfers: 80000, changeLeft: 8000 };

describe("cierre diario", () => {
  it("cierra sin nota cuando todo coincide", () => {
    const r = validateClose(base);
    expect(r.ok).toBe(true);
    expect(r.difference).toBe(0);
    expect(r.cashToBox).toBe(20000);
  });
  it("el cambio dejado no cuenta como ingreso", () => {
    expect(validateClose({ ...base, changeLeft: 50000 }).difference).toBe(0);
  });
  it("exige nota si falta plata", () => {
    const r = validateClose({ ...base, declaredTransfers: 70000 });
    expect(r.ok).toBe(false);
    expect(r.difference).toBe(-10000);
    expect(r.errors.map((e) => e.code)).toEqual(["NOTA_OBLIGATORIA"]);
    expect(validateClose({ ...base, declaredTransfers: 70000, note: "Cliente pagó la semana siguiente" }).ok).toBe(true);
  });
  it("exige nota aunque el total cierre si se mezclaron efectivo y transferencias", () => {
    const r = validateClose({ ...base, declaredCash: 25000, declaredTransfers: 75000 });
    expect(r.difference).toBe(0);
    expect(r.cashDifference).toBe(5000);
    expect(r.transfersDifference).toBe(-5000);
    expect(r.needsNote).toBe(true);
    expect(r.ok).toBe(false);
  });
  it("sin medio de pago conocido solo compara el total", () => {
    const r = validateClose({ ...base, expectedCash: null, expectedTransfers: null, declaredCash: 30000, declaredTransfers: 70000 });
    expect(r.cashDifference).toBeNull();
    expect(r.ok).toBe(true);
  });
  it("no deja cerrar con ventas sin medio de pago", () => {
    const r = validateClose({ ...base, unpaidSales: 2 });
    expect(r.errors.map((e) => e.code)).toContain("VENTAS_SIN_MEDIO_DE_PAGO");
  });
  it("rechaza montos negativos o con decimales", () => {
    expect(validateClose({ ...base, declaredCash: -1 }).errors[0]!.code).toBe("MONTO_INVALIDO");
    expect(validateClose({ ...base, changeLeft: 10.5 }).errors[0]!.code).toBe("MONTO_INVALIDO");
  });
});

describe("fila de efectivo acumulado", () => {
  const entries: BoxEntry[] = [
    { date: "2026-10-01", kind: "CIERRE", amount: 15000 },
    { date: "2026-10-02", kind: "CIERRE", amount: 32000 },
    { date: "2026-10-02", kind: "RETIRO_BARBERO", amount: -10000 },
    { date: "2026-10-03", kind: "CIERRE", amount: 8000 },
  ];
  it("acumula día a día", () => {
    const { rows, balance } = boxLedger(entries);
    expect(rows.map((r) => r.balance)).toEqual([15000, 47000, 37000, 45000]);
    expect(balance).toBe(45000);
  });
  it("la rendición del fin de semana deja la caja en cero", () => {
    const withRend: BoxEntry[] = [...entries, { date: "2026-10-04", kind: "RENDICION", amount: -45000, expectedAmount: 45000 }];
    expect(boxBalance(withRend)).toBe(0);
    expect(lastRendicionDate(withRend)).toBe("2026-10-04");
    expect(lastRendicionDate(entries)).toBeNull();
  });
  it("dentro del mismo día el cierre entra antes que la rendición", () => {
    const { rows } = boxLedger([
      { date: "2026-10-04", kind: "RENDICION", amount: -20000 },
      { date: "2026-10-04", kind: "CIERRE", amount: 20000 },
    ]);
    expect(rows.map((r) => r.balance)).toEqual([20000, 0]);
  });
  it("detecta diferencia al rendir", () => {
    expect(checkRendicion(45000, 45000).needsNote).toBe(false);
    const r = checkRendicion(45000, 40000);
    expect(r.difference).toBe(-5000);
    expect(r.needsNote).toBe(true);
  });
  it("cuenta días entre fechas", () => {
    expect(daysBetween("2026-09-28", "2026-10-03")).toBe(5);
    expect(daysBetween("2026-10-03", "2026-10-03")).toBe(0);
  });
});

describe("compensación de fin de mes", () => {
  const lucio = { validFrom: "2026-10-01", commissionBp: 6000, drinkDeduction: 3000, drinkCost: 3000 };
  it("la membresía se calcula como servicio: (precio − bebida) × comisión", () => {
    expect(membershipLabor(15000, lucio)).toBe(7200);
    expect(membershipLabor(16500, lucio)).toBe(8100);
  });
  it("si cobró de más, el balance es negativo y devuelve", () => {
    const r = settle({ laborServices: 500000, laborMembership: 72000, collected: 590000 });
    expect(r.entitled).toBe(572000);
    expect(r.balance).toBe(-18000);
    expect(r.direction).toBe("BARBERO_DEBE");
  });
  it("si cobró de menos, el local le debe", () => {
    const r = settle({ laborServices: 500000, laborMembership: 72000, adjustments: 5000, collected: 500000 });
    expect(r.balance).toBe(77000);
    expect(r.direction).toBe("LOCAL_DEBE");
  });
  it("saldado", () => {
    expect(settle({ laborServices: 100, laborMembership: 0, collected: 100 }).direction).toBe("SALDADO");
  });
});
