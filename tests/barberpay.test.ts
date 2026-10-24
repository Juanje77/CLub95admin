import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addBarberPayment, getBarberPayables, setBarberOpening, voidBarberPayment } from "../src/services/barberpay";
import { setDeclared, setServiceCount } from "../src/services/grid";
import { createMember, registerPayment, setMemberSessions } from "../src/services/members";
import { DomainError, type Actor } from "../src/services/common";
import { freshDb, seed, type Seed } from "./helpers/db";

const NOW = new Date("2026-10-03T23:45:00Z");
const DAY = "2026-10-03";
let db: PrismaClient;
let ids: Seed;
let admin: Actor;
let lucio: Actor;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return null;
};
const get = async (month = "2026-10") => (await getBarberPayables(db, month)).barbers;
const by = async (name: string, month = "2026-10") => (await get(month)).find((b) => b.name === name)!;

beforeEach(async () => {
  db = freshDb();
  ids = await seed(db);
  admin = { id: ids.ale, role: "ADMIN" };
  lucio = { id: ids.lucio, role: "BARBERO" };
  await setServiceCount(db, { actor: admin, date: DAY, userId: ids.jere, serviceType: "CORTE", count: 2, now: NOW }); // Jere cobra (20.000 − 1.500) × 60 % = 11.100 por corte
  await setServiceCount(db, { actor: admin, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 3, now: NOW }); // Lucio cobra (20.000 − 3.000) × 60 % = 10.200 por corte
  const socio = await createMember(db, { actor: admin, name: "Socio de Jere", serviceType: "CORTE", userId: ids.jere, price: 16500, startDate: "2026-09-01", now: NOW });
  await setMemberSessions(db, { actor: admin, memberId: socio.id, month: "2026-10", sessions: 4 });
  // El socio pagó el mes (4 × 16.500 = 66.000): se le saca la bebida (4 × 1.500) y a lo que queda 60 % para Jere = 36.000.
  await registerPayment(db, { actor: admin, memberId: socio.id, date: "2026-10-02", amount: 66000, method: "BANCO", period: "2026-10", now: NOW });
});
afterEach(async () => {
  await db.$disconnect();
});

