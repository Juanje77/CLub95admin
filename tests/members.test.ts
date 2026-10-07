import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addMemberPrice, adjustMember, createMember, getMemberLedger, getMembersMonth, getMemberStatement, memberAlertData, membershipLaborFor, membershipMonthTotals, registerPayment, setAttendance, setMemberSessions, updateMember, voidLedgerEntry } from "../src/services/members";
import { getDayFigures } from "../src/services/figures";
import { getMonthGrid } from "../src/services/grid";
import { computeSettlement } from "../src/services/settlement";
import { syncAlerts } from "../src/services/alerts";
import { DomainError, type Actor } from "../src/services/common";
import { freshDb, seed, type Seed } from "./helpers/db";

const NOW = new Date("2026-10-08T15:00:00Z"); // jueves 8/10/2026
const TODAY = "2026-10-08";
let db: PrismaClient;
let ids: Seed;
let lucio: Actor;
let jere: Actor;
let ale: Actor;
let m1: string; // corte y barba, de Jere
let m2: string; // corte, de Lucio

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return null;
};
const row = async (id: string, month = "2026-10") => (await getMembersMonth(db, month, NOW)).members.find((m) => m.id === id)!;

beforeEach(async () => {
  db = freshDb();
  ids = await seed(db);
  lucio = { id: ids.lucio, role: "BARBERO" };
  jere = { id: ids.jere, role: "BARBERO" };
  ale = { id: ids.ale, role: "ADMIN" };
  m1 = (await createMember(db, { actor: ale, name: "Matías Arrue", serviceType: "CORTE_BARBA", userId: ids.jere, price: 16500, startDate: "2026-09-01", now: NOW })).id;
  m2 = (await createMember(db, { actor: ale, name: "Gaspar Gallegos", serviceType: "CORTE", userId: ids.lucio, price: 15000, startDate: "2026-09-01", now: NOW })).id;
});
afterEach(async () => {
  await db.$disconnect();
});

describe("alta de socios", () => {
  it("el precio por sesión sale del plan y del tipo: Black 16.250 / 17.500, Gold 20.000 / 23.000", async () => {
    const mk = async (plan: string, serviceType: string) => (await row((await createMember(db, { actor: ale, name: `${plan} ${serviceType}`, plan, serviceType, userId: null, now: NOW })).id)).price;
    expect(await mk("BLACK", "CORTE")).toBe(16250);
    expect(await mk("BLACK", "CORTE_BARBA")).toBe(17500);
    expect(await mk("GOLD", "CORTE")).toBe(20000);
    expect(await mk("GOLD", "CORTE_BARBA")).toBe(23000);
    expect(await code(createMember(db, { actor: ale, name: "X", plan: "PLATINO", serviceType: "CORTE", userId: null, now: NOW }))).toBe("PLAN_INVALIDO");
  });
  it("se puede fijar otro precio y valida los datos", async () => {
    const m = await createMember(db, { actor: ale, name: "Nuevo", serviceType: "CORTE", userId: null, price: 14000, now: NOW });
    expect((await row(m.id)).price).toBe(14000);
    expect(await code(createMember(db, { actor: ale, name: " ", serviceType: "CORTE", userId: null, now: NOW }))).toBe("NOMBRE_OBLIGATORIO");
    expect(await code(createMember(db, { actor: ale, name: "X", serviceType: "BARBA", userId: null, now: NOW }))).toBe("TIPO_INVALIDO");
    expect(await code(createMember(db, { actor: ale, name: "X", serviceType: "CORTE", userId: ids.juan, now: NOW }))).toBe("BARBERO_INVALIDO");
    expect(await code(createMember(db, { actor: lucio, name: "X", serviceType: "CORTE", userId: null, now: NOW }))).toBe("SOLO_ADMIN");
  });
  it("el precio default se puede cambiar en la configuración (formato nuevo y viejo)", async () => {
    await db.setting.create({ data: { key: "memberPrices", value: JSON.stringify({ GOLD: { CORTE: 21000 }, CORTE_BARBA: 18000 }) } });
    const gold = await createMember(db, { actor: ale, name: "Otro", plan: "GOLD", serviceType: "CORTE", userId: null, now: NOW });
    expect((await row(gold.id)).price).toBe(21000);
    const oldFormat = await createMember(db, { actor: ale, name: "Viejo", serviceType: "CORTE_BARBA", userId: null, now: NOW });
    expect((await row(oldFormat.id)).price).toBe(18000); // el formato viejo se toma como Black
    const rest = await createMember(db, { actor: ale, name: "Resto", plan: "GOLD", serviceType: "CORTE_BARBA", userId: null, now: NOW });
    expect((await row(rest.id)).price).toBe(23000); // lo que no se configuró sale del default
  });
  it("tildar dos veces no duplica; destildar y volver a tildar reutiliza la fila", async () => {
    await setAttendance(db, { actor: lucio, memberId: m1, date: TODAY, present: true, now: NOW });
    expect((await setAttendance(db, { actor: lucio, memberId: m1, date: TODAY, present: true, now: NOW })).changed).toBe(false);
    await setAttendance(db, { actor: lucio, memberId: m1, date: TODAY, present: false, now: NOW });
    expect((await row(m1)).visits).toBe(0);
    await setAttendance(db, { actor: lucio, memberId: m1, date: TODAY, present: true, now: NOW });
    expect(await db.attendance.count({ where: { memberId: m1 } })).toBe(1);
    expect((await row(m1)).visits).toBe(1);
  });
});

