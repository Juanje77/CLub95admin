import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addMemberPrice, adjustMember, createMember, getMemberLedger, getMembersMonth, memberAlertData, membershipLaborFor, membershipMonthTotals, registerPayment, setAttendance, updateMember, voidLedgerEntry } from "../src/services/members";
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
  m1 = (await createMember(db, { actor: ale, name: "Matías Arrue", serviceType: "CORTE_BARBA", userId: ids.jere, startDate: "2026-09-01", now: NOW })).id;
  m2 = (await createMember(db, { actor: ale, name: "Gaspar Gallegos", serviceType: "CORTE", userId: ids.lucio, startDate: "2026-09-01", now: NOW })).id;
});
afterEach(async () => {
  await db.$disconnect();
});

describe("alta de socios", () => {
  it("el precio por visita sale del tipo: $ 15.000 corte, $ 16.500 corte y barba", async () => {
    expect((await row(m1)).price).toBe(16500);
    expect((await row(m2)).price).toBe(15000);
  });
  it("se puede fijar otro precio y valida los datos", async () => {
    const m = await createMember(db, { actor: ale, name: "Nuevo", serviceType: "CORTE", userId: null, price: 14000, now: NOW });
    expect((await row(m.id)).price).toBe(14000);
    expect(await code(createMember(db, { actor: ale, name: " ", serviceType: "CORTE", userId: null, now: NOW }))).toBe("NOMBRE_OBLIGATORIO");
    expect(await code(createMember(db, { actor: ale, name: "X", serviceType: "BARBA", userId: null, now: NOW }))).toBe("TIPO_INVALIDO");
    expect(await code(createMember(db, { actor: ale, name: "X", serviceType: "CORTE", userId: ids.juan, now: NOW }))).toBe("BARBERO_INVALIDO");
    expect(await code(createMember(db, { actor: lucio, name: "X", serviceType: "CORTE", userId: null, now: NOW }))).toBe("SOLO_ADMIN");
  });
  it("el precio default se puede cambiar en la configuración", async () => {
    await db.setting.create({ data: { key: "memberPrices", value: JSON.stringify({ CORTE: 17000 }) } });
    const m = await createMember(db, { actor: ale, name: "Otro", serviceType: "CORTE", userId: null, now: NOW });
    expect((await row(m.id)).price).toBe(17000);
  });
  it("un precio nuevo rige desde su fecha y no cambia las visitas anteriores", async () => {
    await setAttendance(db, { actor: ale, memberId: m1, date: "2026-10-02", present: true, now: NOW });
    await addMemberPrice(db, { actor: ale, memberId: m1, validFrom: "2026-10-20", price: 18000, now: NOW });
    expect((await row(m1)).charged).toBe(16500);
    expect(await code(addMemberPrice(db, { actor: ale, memberId: m1, validFrom: "2026-09-15", price: 1, now: NOW }))).toBe("VIGENCIA_PASADA");
  });
  it("una visita anterior a la fecha del primer precio se cobra con ese primer precio, no en $ 0", async () => {
    const m = await createMember(db, { actor: ale, name: "Recién llegado", serviceType: "CORTE", userId: null, startDate: TODAY, now: NOW });
    await setAttendance(db, { actor: ale, memberId: m.id, date: "2026-10-07", present: true, now: NOW });
    expect((await row(m.id)).charged).toBe(15000);
  });
  it("se puede editar y dar de baja", async () => {
    await updateMember(db, { actor: ale, id: m2, name: "Gaspar G.", userId: ids.jere, active: false });
    const r = await db.member.findUniqueOrThrow({ where: { id: m2 } });
    expect(r).toMatchObject({ name: "Gaspar G.", userId: ids.jere, active: false });
    expect(await code(setAttendance(db, { actor: ale, memberId: m2, date: TODAY, present: true, now: NOW }))).toBe("SOCIO_INEXISTENTE");
  });
});

describe("asistencia", () => {
  it("el barbero tilda hoy y queda como quien lo atendió", async () => {
    await setAttendance(db, { actor: lucio, memberId: m1, date: TODAY, present: true, now: NOW });
    const a = await db.attendance.findFirstOrThrow({ where: { memberId: m1 } });
    expect(a.userId).toBe(ids.lucio); // aunque el socio sea de Jere, lo atendió Lucio
  });
  it("el admin tilda un día pasado y elige quién lo atendió (o el asignado)", async () => {
    await setAttendance(db, { actor: ale, memberId: m1, date: "2026-10-02", present: true, now: NOW });
    await setAttendance(db, { actor: ale, memberId: m2, date: "2026-10-02", present: true, barberId: ids.jere, now: NOW });
    expect((await db.attendance.findFirstOrThrow({ where: { memberId: m1 } })).userId).toBe(ids.jere);
    expect((await db.attendance.findFirstOrThrow({ where: { memberId: m2 } })).userId).toBe(ids.jere);
  });
  it("permisos: barbero no marca días pasados ni saca lo de otro; nadie marca el futuro", async () => {
    expect(await code(setAttendance(db, { actor: lucio, memberId: m1, date: "2026-10-02", present: true, now: NOW }))).toBe("DIA_PASADO_REQUIERE_ADMIN");
    expect(await code(setAttendance(db, { actor: ale, memberId: m1, date: "2026-10-09", present: true, now: NOW }))).toBe("FECHA_FUTURA");
    await setAttendance(db, { actor: jere, memberId: m1, date: TODAY, present: true, now: NOW });
    expect(await code(setAttendance(db, { actor: lucio, memberId: m1, date: TODAY, present: false, now: NOW }))).toBe("SOLO_PROPIO");
    await setAttendance(db, { actor: jere, memberId: m1, date: TODAY, present: false, now: NOW });
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
    expect(r).toMatchObject({ paid: 30000, balance: 52500, carried: 3000 });
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
