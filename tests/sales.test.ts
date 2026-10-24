import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hashPin } from "../src/auth/pin";
import { closeDay, reopenDay } from "../src/services/closing";
import { addMembershipVisit, addProductSale, addServiceSale, undoLastSale } from "../src/services/sales";
import { getDayFigures } from "../src/services/figures";
import { LOCK_MINUTES, loginWithPin, MAX_FAILED_ATTEMPTS } from "../src/services/auth";
import { DomainError, type Actor } from "../src/services/common";
import { freshDb, seed, type Seed } from "./helpers/db";

const NOW = new Date("2026-10-03T23:45:00Z"); // sábado 3/10, 20:45 BA
const DAY = "2026-10-03";

let db: PrismaClient;
let ids: Seed;
let lucio: Actor;
let admin: Actor;
let cocaId: string;

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
  lucio = { id: ids.lucio, role: "BARBERO" };
  admin = { id: ids.ale, role: "ADMIN" };
  const coca = await db.product.create({ data: { name: "Coca-Cola", kind: "BEBIDA", stock: 10, minStock: 3 } });
  await db.productPrice.create({ data: { productId: coca.id, validFrom: "2026-09-01", price: 1700, cost: 1183 } });
  cocaId = coca.id;
});
afterEach(async () => {
  await db.$disconnect();
});

