import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addWithdrawal, closeDay, getBoxBalance, markClosedDay, reopenDay, rendir } from "../src/services/closing";
import { getDayFigures } from "../src/services/figures";
import { computeSettlement, confirmSettlement } from "../src/services/settlement";
import { syncAlerts } from "../src/services/alerts";
import { DomainError, type Actor } from "../src/services/common";
import { freshDb, sale, seed, type Seed } from "./helpers/db";

// Sábado 3/10/2026, 20:45 en Buenos Aires.
const NOW = new Date("2026-10-03T23:45:00Z");
const DAY = "2026-10-03";

let db: PrismaClient;
let ids: Seed;
let barbero: Actor;
let admin: Actor;
let dueno: Actor;

async function sellDay(date = DAY) {
  await sale(db, { date, userId: ids.jere, serviceType: "CORTE", unitPrice: 20000, paymentMethod: "EFECTIVO" });
  await sale(db, { date, userId: ids.jere, serviceType: "CORTE", unitPrice: 20000, paymentMethod: "TRANSFERENCIA" });
  await sale(db, { date, userId: ids.lucio, serviceType: "CORTE_BARBA", unitPrice: 22000, paymentMethod: "TRANSFERENCIA" });
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return null;
};

beforeEach(async () => {
  db = freshDb();
  ids = await seed(db);
  barbero = { id: ids.lucio, role: "BARBERO" };
  admin = { id: ids.ale, role: "ADMIN" };
  dueno = { id: ids.juan, role: "DUENO" };
});
afterEach(async () => {
  await db.$disconnect();
});

describe("cifras del día", () => {
  it("calcula ingresos esperados por medio de pago y mano de obra", async () => {
    await sellDay();
    const f = await getDayFigures(db, DAY);
    expect(f).toMatchObject({ salesCount: 3, unpaidSales: 0, expectedIncome: 62000, expectedCash: 20000, expectedTransfers: 42000 });
    expect(f.labor).toBe(11100 * 2 + 11400); // Jere 2 cortes + Lucio corte y barba
    expect(f.expectedNet).toBe(62000 - 33600);
  });
  it("sin medio de pago no se puede separar efectivo de transferencias", async () => {
    await sale(db, { date: DAY, userId: ids.jere, serviceType: "CORTE", unitPrice: 20000, paymentMethod: null });
    const f = await getDayFigures(db, DAY);
    expect(f.unpaidSales).toBe(1);
    expect(f.expectedCash).toBeNull();
  });
});

describe("cierre diario", () => {
  const ok = { declaredCash: 20000, declaredTransfers: 42000, changeLeft: 8000 };

  it("el barbero cierra el día de hoy y el efectivo se suma a la fila acumulada", async () => {
    await sellDay();
    const r = await closeDay(db, { date: DAY, actor: barbero, ...ok, now: NOW });
    expect(r.close.status).toBe("CLOSED");
    expect(r.close.difference).toBe(0);
    expect(await getBoxBalance(db)).toBe(20000);
    expect(await db.auditLog.count({ where: { entity: "CashClose", action: "CLOSE" } })).toBe(1);
  });

  it("una vez cerrada no se puede cerrar de nuevo", async () => {
    await sellDay();
    await closeDay(db, { date: DAY, actor: barbero, ...ok, now: NOW });
    expect(await code(closeDay(db, { date: DAY, actor: admin, ...ok, now: NOW }))).toBe("YA_CERRADO");
  });

  it("con diferencia exige nota y, si falla, no deja nada guardado", async () => {
    await sellDay();
    expect(await code(closeDay(db, { date: DAY, actor: barbero, ...ok, declaredTransfers: 30000, now: NOW }))).toBe("NOTA_OBLIGATORIA");
    expect(await db.cashClose.count()).toBe(0);
    expect(await getBoxBalance(db)).toBe(0);
    const r = await closeDay(db, { date: DAY, actor: barbero, ...ok, declaredTransfers: 30000, note: "Un cliente pagó mañana", now: NOW });
    expect(r.close.difference).toBe(-12000);
  });

  it("no cierra con ventas sin medio de pago", async () => {
    await sale(db, { date: DAY, userId: ids.jere, serviceType: "CORTE", unitPrice: 20000, paymentMethod: null });
    expect(await code(closeDay(db, { date: DAY, actor: barbero, ...ok, now: NOW }))).toBe("VENTAS_SIN_MEDIO_DE_PAGO");
  });

  it("un barbero no puede cerrar un día pasado; el admin sí", async () => {
    await sellDay("2026-10-02");
    expect(await code(closeDay(db, { date: "2026-10-02", actor: barbero, ...ok, now: NOW }))).toBe("DIA_PASADO_REQUIERE_ADMIN");
    const r = await closeDay(db, { date: "2026-10-02", actor: admin, ...ok, now: NOW });
    expect(r.close.status).toBe("CLOSED");
  });

  it("no se cierra un día futuro", async () => {
    expect(await code(closeDay(db, { date: "2026-10-04", actor: admin, ...ok, now: NOW }))).toBe("FECHA_FUTURA");
  });

  it("reabrir: solo admin/dueño, con motivo; el efectivo sale de la caja hasta volver a cerrar", async () => {
    await sellDay();
    await closeDay(db, { date: DAY, actor: barbero, ...ok, now: NOW });
    expect(await code(reopenDay(db, { date: DAY, actor: barbero, reason: "me equivoqué", now: NOW }))).toBe("SOLO_ADMIN");
    expect(await code(reopenDay(db, { date: DAY, actor: admin, reason: "  ", now: NOW }))).toBe("MOTIVO_OBLIGATORIO");
    const r = await reopenDay(db, { date: DAY, actor: dueno, reason: "Se cargó mal el efectivo", now: NOW });
    expect(r.status).toBe("OPEN");
    expect(r.reopenReason).toBe("Se cargó mal el efectivo");
    expect(await getBoxBalance(db)).toBe(0);
    expect(await db.auditLog.count({ where: { action: "REOPEN" } })).toBe(1);
    await closeDay(db, { date: DAY, actor: admin, declaredCash: 25000, declaredTransfers: 37000, changeLeft: 8000, note: "Corregido: eran 25.000 en efectivo", now: NOW });
    expect(await getBoxBalance(db)).toBe(25000);
  });
});