describe("cuenta corriente: debe, haber y saldo", () => {
  beforeEach(async () => {
    for (const d of ["2026-09-04", "2026-09-18"]) await setAttendance(db, { actor: ale, memberId: m1, date: d, present: true, now: NOW });
    for (const d of ["2026-10-02", "2026-10-03", "2026-10-07"]) await setAttendance(db, { actor: ale, memberId: m1, date: d, present: true, now: NOW });
  });

  it("cobra visitas × precio y el saldo arrastra los meses anteriores", async () => {
    const r = await row(m1);
    expect(r).toMatchObject({ visits: 3, charged: 49500, paid: 0, balance: 82500, carried: 33000 });
  });
  it("un pago baja el saldo; lo arrastrado se cancela primero con el pago total", async () => {
    await registerPayment(db, { actor: ale, memberId: m1, date: "2026-10-05", amount: 30000, method: "BANCO", now: NOW });
    const r = await row(m1);
    expect(r).toMatchObject({ paid: 0, balance: 52500, carried: 3000 }); // sin indicar mes, el cobro cubre septiembre (el más viejo con deuda)
    expect(await row(m1, "2026-09")).toMatchObject({ paid: 30000, status: "PARCIAL" });
  });
  it("los ajustes manuales llevan motivo: + suma deuda, − la baja", async () => {
    await adjustMember(db, { actor: ale, memberId: m1, date: TODAY, amount: 2000, reason: "Corte extra fuera de plan", now: NOW });
    await adjustMember(db, { actor: ale, memberId: m1, date: TODAY, amount: -1500, reason: "Descuento por demora", now: NOW });
    expect((await row(m1)).balance).toBe(82500 + 2000 - 1500);
    expect(await code(adjustMember(db, { actor: ale, memberId: m1, date: TODAY, amount: 500, reason: " ", now: NOW }))).toBe("MOTIVO_OBLIGATORIO");
    expect(await code(adjustMember(db, { actor: ale, memberId: m1, date: TODAY, amount: 0, reason: "x", now: NOW }))).toBe("MONTO_INVALIDO");
    const led = await getMemberLedger(db, m1);
    expect(led.map((l) => [l.kind, l.debit, l.credit])).toEqual(expect.arrayContaining([["AJUSTE", 2000, 0], ["AJUSTE", 0, 1500]]));
  });
  it("anular un movimiento lo saca del saldo y queda registrado", async () => {
    const p = await registerPayment(db, { actor: ale, memberId: m1, date: TODAY, amount: 10000, method: "EFECTIVO", now: NOW });
    await voidLedgerEntry(db, { actor: ale, id: p.id, reason: "Se cargó dos veces" });
    expect((await row(m1)).paid).toBe(0);
    expect(await code(voidLedgerEntry(db, { actor: ale, id: p.id, reason: "x" }))).toBe("MOVIMIENTO_INEXISTENTE");
    expect(await db.auditLog.count({ where: { entity: "MemberLedger", action: "DELETE" } })).toBe(1);
  });
  it("valida los pagos: monto, medio, fecha y permisos", async () => {
    const base = { actor: ale, memberId: m1, date: TODAY, amount: 1000, method: "BANCO", now: NOW };
    expect(await code(registerPayment(db, { ...base, amount: 0 }))).toBe("MONTO_INVALIDO");
    expect(await code(registerPayment(db, { ...base, method: "CHEQUE" }))).toBe("MEDIO_DE_PAGO_INVALIDO");
    expect(await code(registerPayment(db, { ...base, date: "2026-10-09" }))).toBe("FECHA_FUTURA");
    expect(await code(registerPayment(db, { ...base, actor: lucio }))).toBe("SOLO_ADMIN");
  });
});

