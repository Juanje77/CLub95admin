import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { sessionFigures } from "../src/domain/memberfunds";
import { addFundEntry, getMemberFunds, voidFundEntry } from "../src/services/memberfunds";
import { createMember, registerPayment, setMemberSessions } from "../src/services/members";
import { DomainError, type Actor } from "../src/services/common";
import { freshDb, seed, type Seed } from "./helpers/db";

const NOW = new Date("2026-10-08T15:00:00Z");
const TODAY = "2026-10-08";
let db: PrismaClient;
let ids: Seed;
let ale: Actor;
let lucio: Actor;
let mJere: string;
let mAle: string;
let mLucio: string;

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
  ale = { id: ids.ale, role: "ADMIN" };
  lucio = { id: ids.lucio, role: "BARBERO" };
  const mk = async (name: string, userId: string, price: number) => (await createMember(db, { actor: ale, name, serviceType: "CORTE", userId, price, startDate: "2026-09-01", now: NOW })).id;
  mJere = await mk("Socio de Jere", ids.jere, 16500);
  mAle = await mk("Socio de Ale", ids.ale, 20000);
  mLucio = await mk("Socio de Lucio", ids.lucio, 20000);
});
afterEach(async () => {
  await db.$disconnect();
});

describe("cuentas de socios: cálculo por sesión", () => {
  it("reparte cada sesión en barbero, bebida y ganancia del local", () => {
    const rule = (bp: number, drink: number) => ({ validFrom: "2026-09-01", commissionBp: bp, drinkDeduction: drink, drinkCost: drink });
    expect(sessionFigures(20000, 1, rule(10000, 3000))).toEqual({ labor: 17000, drink: 3000, profit: 0 }); // Ale: 100 % de lo que queda
    expect(sessionFigures(20000, 1, rule(6000, 3000))).toEqual({ labor: 10200, drink: 3000, profit: 6800 }); // Lucio
    expect(sessionFigures(16500, 2, rule(6000, 1500))).toEqual({ labor: 18000, drink: 3000, profit: 12000 }); // Jere, 2 sesiones
  });
});