describe("fila de efectivo acumulado", () => {
  it("acumula varios cierres, descuenta retiros y se rinde el fin de semana", async () => {
    for (const [d, cash] of [["2026-10-01", 15000], ["2026-10-02", 32000]] as const) {
      await sale(db, { date: d, userId: ids.jere, serviceType: "CORTE", quantity: 1, unitPrice: 20000, paymentMethod: "EFECTIVO" });
      await closeDay(db, { date: d, actor: admin, declaredCash: 20000, declaredTransfers: 0, changeLeft: 5000, note: cash === 15000 ? undefined : undefined, now: NOW });
    }
    expect(await getBoxBalance(db)).toBe(40000);
    // Jere cobró en efectivo ese día (labor $ 11.100, el banco no recaudó nada): puede completar con efectivo.
    const jereActor: Actor = { id: ids.jere, role: "BARBERO" };
    await addWithdrawal(db, { date: "2026-10-02", actor: jereActor, userId: ids.jere, amount: 10000 });
    expect(await getBoxBalance(db)).toBe(30000);
    expect(await code(addWithdrawal(db, { date: DAY, actor: barbero, userId: ids.jere, amount: 5000 }))).toBe("SOLO_PROPIO");

    expect(await code(rendir(db, { date: DAY, actor: barbero, handedOver: 30000, receivedBy: "Juan" }))).toBe("SOLO_ADMIN");
    expect(await code(rendir(db, { date: DAY, actor: dueno, handedOver: 25000, receivedBy: "Juan" }))).toBe("NOTA_OBLIGATORIA");
    const r = await rendir(db, { date: DAY, actor: dueno, handedOver: 30000, receivedBy: "Juan" });
    expect(r.balanceAfter).toBe(0);
    expect(r.entry.expectedAmount).toBe(30000);
    expect(await getBoxBalance(db)).toBe(0);
  });

  it("una rendición menor al saldo deja el resto en la caja y exige nota", async () => {
    await sale(db, { date: DAY, userId: ids.jere, serviceType: "CORTE", unitPrice: 20000, paymentMethod: "EFECTIVO" });
    await closeDay(db, { date: DAY, actor: admin, declaredCash: 20000, declaredTransfers: 0, changeLeft: 5000, now: NOW });
    const r = await rendir(db, { date: DAY, actor: dueno, handedOver: 15000, receivedBy: "Juan", note: "Faltan 5.000, los usó para limpieza" });
    expect(r.check.difference).toBe(-5000);
    expect(r.balanceAfter).toBe(5000);
  });
});