describe("carga de servicios", () => {
  it("usa la tarifa vigente y el medio de pago elegido", async () => {
    const s = await addServiceSale(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE_BARBA", paymentMethod: "TRANSFERENCIA", now: NOW });
    expect(s).toMatchObject({ unitPrice: 22000, paymentMethod: "TRANSFERENCIA", kind: "SERVICE", source: "APP", drinkIncluded: true });
    expect(await db.auditLog.count({ where: { entity: "Sale", action: "CREATE" } })).toBe(1);
  });

  it("rechaza medios de pago inválidos", async () => {
    expect(await code(addServiceSale(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", paymentMethod: "CHEQUE", now: NOW }))).toBe("MEDIO_DE_PAGO_INVALIDO");
  });

  it("un barbero no carga ventas de otro ni de días pasados; el admin sí", async () => {
    expect(await code(addServiceSale(db, { actor: lucio, date: DAY, userId: ids.jere, serviceType: "CORTE", paymentMethod: "EFECTIVO", now: NOW }))).toBe("SOLO_PROPIO");
    expect(await code(addServiceSale(db, { actor: lucio, date: "2026-10-02", userId: ids.lucio, serviceType: "CORTE", paymentMethod: "EFECTIVO", now: NOW }))).toBe("DIA_PASADO_REQUIERE_ADMIN");
    const s = await addServiceSale(db, { actor: admin, date: "2026-10-02", userId: ids.jere, serviceType: "CORTE", paymentMethod: "EFECTIVO", now: NOW });
    expect(s.date).toBe("2026-10-02");
  });

  it("no carga en un día futuro", async () => {
    expect(await code(addServiceSale(db, { actor: admin, date: "2026-10-04", userId: ids.jere, serviceType: "CORTE", paymentMethod: "EFECTIVO", now: NOW }))).toBe("FECHA_FUTURA");
  });

  it("no carga ni deshace con la caja cerrada; al reabrir, sí", async () => {
    await addServiceSale(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", paymentMethod: "TRANSFERENCIA", now: NOW });
    await closeDay(db, { date: DAY, actor: lucio, declaredCash: 0, declaredTransfers: 20000, changeLeft: 5000, now: NOW });
    expect(await code(addServiceSale(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", paymentMethod: "TRANSFERENCIA", now: NOW }))).toBe("DIA_CERRADO");
    expect(await code(undoLastSale(db, { actor: lucio, date: DAY, now: NOW }))).toBe("DIA_CERRADO");
    await reopenDay(db, { date: DAY, actor: admin, reason: "Faltó cargar un corte", now: NOW });
    const s = await addServiceSale(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", paymentMethod: "EFECTIVO", now: NOW });
    expect(s.id).toBeTruthy();
  });

  it("el flujo completo: cargar, deshacer, cerrar sin diferencia", async () => {
    await addServiceSale(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", paymentMethod: "TRANSFERENCIA", now: NOW });
    await addServiceSale(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "BARBA_CEJAS", paymentMethod: "EFECTIVO", now: NOW });
    await addServiceSale(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", paymentMethod: "EFECTIVO", now: NOW }); // error de tipeo
    const undone = await undoLastSale(db, { actor: lucio, date: DAY, now: NOW });
    expect(undone.serviceType).toBe("CORTE");
    const f = await getDayFigures(db, DAY);
    expect(f).toMatchObject({ salesCount: 2, expectedIncome: 35000, expectedCash: 15000, expectedTransfers: 20000 });
    const r = await closeDay(db, { date: DAY, actor: lucio, declaredCash: 15000, declaredTransfers: 20000, changeLeft: 6000, now: NOW });
    expect(r.close.difference).toBe(0);
  });
});

describe("deshacer", () => {
  it("deshace la última y deja la baja registrada", async () => {
    const a = await addServiceSale(db, { actor: lucio, date: DAY, userId: ids.lucio, serviceType: "CORTE", paymentMethod: "TRANSFERENCIA", now: NOW });
    const row = await undoLastSale(db, { actor: lucio, date: DAY, now: NOW });
    expect(row.id).toBe(a.id);
    expect((await db.sale.findUniqueOrThrow({ where: { id: a.id } })).deletedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { entity: "Sale", action: "DELETE" } })).toBe(1);
    expect(await code(undoLastSale(db, { actor: lucio, date: DAY, now: NOW }))).toBe("NADA_PARA_DESHACER");
  });

  it("un barbero solo deshace lo suyo", async () => {
    await addServiceSale(db, { actor: admin, date: DAY, userId: ids.jere, serviceType: "CORTE", paymentMethod: "TRANSFERENCIA", now: NOW });
    expect(await code(undoLastSale(db, { actor: lucio, date: DAY, now: NOW }))).toBe("NADA_PARA_DESHACER");
  });
});

describe("membresías y productos", () => {
  it("la visita de un socio no suma ingresos a la caja", async () => {
    await addMembershipVisit(db, { actor: lucio, date: DAY, userId: ids.lucio, now: NOW });
    const f = await getDayFigures(db, DAY);
    expect(f.expectedIncome).toBe(0);
    expect(f.salesCount).toBe(1);
  });

  it("vender un producto descuenta stock y deshacer lo devuelve", async () => {
    await addProductSale(db, { actor: lucio, date: DAY, userId: ids.lucio, productId: cocaId, quantity: 2, paymentMethod: "EFECTIVO", now: NOW });
    expect((await db.product.findUniqueOrThrow({ where: { id: cocaId } })).stock).toBe(8);
    expect((await getDayFigures(db, DAY)).expectedIncome).toBe(3400);
    await undoLastSale(db, { actor: lucio, date: DAY, now: NOW });
    expect((await db.product.findUniqueOrThrow({ where: { id: cocaId } })).stock).toBe(10);
  });

  it("rechaza cantidades inválidas y productos sin precio vigente", async () => {
    expect(await code(addProductSale(db, { actor: lucio, date: DAY, userId: ids.lucio, productId: cocaId, quantity: 0, paymentMethod: "EFECTIVO", now: NOW }))).toBe("CANTIDAD_INVALIDA");
    expect(await code(addProductSale(db, { actor: admin, date: "2026-08-01", userId: null, productId: cocaId, paymentMethod: "EFECTIVO", now: NOW }))).toBe("SIN_PRECIO");
  });
});

describe("login por PIN", () => {
  beforeEach(async () => {
    await db.user.update({ where: { id: ids.lucio }, data: { pinHash: hashPin("4444") } });
  });

  it("entra con usuario y PIN correctos (sin distinguir mayúsculas en el usuario)", async () => {
    const u = await loginWithPin(db, " Lucio ", "4444", NOW);
    expect(u).toMatchObject({ id: ids.lucio, role: "BARBERO", name: "Lucio" });
  });

  it("no revela si falló el usuario o el PIN", async () => {
    expect(await code(loginWithPin(db, "lucio", "0000", NOW))).toBe("CREDENCIALES_INVALIDAS");
    expect(await code(loginWithPin(db, "nadie", "4444", NOW))).toBe("CREDENCIALES_INVALIDAS");
  });

  it("se bloquea tras varios intentos y se destraba pasado el tiempo", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await code(loginWithPin(db, "lucio", "0000", NOW));
    expect(await code(loginWithPin(db, "lucio", "4444", NOW))).toBe("CUENTA_BLOQUEADA");
    const later = new Date(NOW.getTime() + (LOCK_MINUTES + 1) * 60000);
    expect((await loginWithPin(db, "lucio", "4444", later)).id).toBe(ids.lucio);
  });

  it("un usuario inactivo no entra", async () => {
    await db.user.update({ where: { id: ids.lucio }, data: { active: false } });
    expect(await code(loginWithPin(db, "lucio", "4444", NOW))).toBe("CREDENCIALES_INVALIDAS");
  });
});