describe("la planilla de socios: sesiones del mes, cobro imputado y estado", () => {
  it("las sesiones cargadas a mano mandan sobre la asistencia y se cobran al precio vigente", async () => {
    await setAttendance(db, { actor: ale, memberId: m1, date: "2026-10-02", present: true, now: NOW });
    expect(await row(m1)).toMatchObject({ visits: 1, manual: false, charged: 16500 });
    await setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-10", sessions: 4 });
    expect(await row(m1)).toMatchObject({ visits: 4, manual: true, charged: 66000, status: "INPAGO" });
    await setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-10", sessions: null }); // vuelve a contar la asistencia
    expect(await row(m1)).toMatchObject({ visits: 1, manual: false, charged: 16500 });
    expect(await db.auditLog.count({ where: { entity: "MemberMonth" } })).toBe(2); // alta y borrado
  });
  it("valida mes, cantidad y permisos", async () => {
    expect(await code(setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-13", sessions: 4 }))).toBe("MES_INVALIDO");
    expect(await code(setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-10", sessions: 4.5 }))).toBe("SESIONES_INVALIDAS");
    expect(await code(setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-10", sessions: 32 }))).toBe("SESIONES_INVALIDAS");
    expect(await code(setMemberSessions(db, { actor: lucio, memberId: m1, month: "2026-10", sessions: 4 }))).toBe("SOLO_ADMIN");
  });
  it("estado del mes: INPAGO, PARCIAL y PAGO, con la diferencia como en la planilla", async () => {
    await setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-10", sessions: 4 }); // 66.000
    await registerPayment(db, { actor: ale, memberId: m1, date: "2026-10-02", amount: 15000, method: "BANCO", period: "2026-10", now: NOW });
    expect(await row(m1)).toMatchObject({ paid: 15000, diff: -51000, status: "PARCIAL", lastPayDate: "2026-10-02" });
    await registerPayment(db, { actor: ale, memberId: m1, date: TODAY, amount: 51000, method: "EFECTIVO", period: "2026-10", now: NOW });
    expect(await row(m1)).toMatchObject({ paid: 66000, diff: 0, status: "PAGO", lastPayDate: TODAY, balance: 0 });
  });
  it("un cobro sin mes se imputa al mes más viejo con deuda; si no debe nada, es un pago adelantado", async () => {
    await setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-09", sessions: 4 }); // 66.000
    await setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-10", sessions: 4 }); // 66.000
    await registerPayment(db, { actor: ale, memberId: m1, date: "2026-10-02", amount: 66000, method: "BANCO", now: NOW });
    expect((await row(m1, "2026-09")).status).toBe("PAGO");
    expect((await row(m1, "2026-10")).status).toBe("INPAGO");
    await registerPayment(db, { actor: ale, memberId: m1, date: "2026-10-03", amount: 66000, method: "BANCO", now: NOW });
    expect((await row(m1, "2026-10")).status).toBe("PAGO");
    await registerPayment(db, { actor: ale, memberId: m1, date: "2026-10-04", amount: 66000, method: "BANCO", now: NOW }); // ya no debe nada: queda a favor
    expect((await getMemberStatement(db, m1)).map((r) => [r.month, r.status, r.balance])).toEqual([["2026-09", "PAGO", 0], ["2026-10", "PAGO", -66000]]);
    expect((await row(m1)).balance).toBe(-66000);
  });
  it("si un socio no paga, la deuda se arrastra mes a mes y no se pierde", async () => {
    await setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-08", sessions: 4 }); // 66.000 sin pagar
    await setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-09", sessions: 5 }); // 82.500
    await registerPayment(db, { actor: ale, memberId: m1, date: "2026-09-10", amount: 30000, method: "BANCO", period: "2026-09", now: NOW });
    await setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-10", sessions: 4 }); // 66.000
    const st = await getMemberStatement(db, m1);
    expect(st.map((r) => [r.month, r.due, r.paid, r.balance, r.status])).toEqual([
      ["2026-08", 66000, 0, 66000, "INPAGO"],
      ["2026-09", 82500, 30000, 118500, "PARCIAL"],
      ["2026-10", 66000, 0, 184500, "INPAGO"],
    ]);
    expect(await row(m1)).toMatchObject({ balance: 184500, carried: 118500, oldestUnpaid: "2026-08" });
  });
  it("el aporte al barbero y al local sale de las sesiones cargadas a mano", async () => {
    await setMemberSessions(db, { actor: ale, memberId: m1, month: "2026-10", sessions: 4 }); // Jere: (16.500 − 1.500) × 60% = 9.000 por sesión
    expect(await row(m1)).toMatchObject({ barberShare: 36000, localShare: 30000 });
    expect(await membershipLaborFor(db, ids.jere, "2026-10")).toBe(36000);
    const t = await membershipMonthTotals(db, "2026-10");
    expect(t).toMatchObject({ visits: 4, income: 66000, drinkCost: 4 * 1500 });
  });
});

describe("aporte al barbero y al local", () => {
  it("(precio − bebida) × comisión para el barbero que lo atendió; el resto para el local", async () => {
    await setAttendance(db, { actor: lucio, memberId: m1, date: TODAY, present: true, now: NOW }); // 16.500: base 13.500 → Lucio 8.100
    await setAttendance(db, { actor: jere, memberId: m2, date: TODAY, present: true, now: NOW }); //  15.000: base 13.500 → Jere 8.100
    const a = await row(m1);
    expect(a).toMatchObject({ barberShare: 8100, localShare: 8400 });
    const b = await row(m2);
    expect(b).toMatchObject({ barberShare: 8100, localShare: 6900 });
  });
  it("lo del mes por barbero alimenta la compensación de fin de mes automáticamente", async () => {
    await setAttendance(db, { actor: ale, memberId: m1, date: "2026-10-02", present: true, barberId: ids.lucio, now: NOW });
    await setAttendance(db, { actor: ale, memberId: m2, date: "2026-10-02", present: true, barberId: ids.lucio, now: NOW });
    expect(await membershipLaborFor(db, ids.lucio, "2026-10")).toBe(8100 + 7200);
    const s = await computeSettlement(db, { userId: ids.lucio, period: "2026-10" });
    expect(s.settlement.laborMembership).toBe(15300);
    expect(s.result.balance).toBe(15300); // sin servicios ni retiros: el local le debe lo de las membresías
  });
  it("totales del mes para el panel: devengado, mano de obra y costo de bebida", async () => {
    await setAttendance(db, { actor: ale, memberId: m1, date: "2026-10-02", present: true, barberId: ids.lucio, now: NOW });
    await setAttendance(db, { actor: jere, memberId: m2, date: TODAY, present: true, now: NOW });
    await registerPayment(db, { actor: ale, memberId: m1, date: TODAY, amount: 20000, method: "BANCO", now: NOW });
    const t = await membershipMonthTotals(db, "2026-10");
    expect(t).toMatchObject({ visits: 2, income: 31500, paid: 20000, drinkCost: 3000 + 1500 });
    expect(t.laborByBarber[ids.lucio]).toBe(8100);
    expect(t.laborByBarber[ids.jere]).toBe(Math.round((15000 - 1500) * 0.6));
  });
});

describe("los cobros de socios entran a la caja del día", () => {
  it("suman a lo que tiene que haber ese día (efectivo o banco)", async () => {
    await registerPayment(db, { actor: ale, memberId: m1, date: TODAY, amount: 15000, method: "EFECTIVO", now: NOW });
    await registerPayment(db, { actor: ale, memberId: m2, date: TODAY, amount: 10000, method: "BANCO", now: NOW });
    const f = await getDayFigures(db, TODAY);
    expect(f).toMatchObject({ expectedIncome: 25000, expectedCash: 15000, expectedTransfers: 10000 });
  });
  it("la diferencia de caja de la planilla los incluye", async () => {
    await registerPayment(db, { actor: ale, memberId: m1, date: TODAY, amount: 15000, method: "EFECTIVO", now: NOW });
    const grid = await getMonthGrid(db, "2026-10", NOW);
    const d = grid.days.find((x) => x.date === TODAY)!;
    expect(d.memberPayments).toBe(15000);
    expect(d.difference).toBeNull(); // todavía no se cargó el dinero ingresado
  });
});

describe("alertas de socios", () => {
  it("deuda de meses anteriores: solo a partir del día de vencimiento", async () => {
    await setAttendance(db, { actor: ale, memberId: m1, date: "2026-09-04", present: true, now: NOW });
    const early = await memberAlertData(db, new Date("2026-10-08T15:00:00Z"), { inactiveDays: 30, debtDay: 10 });
    expect(early.debts).toEqual([]);
    const late = await memberAlertData(db, new Date("2026-10-12T15:00:00Z"), { inactiveDays: 30, debtDay: 10 });
    expect(late.debts).toEqual([{ id: m1, name: "Matías Arrue", amount: 16500 }]);
    await registerPayment(db, { actor: ale, memberId: m1, date: "2026-10-08", amount: 16500, method: "BANCO", now: NOW });
    expect((await memberAlertData(db, new Date("2026-10-12T15:00:00Z"), { inactiveDays: 30, debtDay: 10 })).debts).toEqual([]);
  });
  it("socios que hace más de 30 días que no vienen", async () => {
    await setAttendance(db, { actor: ale, memberId: m1, date: "2026-09-04", present: true, now: NOW }); // hace 34 días
    await setAttendance(db, { actor: ale, memberId: m2, date: "2026-10-02", present: true, now: NOW });
    const r = await memberAlertData(db, NOW, { inactiveDays: 30, debtDay: 10 });
    expect(r.inactive).toEqual([{ id: m1, name: "Matías Arrue", days: 34 }]);
  });
  it("llegan a las alertas del sistema con los textos para el admin", async () => {
    await db.setting.create({ data: { key: "alerts", value: JSON.stringify({ startDate: TODAY }) } });
    await setAttendance(db, { actor: ale, memberId: m1, date: "2026-09-04", present: true, now: NOW });
    const a = await syncAlerts(db, { now: new Date("2026-10-12T15:00:00Z") });
    expect(a.find((x) => x.code === "SOCIO_CON_DEUDA")!.message).toContain("Matías Arrue tiene una deuda vencida de $ 16.500");
    expect(a.find((x) => x.code === "SOCIO_SIN_VENIR")!.message).toContain("no viene hace 38 días");
  });
});