describe("compensación de fin de mes", () => {
  it("compara lo que le corresponde (servicios + membresías) con lo que ya cobró", async () => {
    // Lucio: 2 cortes y 1 corte y barba en octubre → (20000−3000)×0,6 = 10.200 por corte; 11.400 por corte y barba.
    await sale(db, { date: "2026-10-01", userId: ids.lucio, serviceType: "CORTE", quantity: 2, unitPrice: 20000, paymentMethod: "TRANSFERENCIA" });
    await sale(db, { date: "2026-10-02", userId: ids.lucio, serviceType: "CORTE_BARBA", unitPrice: 22000, paymentMethod: "TRANSFERENCIA" });
    await addWithdrawal(db, { date: "2026-10-02", actor: admin, userId: ids.lucio, amount: 50000, note: "cobró de más" });
    const r = await computeSettlement(db, { userId: ids.lucio, period: "2026-10", laborMembership: 14400 });
    expect(r.settlement.laborServices).toBe(10200 * 2 + 11400);
    expect(r.settlement.collected).toBe(50000);
    expect(r.result.balance).toBe(31800 + 14400 - 50000); // −3.800: cobró de más
    expect(r.result.direction).toBe("BARBERO_DEBE");
  });

  it("las transferencias a la cuenta propia cuentan como ya cobradas", async () => {
    await sale(db, { date: DAY, userId: ids.jere, serviceType: "CORTE", quantity: 3, unitPrice: 20000, paymentMethod: "TRANSFERENCIA" });
    await closeDay(db, { date: DAY, actor: admin, declaredCash: 0, declaredTransfers: 60000, changeLeft: 5000, lines: [{ account: "MP_JERE", amount: 45000 }, { account: "BRUBANK", amount: 15000 }], now: NOW });
    const r = await computeSettlement(db, { userId: ids.jere, period: "2026-10" });
    expect(r.detail.ownTransfers).toBe(45000);
    expect(r.settlement.laborServices).toBe(11100 * 3);
    expect(r.result.balance).toBe(33300 - 45000);
  });

  it("al confirmarla queda cerrada y no se recalcula", async () => {
    await sale(db, { date: DAY, userId: ids.lucio, serviceType: "CORTE", unitPrice: 20000, paymentMethod: "TRANSFERENCIA" });
    await computeSettlement(db, { userId: ids.lucio, period: "2026-10" });
    expect(await code(confirmSettlement(db, { userId: ids.lucio, period: "2026-10", actor: barbero }))).toBe("SOLO_ADMIN");
    const c = await confirmSettlement(db, { userId: ids.lucio, period: "2026-10", actor: admin, now: NOW });
    expect(c.status).toBe("CONFIRMED");
    expect(await code(computeSettlement(db, { userId: ids.lucio, period: "2026-10" }))).toBe("YA_CONFIRMADA");
  });
});

describe("alertas guardadas", () => {
  // Fecha de arranque del sistema: los días anteriores (sin datos) no deben generar alertas.
  beforeEach(async () => {
    await db.setting.create({ data: { key: "alerts", value: JSON.stringify({ startDate: "2026-10-03" }) } });
  });

  it("avisa que falta cerrar y se resuelve sola al cerrar; no duplica", async () => {
    await sellDay();
    const first = await syncAlerts(db, { now: NOW });
    expect(first.map((a) => a.code)).toEqual(["CIERRE_PENDIENTE_HOY"]);
    await syncAlerts(db, { now: NOW });
    expect(await db.alert.count()).toBe(1);

    await closeDay(db, { date: DAY, actor: barbero, declaredCash: 20000, declaredTransfers: 42000, changeLeft: 8000, now: NOW });
    const after = await syncAlerts(db, { now: NOW });
    expect(after).toEqual([]);
    const row = await db.alert.findFirstOrThrow();
    expect(row.resolvedAt).not.toBeNull();
  });

  it("el día anterior sin cerrar es error; marcarlo como sin actividad lo silencia", async () => {
    await db.setting.update({ where: { key: "alerts" }, data: { value: JSON.stringify({ startDate: "2026-10-01" }) } });
    await sellDay("2026-10-02");
    const a = await syncAlerts(db, { now: NOW });
    expect(a.find((x) => x.date === "2026-10-02")!.code).toBe("CIERRE_ATRASADO");
    // Jueves sin ventas ni cierre → pregunta si abrieron; el admin lo marca como cerrado.
    expect(a.map((x) => x.code)).toContain("DIA_SIN_MOVIMIENTO");
    await markClosedDay(db, { date: "2026-10-01", actor: admin, reason: "Feriado" });
    expect((await syncAlerts(db, { now: NOW })).map((x) => x.code)).not.toContain("DIA_SIN_MOVIMIENTO");
    expect(await code(markClosedDay(db, { date: "2026-10-02", actor: admin }))).toBe("DIA_CON_VENTAS");
  });

  it("el umbral y la hora de aviso se configuran en la tabla Setting", async () => {
    await sellDay();
    await db.setting.update({ where: { key: "alerts" }, data: { value: JSON.stringify({ startDate: "2026-10-03", closeReminderTime: "23:00" }) } });
    expect(await syncAlerts(db, { now: NOW })).toEqual([]);
  });
});
