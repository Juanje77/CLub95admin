import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getBankAccounts } from "../src/services/bankaccounts";
import { setDeclared, setProductCount, setServiceCount } from "../src/services/grid";
import { createMember, registerPayment } from "../src/services/members";
import type { Actor } from "../src/services/common";
import { freshDb, seed, type Seed } from "./helpers/db";

const NOW = new Date("2026-10-03T23:45:00Z");
const DAY = "2026-10-03";
let db: PrismaClient;
let ids: Seed;
let admin: Actor;

beforeEach(async () => {
  db = freshDb();
  ids = await seed(db);
  admin = { id: ids.ale, role: "ADMIN" };
  await db.paymentAccount.create({ data: { key: "BRUBANK_JUAN", name: "Brubank Juan", kind: "TRANSFERENCIA" } });
  const coca = await db.product.create({ data: { name: "Coca-Cola", kind: "BEBIDA", stock: 10, minStock: 3 } });
  await db.productPrice.create({ data: { productId: coca.id, validFrom: "2026-09-01", price: 1700, cost: 1183 } });
  const cera = await db.product.create({ data: { name: "Cera 1", kind: "CERA", stock: 5 } });
  await db.productPrice.create({ data: { productId: cera.id, validFrom: "2026-09-01", price: 25000, cost: 13000 } });

  await setServiceCount(db, { actor: admin, date: DAY, userId: ids.jere, serviceType: "CORTE", count: 2, now: NOW }); // 40.000
  await setServiceCount(db, { actor: admin, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 3, now: NOW }); // 60.000 · Lucio cobra (20.000 − 3.000) × 60 % = 10.200 por corte
  await setProductCount(db, { actor: admin, date: DAY, productId: coca.id, count: 2, now: NOW }); // 3.400
  await setProductCount(db, { actor: admin, date: DAY, productId: cera.id, count: 1, now: NOW }); // 25.000
  const socio = await createMember(db, { actor: admin, name: "Socio", serviceType: "CORTE", userId: ids.jere, price: 16500, startDate: "2026-09-01", now: NOW });
  await registerPayment(db, { actor: admin, memberId: socio.id, date: "2026-10-02", amount: 30000, method: "BANCO", now: NOW });
  await registerPayment(db, { actor: admin, memberId: socio.id, date: "2026-10-02", amount: 7000, method: "EFECTIVO", now: NOW }); // en efectivo: no entra a ninguna cuenta
});
afterEach(async () => {
  await db.$disconnect();
});

describe("cuentas bancarias: por dónde entra la plata", () => {
  it("la cuenta de Juan junta socios por transferencia, bebidas y ceras; la de Jere sus cortes; la de Ale los cortes de Lucio", async () => {
    const r = await getBankAccounts(db, "2026-10", NOW);
    const by = (k: string) => r.accounts.find((a) => a.key === k)!;
    expect(by("BRUBANK_JUAN").expected).toEqual([
      { label: "Socios que pagaron por transferencia", amount: 30000 },
      { label: "Venta de bebidas", amount: 3400 },
      { label: "Venta de ceras, polvos y aceites", amount: 25000 },
    ]);
    expect(by("BRUBANK_JUAN").expectedTotal).toBe(58400);
    expect(by("MP_JERE").expected).toEqual([{ label: "Cortes de Jere", amount: 40000 }]);
    expect(by("BRUBANK").expected).toEqual([{ label: "Cortes de Lucio", amount: 60000 }]);
  });

  it("de la cuenta de Ale se le paga a Lucio su 60 %", async () => {
    const ale = (await getBankAccounts(db, "2026-10", NOW)).accounts.find((a) => a.key === "BRUBANK")!;
    expect(ale.payouts).toEqual([{ label: "Pago a Lucio (su parte de los cortes)", amount: 30600 }]);
    await setDeclared(db, { actor: admin, date: DAY, account: "BRUBANK", amount: 50000, now: NOW });
    const after = (await getBankAccounts(db, "2026-10", NOW)).accounts.find((a) => a.key === "BRUBANK")!;
    expect(after).toMatchObject({ declared: 50000, gap: -10000, payoutsTotal: 30600, remaining: 19400 });
  });

  it("lo ingresado de cada día se compara con lo esperado: la diferencia es lo que se pagó en efectivo", async () => {
    await setDeclared(db, { actor: admin, date: DAY, account: "MP_JERE", amount: 30000, now: NOW });
    await setDeclared(db, { actor: admin, date: DAY, account: "BRUBANK_JUAN", amount: 58400, now: NOW });
    await setDeclared(db, { actor: admin, date: DAY, account: "EFECTIVO", amount: 12000, now: NOW });
    const r = await getBankAccounts(db, "2026-10", NOW);
    expect(r.accounts.find((a) => a.key === "MP_JERE")).toMatchObject({ declared: 30000, gap: -10000 });
    expect(r.accounts.find((a) => a.key === "BRUBANK_JUAN")).toMatchObject({ declared: 58400, gap: 0 });
    expect(r.cashDeclared).toBe(12000);
  });

  it("otro mes empieza en cero y el recorrido se puede cambiar en la configuración", async () => {
    expect((await getBankAccounts(db, "2026-09", NOW)).accounts.every((a) => a.expectedTotal === 0 || a.key === "BRUBANK_JUAN")).toBe(true);
    await db.setting.create({ data: { key: "accountRouting", value: JSON.stringify([{ key: "BRUBANK", who: "Ale", barbers: ["jere", "lucio"] }]) } });
    const r = await getBankAccounts(db, "2026-10", NOW);
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0]!.expectedTotal).toBe(100000);
  });
});