describe("cuánto hay que pagarle a cada barbero", () => {
  it("le corresponde lo de los cortes de la planilla más lo de las sesiones de socios", async () => {
    const jere = await by("Jere");
    expect(jere).toMatchObject({ laborServices: 22200, laborMembership: 36000, entitled: 58200, collected: 0, toPay: 58200, selfPaid: false });
    expect(await by("Lucio")).toMatchObject({ laborServices: 30600, laborMembership: 0, entitled: 30600, toPay: 30600 });
  });

  it("un socio que no pagó todavía no le genera nada al barbero", async () => {
    const moroso = await createMember(db, { actor: admin, name: "Moroso", serviceType: "CORTE", userId: ids.lucio, price: 20000, startDate: "2026-09-01", now: NOW });
    await setMemberSessions(db, { actor: admin, memberId: moroso.id, month: "2026-10", sessions: 4 });
    expect((await by("Lucio")).laborMembership).toBe(0);
    await registerPayment(db, { actor: admin, memberId: moroso.id, date: "2026-10-03", amount: 40000, method: "BANCO", period: "2026-10", now: NOW }); // pagó la mitad
    // 40.000 − bebida (4 × 3.000) = 28.000 × 60 % = 16.800
    expect((await by("Lucio")).laborMembership).toBe(16800);
  });

  it("descuenta el efectivo que retiró, lo que entró a su cuenta propia y lo que se le pagó", async () => {
    await db.cashBoxEntry.create({ data: { date: DAY, kind: "RETIRO_BARBERO", amount: -10000, userId: ids.jere } });
    await setDeclared(db, { actor: admin, date: DAY, account: "MP_JERE", amount: 20000, now: NOW }); // la cuenta de Jere es suya
    await addBarberPayment(db, { actor: admin, userId: ids.lucio, date: DAY, amount: 20000, method: "BANCO", note: "Desde la cuenta de Ale", now: NOW });
    expect(await by("Jere")).toMatchObject({ cashTaken: 10000, ownTransfers: 20000, paid: 0, collected: 30000, toPay: 28200 });
    expect(await by("Lucio")).toMatchObject({ paid: 20000, collected: 20000, toPay: 10600 });
    expect((await getBarberPayables(db, "2026-10")).totalToPay).toBe(28200 + 10600);
  });

  it("Ale se paga solo (retira de su cuenta): no suma a lo que hay que pagar", async () => {
    await setServiceCount(db, { actor: admin, date: DAY, userId: ids.ale, serviceType: "CORTE", count: 1, now: NOW }); // 20.000 − 3.000 = 17.000
    const ale = await by("Ale");
    expect(ale).toMatchObject({ entitled: 17000, selfPaid: true });
    expect((await getBarberPayables(db, "2026-10")).totalToPay).toBe(58200 + 30600);
  });

  it("lo que no se pagó en un mes se arrastra al siguiente", async () => {
    await setServiceCount(db, { actor: admin, date: "2026-09-30", userId: ids.lucio, serviceType: "CORTE", count: 1, now: NOW }); // 10.200 de septiembre
    const oct = await by("Lucio");
    expect(oct).toMatchObject({ carried: 10200, balance: 30600, toPay: 40800 });
    await addBarberPayment(db, { actor: admin, userId: ids.lucio, date: "2026-10-02", amount: 40800, method: "EFECTIVO", now: NOW });
    expect((await by("Lucio")).toPay).toBe(0);
    expect((await by("Lucio", "2026-09")).toPay).toBe(10200); // septiembre visto por sí solo
  });

  it("si cobró de más, el saldo queda negativo y no suma a lo que hay que pagar", async () => {
    await db.cashBoxEntry.create({ data: { date: DAY, kind: "RETIRO_BARBERO", amount: -70000, userId: ids.jere } });
    const jere = await by("Jere");
    expect(jere.toPay).toBe(58200 - 70000);
    expect((await getBarberPayables(db, "2026-10")).totalToPay).toBe(30600); // solo lo de Lucio
  });

  it("anular un pago vuelve el saldo y queda registrado; valida datos y permisos", async () => {
    const p = await addBarberPayment(db, { actor: admin, userId: ids.lucio, date: DAY, amount: 10000, method: "BANCO", now: NOW });
    await voidBarberPayment(db, { actor: admin, id: p.id, reason: "Estaba mal cargado" });
    expect((await by("Lucio")).toPay).toBe(30600);
    expect(await code(voidBarberPayment(db, { actor: admin, id: p.id, reason: "x" }))).toBe("PAGO_INEXISTENTE");
    expect(await db.auditLog.count({ where: { entity: "BarberPayment" } })).toBe(2);
    const base = { actor: admin, userId: ids.lucio, date: DAY, amount: 1000, method: "BANCO", now: NOW };
    expect(await code(addBarberPayment(db, { ...base, amount: 0 }))).toBe("MONTO_INVALIDO");
    expect(await code(addBarberPayment(db, { ...base, method: "CHEQUE" }))).toBe("MEDIO_DE_PAGO_INVALIDO");
    expect(await code(addBarberPayment(db, { ...base, date: "2026-10-09" }))).toBe("FECHA_FUTURA");
    expect(await code(addBarberPayment(db, { ...base, userId: ids.juan }))).toBe("BARBERO_INVALIDO");
    expect(await code(addBarberPayment(db, { ...base, actor: lucio }))).toBe("SOLO_ADMIN");
  });
});

