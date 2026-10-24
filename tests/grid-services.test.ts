import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addWithdrawal, getBoxBalance, reopenDay } from "../src/services/closing";
import { closeDayFromGrid, getMonthGrid, monthDates, setChangeLeft, setDeclared, setMembershipCount, setProductCount, setServiceCount } from "../src/services/grid";
import { getDayCoverage } from "../src/services/figures";
import { syncAlerts } from "../src/services/alerts";
import { DomainError, type Actor } from "../src/services/common";
import { freshDb, sale, seed, type Seed } from "./helpers/db";

// Sábado 3/10/2026, 20:45 en Buenos Aires.
const NOW = new Date("2026-10-03T23:45:00Z");
const DAY = "2026-10-03";

let db: PrismaClient;
let ids: Seed;
let lucio: Actor;
let jere: Actor;
let admin: Actor;
let cocaId: string;
let ceraId: string;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return null;
};
const grid = async () => (await getMonthGrid(db, "2026-10", NOW)).days.find((d) => d.date === DAY)!;

beforeEach(async () => {
  db = freshDb();
  ids = await seed(db);
  lucio = { id: ids.lucio, role: "BARBERO" };
  jere = { id: ids.jere, role: "BARBERO" };
  admin = { id: ids.ale, role: "ADMIN" };
  const coca = await db.product.create({ data: { name: "Coca-Cola", kind: "BEBIDA", stock: 10, minStock: 3 } });
  await db.productPrice.create({ data: { productId: coca.id, validFrom: "2026-09-01", price: 1700, cost: 1183 } });
  const cera = await db.product.create({ data: { name: "Cera 1", kind: "CERA", stock: 5 } });
  await db.productPrice.create({ data: { productId: cera.id, validFrom: "2026-09-01", price: 25000, cost: 13000 } });
  cocaId = coca.id;
  ceraId = cera.id;
});
afterEach(async () => {
  await db.$disconnect();
});

