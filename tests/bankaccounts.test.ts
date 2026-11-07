import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addExpense } from "../src/services/expenses";
import { getBoxBalance } from "../src/services/closing";
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
  await setServiceCount(db, { actor: admin, date: DAY, userId: ids.ale, serviceType: "CORTE", count: 1, now: NOW }); // 20.000 · Ale se queda con 20.000 − 3.000 = 17.000
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
    expect(by("BRUBANK").expected).toEqual([{ label: "Cortes de Lucio", amount: 60000 }, { label: "Cortes de Ale", amount: 20000 }]); // los de Ale entran a la misma cuenta que los de Lucio
  });

  it("de la cuenta de Ale se le paga a Lucio su 60 % y Ale retira su parte", async () => {
    const ale = (await getBankAccounts(db, "2026-10", NOW)).accounts.find((a) => a.key === "BRUBANK")!;
    expect(ale.payouts).toEqual([
      { label: "Pago a Lucio (su parte de los cortes)", amount: 30600 },
      { label: "Retiro de Ale (su parte de los cortes)", amount: 17000 },
    ]);
    await setDeclared(db, { actor: admin, date: DAY, account: "BRUBANK", amount: 70000, now: NOW });
    const after = (await getBankAccounts(db, "2026-10", NOW)).accounts.find((a) => a.key === "BRUBANK")!;
    expect(after).toMatchObject({ declared: 70000, expectedTotal: 80000, gap: -10000, payoutsTotal: 47600, remaining: 22400 });
  });

  it("los gastos pagados con una cuenta se descuentan de lo que queda; los de efectivo se muestran aparte", async () => {
    const c = await db.expenseConcept.create({ data: { name: "TEST", category: "VARIABLE" } });
    await addExpense(db, { actor: admin, date: DAY, conceptId: c.id, amount: 4000, accountKey: "BRUBANK_JUAN", now: NOW });
    await addExpense(db, { actor: admin, date: DAY, conceptId: c.id, amount: 1500, accountKey: "EFECTIVO", now: NOW });
    const r = await getBankAccounts(db, "2026-10", NOW);
    const j = r.accounts.find((a) => a.key === "BRUBANK_JUAN")!;
    expect(j.payouts).toContainEqual({ label: "Gastos pagados desde esta cuenta", amount: 4000 });
    expect(r.cashExpenses).toBe(1500);
    const before = await getBoxBalance(db);
    const g = await db.expense.findFirstOrThrow({ where: { accountKey: "EFECTIVO" } });
    await db.expense.update({ where: { id: g.id }, data: { deletedAt: new Date() } });
    expect((await getBoxBalance(db)) - before).toBe(1500); // al borrar el gasto, vuelve a la caja
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
    expect(r.accounts[0]!.expectedTotal).toBe(100000); // Jere y Lucio; sin "owner" no hay retiro
  });
});