describe("cuenta corriente de un barbero que cobra en su cuenta", () => {
  it("lo que entró a su cuenta se descuenta, un adelanto resta, una devolución suma, y el detalle va día por día", async () => {
    await db.paymentAccount.upsert({ where: { key: "MP_JERE" }, update: { ownerUserId: ids.jere }, create: { key: "MP_JERE", name: "Mercado Pago Jere", kind: "TRANSFERENCIA", ownerUserId: ids.jere } });
    await setDeclared(db, { actor: admin, date: DAY, account: "MP_JERE", amount: 40000, now: NOW }); // cobró los 2 cortes en su Mercado Pago
    await addBarberPayment(db, { actor: admin, userId: ids.jere, date: DAY, amount: 10000, method: "EFECTIVO", note: "adelanto", now: NOW });
    let jere = await by("Jere");
    expect(jere.toPay).toBe(58200 - 40000 - 10000); // 8.200
    await addBarberPayment(db, { actor: admin, userId: ids.jere, date: DAY, amount: 3000, method: "BANCO", direction: "DEL_BARBERO", now: NOW });
    jere = await by("Jere");
    expect(jere.toPay).toBe(11200);
    expect(jere.ledger).toEqual([
      { date: DAY, members: false, collected: 40000, entitled: 22200, shouldSend: 17800, received: 10000, sent: 3000, debt: 24800 }, // 40 % + bebida = 17.800; adelanto 10.000; devolvió 3.000
      { date: "2026-10-31", members: true, collected: 0, entitled: 36000, shouldSend: -36000, received: 0, sent: 0, debt: -11200 }, // los socios le corresponden: el local le debe 11.200
    ]);
  });
});

describe("rendimiento: el saldo arrastrado no repite lecturas por mes", () => {
  it("con un año de historia calcula rápido y arrastra bien", async () => {
    const t0 = Date.now();
    const data = await getBarberPayables(db, "2027-10"); // 12 meses de arrastre
    expect(Date.now() - t0).toBeLessThan(4000);
    const jere = data.barbers.find((b) => b.name === "Jere")!;
    expect(jere.carried).toBe(58200); // lo de octubre 2026 sigue sin pagarse
  });
});

describe("saldo inicial de la cuenta corriente", () => {
  it("se puede arrancar un mes en cero sin arrastrar lo anterior, y quitarlo vuelve al historial", async () => {
    const carriedFrom = async (m: string) => (await by("Jere", m)).carried;
    expect(await carriedFrom("2026-11")).toBe(58200); // octubre quedó sin pagar
    await setBarberOpening(db, { actor: admin, userId: ids.jere, month: "2026-11", debt: 0, note: "arranca de cero" });
    expect(await carriedFrom("2026-11")).toBe(0);
    expect((await by("Jere", "2026-11")).opening).toMatchObject({ month: "2026-11", debt: 0 });
    // Un saldo con deuda de Jere hacia el local: positivo = Jere debe
    await setBarberOpening(db, { actor: admin, userId: ids.jere, month: "2026-11", debt: 20000 });
    expect(await carriedFrom("2026-11")).toBe(-20000);
    expect((await by("Jere", "2026-11")).toPay).toBe(-20000);
    expect((await by("Jere", "2026-11")).ledger.length).toBe(0);
    // Los meses siguientes parten de ese saldo
    expect(await carriedFrom("2026-12")).toBe(-20000);
    // Los demás barberos no cambian
    expect(await carriedFrom2("Lucio")).toBe(30600);
    await setBarberOpening(db, { actor: admin, userId: ids.jere, month: "2026-11", debt: null });
    expect(await carriedFrom("2026-11")).toBe(58200);
  });

  it("solo admin, mes y monto válidos, y queda auditado", async () => {
    expect(await code(setBarberOpening(db, { actor: lucio, userId: ids.jere, month: "2026-10", debt: 0 }))).toBe("SOLO_ADMIN");
    expect(await code(setBarberOpening(db, { actor: admin, userId: ids.jere, month: "octubre", debt: 0 }))).toBe("MES_INVALIDO");
    expect(await code(setBarberOpening(db, { actor: admin, userId: ids.jere, month: "2026-10", debt: 1.5 }))).toBe("MONTO_INVALIDO");
    expect(await code(setBarberOpening(db, { actor: admin, userId: ids.ale, month: "2026-10", debt: 0 }))).toBeNull(); // Ale también es barbero
    await setBarberOpening(db, { actor: admin, userId: ids.jere, month: "2026-10", debt: 0 });
    expect(await db.auditLog.count({ where: { entity: "Setting", entityId: `barberOpening:${ids.jere}` } })).toBe(1);
  });
});
const carriedFrom2 = async (name: string) => (await by(name, "2026-11")).carried;