describe("efectivo a rendir, cuenta de bebida y ganancia de Lucio", () => {
  beforeEach(async () => {
    await setMemberSessions(db, { actor: ale, memberId: mJere, month: "2026-10", sessions: 4 });
    await setMemberSessions(db, { actor: ale, memberId: mAle, month: "2026-10", sessions: 2 });
    await setMemberSessions(db, { actor: ale, memberId: mLucio, month: "2026-10", sessions: 3 });
    await registerPayment(db, { actor: ale, memberId: mJere, date: "2026-10-05", amount: 50000, method: "EFECTIVO", now: NOW });
    await registerPayment(db, { actor: ale, memberId: mLucio, date: "2026-10-06", amount: 30000, method: "BANCO", now: NOW });
  });

  it("efectivo a rendir = efectivo cobrado − cortes de Ale (lo que él se queda); la transferencia no cuenta", async () => {
    const f = await getMemberFunds(db, "2026-10");
    expect(f.parts).toMatchObject({ cashCollected: 50000, aleCuts: 34000 });
    expect(f.balances.efectivo).toBe(16000);
  });
  it("la bebida se compone de las sesiones de todos: Lucio y Ale $ 3.000, Jere $ 1.500", async () => {
    const f = await getMemberFunds(db, "2026-10");
    expect(f.balances.bebida).toBe(4 * 1500 + 2 * 3000 + 3 * 3000);
    expect(f.drinkByBarber.map((d) => [d.name, d.sessions, d.amount])).toEqual([["Lucio", 3, 9000], ["Ale", 2, 6000], ["Jere", 4, 6000]]);
  });
  it("la ganancia de Lucio es lo que queda para el local de sus sesiones, sin bebida ni su parte", async () => {
    expect((await getMemberFunds(db, "2026-10")).balances.ganancia).toBe(3 * 6800);
  });
  it("se acumula de un mes al siguiente", async () => {
    await setMemberSessions(db, { actor: ale, memberId: mLucio, month: "2026-09", sessions: 4 });
    const oct = await getMemberFunds(db, "2026-10");
    expect(oct.balances.ganancia).toBe(7 * 6800);
    expect(oct.current.profit).toBe(3 * 6800); // el mes elegido
    expect(oct.months.map((m) => [m.month, m.profit])).toEqual([["2026-10", 20400], ["2026-09", 27200]]);
    const sep = await getMemberFunds(db, "2026-09");
    expect(sep.months.map((m) => m.month)).toEqual(["2026-09"]); // no muestra meses posteriores
  });
  it("la rendición, la compra de bebida y el retiro de ganancia bajan el saldo; se cargan en positivo", async () => {
    await addFundEntry(db, { actor: ale, fund: "EFECTIVO", kind: "RENDICION", amount: 10000, date: TODAY, note: "Se la di a Juan", now: NOW });
    await addFundEntry(db, { actor: ale, fund: "BEBIDA", kind: "GASTO", amount: 5000, date: TODAY, now: NOW });
    await addFundEntry(db, { actor: ale, fund: "GANANCIA", kind: "RETIRO", amount: 400, date: TODAY, now: NOW });
    const f = await getMemberFunds(db, "2026-10");
    expect(f.balances).toEqual({ efectivo: 6000, bebida: 21000 - 5000, ganancia: 20400 - 400 });
    expect(f.entries.map((e) => e.amount).sort((a, b) => a - b)).toEqual([-10000, -5000, -400]);
  });
  it("el ajuste lleva signo y motivo (sirve para el saldo inicial)", async () => {
    await addFundEntry(db, { actor: ale, fund: "BEBIDA", kind: "AJUSTE", amount: 12000, date: TODAY, note: "Saldo inicial", now: NOW });
    expect((await getMemberFunds(db, "2026-10")).balances.bebida).toBe(21000 + 12000);
    expect(await code(addFundEntry(db, { actor: ale, fund: "BEBIDA", kind: "AJUSTE", amount: 5, date: TODAY, now: NOW }))).toBe("MOTIVO_OBLIGATORIO");
  });
  it("anular un movimiento vuelve el saldo y queda registrado", async () => {
    const e = await addFundEntry(db, { actor: ale, fund: "EFECTIVO", kind: "RENDICION", amount: 10000, date: TODAY, now: NOW });
    await voidFundEntry(db, { actor: ale, id: e.id, reason: "Estaba mal cargado" });
    expect((await getMemberFunds(db, "2026-10")).balances.efectivo).toBe(16000);
    expect(await code(voidFundEntry(db, { actor: ale, id: e.id, reason: "x" }))).toBe("MOVIMIENTO_INEXISTENTE");
    expect(await db.auditLog.count({ where: { entity: "MemberFundEntry" } })).toBe(2);
  });
  it("valida cuenta, tipo de movimiento, monto, fecha y permisos", async () => {
    const base = { actor: ale, fund: "EFECTIVO", kind: "RENDICION", amount: 1000, date: TODAY, now: NOW };
    expect(await code(addFundEntry(db, { ...base, fund: "OTRA" }))).toBe("CUENTA_INVALIDA");
    expect(await code(addFundEntry(db, { ...base, kind: "GASTO" }))).toBe("MOVIMIENTO_INVALIDO");
    expect(await code(addFundEntry(db, { ...base, amount: 0 }))).toBe("MONTO_INVALIDO");
    expect(await code(addFundEntry(db, { ...base, amount: -5 }))).toBe("MONTO_INVALIDO");
    expect(await code(addFundEntry(db, { ...base, date: "2026-10-09" }))).toBe("FECHA_FUTURA");
    expect(await code(addFundEntry(db, { ...base, actor: lucio }))).toBe("SOLO_ADMIN");
  });
  it("la cuenta de ganancia se puede dar a otros barberos con el ajuste memberFunds", async () => {
    await db.setting.create({ data: { key: "memberFunds", value: JSON.stringify({ profitBarbers: ["Jere"] }) } });
    expect((await getMemberFunds(db, "2026-10")).balances.ganancia).toBe(4 * Math.round((16500 - 1500) * 0.4));
  });
});