describe("cargar la cantidad de servicios", () => {
  it("guarda una fila agregada por celda y la actualiza en el lugar", async () => {
    await setServiceCount(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 3, now: NOW });
    await setServiceCount(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 5, now: NOW });
    const rows = await db.sale.findMany({ where: { deletedAt: null, serviceType: "CORTE" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 5, unitPrice: 20000, source: "GRID", paymentMethod: null });
  });

  it("poner 0 da de baja la celda y repetir el mismo número no hace nada", async () => {
    await setServiceCount(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 2, now: NOW });
    const same = await setServiceCount(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 2, now: NOW });
    expect(same.changed).toBe(false);
    await setServiceCount(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 0, now: NOW });
    expect(await db.sale.count({ where: { deletedAt: null } })).toBe(0);
    expect(await db.auditLog.count({ where: { entity: "SaleCell" } })).toBe(2);
  });

  it("si la celda tenía ventas cargadas de otra forma, la reemplaza por el total nuevo", async () => {
    await sale(db, { date: DAY, userId: ids.lucio, serviceType: "CORTE", quantity: 2, unitPrice: 20000, paymentMethod: "EFECTIVO" });
    await setServiceCount(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 3, now: NOW });
    const live = await db.sale.findMany({ where: { deletedAt: null } });
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ quantity: 3, source: "GRID" });
    expect(await db.sale.count({ where: { deletedAt: { not: null } } })).toBe(1);
  });

  it("rechaza cantidades inválidas", async () => {
    for (const count of [-1, 1.5, 1000, Number.NaN]) {
      expect(await code(setServiceCount(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", count, now: NOW }))).toBe("CANTIDAD_INVALIDA");
    }
  });

  it("permisos: cada barbero carga lo suyo y solo hoy; el admin carga todo", async () => {
    expect(await code(setServiceCount(db, { actor: lucio, date: DAY, userId: ids.jere, serviceType: "CORTE", count: 1, now: NOW }))).toBe("SOLO_PROPIO");
    expect(await code(setServiceCount(db, { actor: lucio, date: "2026-10-02", userId: ids.lucio, serviceType: "CORTE", count: 1, now: NOW }))).toBe("DIA_PASADO_REQUIERE_ADMIN");
    await setServiceCount(db, { actor: admin, date: "2026-10-02", userId: ids.jere, serviceType: "CORTE", count: 4, now: NOW });
    expect(await code(setServiceCount(db, { actor: admin, date: "2026-10-04", userId: ids.jere, serviceType: "CORTE", count: 1, now: NOW }))).toBe("FECHA_FUTURA");
  });

  it("no hay tarifa antes de su vigencia", async () => {
    expect(await code(setServiceCount(db, { actor: admin, date: "2026-08-10", userId: ids.jere, serviceType: "CORTE", count: 1, now: NOW }))).toBe("SIN_TARIFA");
  });
});

describe("bebidas, ceras y socios por cantidad", () => {
  it("las ventas descuentan stock y corregir el número lo devuelve", async () => {
    await setProductCount(db, { actor: lucio, date: DAY, productId: cocaId, count: 3, now: NOW });
    expect((await db.product.findUniqueOrThrow({ where: { id: cocaId } })).stock).toBe(7);
    await setProductCount(db, { actor: lucio, date: DAY, productId: cocaId, count: 1, now: NOW });
    expect((await db.product.findUniqueOrThrow({ where: { id: cocaId } })).stock).toBe(9);
    await setProductCount(db, { actor: lucio, date: DAY, productId: cocaId, count: 0, now: NOW });
    expect((await db.product.findUniqueOrThrow({ where: { id: cocaId } })).stock).toBe(10);
  });

  it("los socios se cuentan por barbero y no suman ingresos", async () => {
    await setMembershipCount(db, { actor: lucio, date: DAY, userId: ids.lucio, count: 2, now: NOW });
    const d = await grid();
    expect(d.memberships[ids.lucio]).toBe(2);
    expect(d.result.income).toBe(0);
  });

  it("rechaza productos inexistentes", async () => {
    expect(await code(setProductCount(db, { actor: lucio, date: DAY, productId: "nope", count: 1, now: NOW }))).toBe("PRODUCTO_INVALIDO");
  });
});

describe("la grilla del mes", () => {
  it("tiene una columna por día del mes", () => {
    expect(monthDates("2026-10")).toHaveLength(31);
    expect(monthDates("2026-02")).toHaveLength(28);
  });

  it("calcula ingresos, mano de obra, dinero que debe haber y ganancia del día", async () => {
    await setServiceCount(db, { actor: admin, date: DAY, userId: ids.jere, serviceType: "CORTE", count: 2, now: NOW });
    await setServiceCount(db, { actor: admin, date: DAY, userId: ids.ale, serviceType: "CORTE", count: 1, now: NOW });
    await setServiceCount(db, { actor: admin, date: DAY, userId: ids.lucio, serviceType: "CORTE_BARBA", count: 1, now: NOW });
    await setProductCount(db, { actor: admin, date: DAY, productId: cocaId, count: 1, now: NOW });
    await setProductCount(db, { actor: admin, date: DAY, productId: ceraId, count: 1, now: NOW });
    const d = await grid();
    expect(d.result.income).toBe(108700);
    expect(d.result.labor).toBe(50600);
    expect(d.result.expectedNet).toBe(58100);
    expect(d.result.profit.total).toBe(34917);
    expect(d.services[ids.jere]).toEqual({ CORTE: 2 });
    expect(d.products[ceraId]).toBe(1);
  });

  it("muestra a los barberos activos y a los inactivos que tuvieron actividad en el mes", async () => {
    const beni = await db.user.create({ data: { username: "beni", name: "Beni", role: "BARBERO", isBarber: true, active: false } });
    await db.barberRule.create({ data: { userId: beni.id, validFrom: "2026-09-01", commissionBp: 6000, drinkDeduction: 3000, drinkCost: 3000 } });
    expect((await getMonthGrid(db, "2026-10", NOW)).barbers.map((b) => b.name)).not.toContain("Beni");
    await sale(db, { date: "2026-10-01", userId: beni.id, serviceType: "CORTE", unitPrice: 20000, paymentMethod: null });
    expect((await getMonthGrid(db, "2026-10", NOW)).barbers.map((b) => b.name)).toContain("Beni");
  });

  it("un día sin regla de comisión no rompe la grilla: queda marcado con el error", async () => {
    const nuevo = await db.user.create({ data: { username: "nuevo", name: "Nuevo", role: "BARBERO", isBarber: true } });
    await setServiceCount(db, { actor: admin, date: DAY, userId: nuevo.id, serviceType: "CORTE", count: 1, now: NOW });
    const d = await grid();
    expect(d.error).toContain("regla");
    expect(d.result.income).toBe(0);
  });
});

describe("dinero ingresado y cierre del día", () => {
  async function loadSales() {
    await setServiceCount(db, { actor: admin, date: DAY, userId: ids.jere, serviceType: "CORTE", count: 3, now: NOW });
    await setServiceCount(db, { actor: admin, date: DAY, userId: ids.lucio, serviceType: "CORTE_BARBA", count: 1, now: NOW });
  } // ingresos $ 82.000, mano de obra $ 33.300 + $ 11.400 = $ 44.700

  it("cargar efectivo, Brubank y MP arma el cierre en borrador y calcula la diferencia", async () => {
    await loadSales();
    await setDeclared(db, { actor: lucio, date: DAY, account: "EFECTIVO", amount: 12000, now: NOW });
    await setDeclared(db, { actor: lucio, date: DAY, account: "BRUBANK", amount: 40000, now: NOW });
    await setDeclared(db, { actor: lucio, date: DAY, account: "MP_JERE", amount: 30000, now: NOW });
    await setChangeLeft(db, { actor: lucio, date: DAY, amount: 6000, now: NOW });
    const d = await grid();
    expect(d.declared).toEqual({ EFECTIVO: 12000, BRUBANK: 40000, MP_JERE: 30000 });
    expect(d.totalDeclared).toBe(82000);
    expect(d.difference).toBe(0);
    expect(d.changeLeft).toBe(6000);
    expect(d.closed).toBe(false);
  });

  it("cerrar con todo cuadrado: queda cerrada y el efectivo suma a la fila acumulada", async () => {
    await loadSales();
    await setDeclared(db, { actor: lucio, date: DAY, account: "EFECTIVO", amount: 12000, now: NOW });
    await setDeclared(db, { actor: lucio, date: DAY, account: "BRUBANK", amount: 70000, now: NOW });
    const r = await closeDayFromGrid(db, { actor: lucio, date: DAY, now: NOW });
    expect(r.close).toMatchObject({ status: "CLOSED", difference: 0, declaredCash: 12000, declaredTransfers: 70000 });
    expect(await getBoxBalance(db)).toBe(12000);
    expect((await grid()).closed).toBe(true);
  });

  it("con diferencia exige nota; sin ventas cargadas por medio de pago no hace falta separar efectivo y transferencias", async () => {
    await loadSales();
    await setDeclared(db, { actor: lucio, date: DAY, account: "BRUBANK", amount: 60000, now: NOW });
    expect(await code(closeDayFromGrid(db, { actor: lucio, date: DAY, now: NOW }))).toBe("NOTA_OBLIGATORIA");
    const r = await closeDayFromGrid(db, { actor: lucio, date: DAY, note: "Faltan 22.000 que se transfieren mañana", now: NOW });
    expect(r.close.difference).toBe(-22000);
  });

  it("cerrado, no se editan ni cantidades ni dinero; reabrir lo habilita", async () => {
    await loadSales();
    await setDeclared(db, { actor: lucio, date: DAY, account: "BRUBANK", amount: 82000, now: NOW });
    await closeDayFromGrid(db, { actor: lucio, date: DAY, now: NOW });
    expect(await code(setServiceCount(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 1, now: NOW }))).toBe("DIA_CERRADO");
    expect(await code(setDeclared(db, { actor: lucio, date: DAY, account: "BRUBANK", amount: 1, now: NOW }))).toBe("DIA_CERRADO");
    expect(await code(setChangeLeft(db, { actor: lucio, date: DAY, amount: 1, now: NOW }))).toBe("DIA_CERRADO");
    await reopenDay(db, { date: DAY, actor: admin, reason: "Faltó un corte", now: NOW });
    await setServiceCount(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 1, now: NOW });
  });

  it("valida montos y cuentas", async () => {
    expect(await code(setDeclared(db, { actor: lucio, date: DAY, account: "BRUBANK", amount: -5, now: NOW }))).toBe("MONTO_INVALIDO");
    expect(await code(setDeclared(db, { actor: lucio, date: DAY, account: "NO_EXISTE", amount: 5, now: NOW }))).toBe("CUENTA_INVALIDA");
  });
});

describe("retiros en efectivo: el banco primero (sobre el total del día)", () => {
  async function dayWithLabor() {
    // Jere 3 cortes ($ 33.300) + Lucio 1 corte ($ 10.200) = $ 43.500 de mano de obra.
    await setServiceCount(db, { actor: admin, date: DAY, userId: ids.jere, serviceType: "CORTE", count: 3, now: NOW });
    await setServiceCount(db, { actor: admin, date: DAY, userId: ids.lucio, serviceType: "CORTE", count: 1, now: NOW });
  }
  const cov = async (id: string) => (await getDayCoverage(db, DAY)).find((c) => c.barberId === id)!;

  it("mientras no se cargó el dinero del día no se sabe qué cubrió el banco: no hay excepciones", async () => {
    await dayWithLabor();
    expect(await cov(ids.lucio)).toMatchObject({ labor: 10200, cashAllowed: 10200 });
    await addWithdrawal(db, { date: DAY, actor: lucio, userId: ids.lucio, amount: 10200 });
  });

  it("si el banco cubre toda la mano de obra, retirar efectivo exige motivo", async () => {
    await dayWithLabor();
    await setDeclared(db, { actor: admin, date: DAY, account: "BRUBANK", amount: 60000, now: NOW });
    expect(await cov(ids.jere)).toMatchObject({ labor: 33300, cashAllowed: 0 });
    expect(await code(addWithdrawal(db, { date: DAY, actor: jere, userId: ids.jere, amount: 5000 }))).toBe("RETIRO_EN_EFECTIVO_SIN_MOTIVO");
    const r = await addWithdrawal(db, { date: DAY, actor: jere, userId: ids.jere, amount: 5000, note: "Pidió efectivo" });
    expect(r.coverage.excess).toBe(5000);
  });

  it("si el banco no alcanza, el faltante se reparte en proporción a lo que le toca a cada uno", async () => {
    await dayWithLabor();
    await setDeclared(db, { actor: admin, date: DAY, account: "BRUBANK", amount: 20000, now: NOW });
    // faltante = 43.500 − 20.000 = 23.500
    expect((await cov(ids.lucio)).cashAllowed).toBe(5510);
    expect((await cov(ids.jere)).cashAllowed).toBe(17989);
    await addWithdrawal(db, { date: DAY, actor: lucio, userId: ids.lucio, amount: 5510 });
    expect(await code(addWithdrawal(db, { date: DAY, actor: lucio, userId: ids.lucio, amount: 1 }))).toBe("RETIRO_EN_EFECTIVO_SIN_MOTIVO");
  });

  it("deja una alerta para el admin cuando hubo un retiro fuera de la regla", async () => {
    await db.setting.create({ data: { key: "alerts", value: JSON.stringify({ startDate: DAY }) } });
    await dayWithLabor();
    await addWithdrawal(db, { date: DAY, actor: admin, userId: ids.jere, amount: 5000 }); // antes de cargar el banco: permitido
    await setDeclared(db, { actor: admin, date: DAY, account: "BRUBANK", amount: 60000, now: NOW });
    const a = await syncAlerts(db, { now: new Date("2026-10-03T18:00:00Z") });
    const w = a.find((x) => x.code === "RETIRO_EFECTIVO_EXCEDE")!;
    expect(w.audience).toEqual(["ADMIN", "DUENO"]);
    expect(w.message).toContain("Jere retiró $ 5.000");
  });
});
