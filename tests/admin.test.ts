import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { verifyPin } from "../src/auth/pin";
import { priceFor, ruleFor } from "../src/domain/rules";
import { addBarberRule, addProductPrice, addTariff, adjustStock, changeOwnPin, createBarber, createProduct, generatePin, resetPin, setUserActive, updateProductSettings } from "../src/services/admin";
import { loadPricing } from "../src/services/figures";
import { loginWithPin } from "../src/services/auth";
import { DomainError, type Actor } from "../src/services/common";
import { freshDb, seed, type Seed } from "./helpers/db";

const NOW = new Date("2026-10-03T15:00:00Z");
let db: PrismaClient;
let ids: Seed;
let lucio: Actor;
let ale: Actor;
let juan: Actor;

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
  ale = { id: ids.ale, role: "ADMIN" };
  juan = { id: ids.juan, role: "DUENO" };
});
afterEach(async () => {
  await db.$disconnect();
});

describe("PIN", () => {
  it("cada uno cambia su propio PIN con el actual", async () => {
    await changeOwnPin(db, { userId: ids.lucio, current: "1234", next: "7391" });
    expect((await loginWithPin(db, "lucio", "7391", NOW)).id).toBe(ids.lucio);
    expect(await code(loginWithPin(db, "lucio", "1234", NOW))).toBe("CREDENCIALES_INVALIDAS");
    expect(await db.auditLog.count({ where: { entity: "User", action: "UPDATE" } })).toBe(1);
  });

  it("valida el PIN actual, el formato, que sea distinto y que no sea obvio", async () => {
    expect(await code(changeOwnPin(db, { userId: ids.lucio, current: "9999", next: "7391" }))).toBe("PIN_ACTUAL_INCORRECTO");
    expect(await code(changeOwnPin(db, { userId: ids.lucio, current: "1234", next: "12" }))).toBe("PIN_INVALIDO");
    expect(await code(changeOwnPin(db, { userId: ids.lucio, current: "1234", next: "abcd" }))).toBe("PIN_INVALIDO");
    expect(await code(changeOwnPin(db, { userId: ids.lucio, current: "1234", next: "1234" }))).toBe("PIN_IGUAL");
    expect(await code(changeOwnPin(db, { userId: ids.lucio, current: "1234", next: "0000" }))).toBe("PIN_FACIL");
  });

  it("cambiar el PIN destraba una cuenta bloqueada", async () => {
    await db.user.update({ where: { id: ids.lucio }, data: { failedAttempts: 3, lockedUntil: new Date("2099-01-01") } });
    await changeOwnPin(db, { userId: ids.lucio, current: "1234", next: "7391" });
    expect((await loginWithPin(db, "lucio", "7391", NOW)).id).toBe(ids.lucio);
  });

  it("el admin resetea el PIN de un barbero y recibe uno nuevo al azar", async () => {
    const r = await resetPin(db, { actor: ale, targetId: ids.lucio });
    expect(r.pin).toMatch(/^\d{4}$/);
    expect(verifyPin(r.pin, (await db.user.findUniqueOrThrow({ where: { id: ids.lucio } })).pinHash)).toBe(true);
  });

  it("permisos de reseteo: barbero no; admin no al dueño; nadie a sí mismo", async () => {
    expect(await code(resetPin(db, { actor: lucio, targetId: ids.jere }))).toBe("SOLO_ADMIN");
    expect(await code(resetPin(db, { actor: ale, targetId: ids.juan }))).toBe("SOLO_DUENO");
    expect(await code(resetPin(db, { actor: ale, targetId: ids.ale }))).toBe("USAR_MI_PIN");
    expect((await resetPin(db, { actor: juan, targetId: ids.ale })).pin).toMatch(/^\d{4}$/);
  });

  it("los PIN generados no son los obvios", () => {
    for (let i = 0; i < 300; i++) expect(["0000", "1111", "1234", "9999"]).not.toContain(generatePin());
  });
});

describe("equipo y comisiones", () => {
  const rule = { commissionBp: 6000, drinkDeduction: 3000, drinkCost: 3000 };

  it("crea un barbero con su comisión y un PIN inicial", async () => {
    const { user, pin } = await createBarber(db, { actor: ale, name: "Nico", username: " Nico ", validFrom: "2026-10-03", ...rule, now: NOW });
    expect(user).toMatchObject({ username: "nico", role: "BARBERO", isBarber: true, active: true });
    expect((await loginWithPin(db, "nico", pin, NOW)).name).toBe("Nico");
    const { rules } = await loadPricing(db);
    expect(ruleFor(rules.get(user.id)!, "2026-10-03").commissionBp).toBe(6000);
  });

  it("valida nombre, usuario, comisión y duplicados", async () => {
    const base = { actor: ale, name: "Nico", username: "nico", validFrom: "2026-10-03", ...rule, now: NOW };
    expect(await code(createBarber(db, { ...base, name: " " }))).toBe("NOMBRE_OBLIGATORIO");
    expect(await code(createBarber(db, { ...base, username: "Ni co!" }))).toBe("USUARIO_INVALIDO");
    expect(await code(createBarber(db, { ...base, commissionBp: 12000 }))).toBe("COMISION_INVALIDA");
    expect(await code(createBarber(db, { ...base, drinkDeduction: -1 }))).toBe("MONTO_INVALIDO");
    expect(await code(createBarber(db, { ...base, username: "lucio" }))).toBe("USUARIO_EXISTE");
    expect(await code(createBarber(db, { ...base, actor: lucio }))).toBe("SOLO_ADMIN");
  });

  it("una nueva comisión rige desde la fecha y no cambia el historial", async () => {
    await addBarberRule(db, { actor: ale, userId: ids.lucio, validFrom: "2026-11-01", commissionBp: 7000, drinkDeduction: 3000, drinkCost: 3000, now: NOW });
    const { rules } = await loadPricing(db);
    expect(ruleFor(rules.get(ids.lucio)!, "2026-10-31").commissionBp).toBe(6000);
    expect(ruleFor(rules.get(ids.lucio)!, "2026-11-01").commissionBp).toBe(7000);
  });

  it("el admin no puede cambiar el pasado; el dueño sí", async () => {
    const r = { userId: ids.lucio, validFrom: "2026-09-15", commissionBp: 5000, drinkDeduction: 3000, drinkCost: 3000, now: NOW };
    expect(await code(addBarberRule(db, { actor: ale, ...r }))).toBe("VIGENCIA_PASADA");
    await addBarberRule(db, { actor: juan, ...r });
  });

  it("activar y desactivar usuarios, con límites", async () => {
    await setUserActive(db, { actor: ale, userId: ids.lucio, active: false });
    expect(await code(loginWithPin(db, "lucio", "1234", NOW))).toBe("CREDENCIALES_INVALIDAS");
    await setUserActive(db, { actor: ale, userId: ids.lucio, active: true });
    expect(await code(setUserActive(db, { actor: ale, userId: ids.ale, active: false }))).toBe("NO_TE_DESACTIVES");
    expect(await code(setUserActive(db, { actor: ale, userId: ids.juan, active: false }))).toBe("SOLO_DUENO");
    expect(await code(setUserActive(db, { actor: lucio, userId: ids.jere, active: false }))).toBe("SOLO_ADMIN");
  });
});

describe("tarifas", () => {
  it("un precio nuevo rige desde su fecha", async () => {
    await addTariff(db, { actor: ale, serviceType: "CORTE", validFrom: "2026-11-01", price: 23000, now: NOW });
    const { tariffs } = await loadPricing(db);
    expect(priceFor(tariffs, "CORTE", "2026-10-31")).toBe(20000);
    expect(priceFor(tariffs, "CORTE", "2026-11-01")).toBe(23000);
  });
  it("valida precio, servicio y fecha", async () => {
    expect(await code(addTariff(db, { actor: ale, serviceType: "CORTE", validFrom: "2026-11-01", price: 0, now: NOW }))).toBe("PRECIO_INVALIDO");
    expect(await code(addTariff(db, { actor: ale, serviceType: "PEINADO" as never, validFrom: "2026-11-01", price: 5000, now: NOW }))).toBe("SERVICIO_INVALIDO");
    expect(await code(addTariff(db, { actor: ale, serviceType: "CORTE", validFrom: "01/11/2026", price: 5000, now: NOW }))).toBe("FECHA_INVALIDA");
    expect(await code(addTariff(db, { actor: ale, serviceType: "CORTE", validFrom: "2026-09-01", price: 5000, now: NOW }))).toBe("VIGENCIA_PASADA");
    expect(await code(addTariff(db, { actor: lucio, serviceType: "CORTE", validFrom: "2026-11-01", price: 5000, now: NOW }))).toBe("SOLO_ADMIN");
  });
});

describe("productos y stock", () => {
  async function mk() {
    return createProduct(db, { actor: ale, name: "Coca-Cola", kind: "BEBIDA", price: 1700, cost: 1183, stock: 24, minStock: 6, validFrom: "2026-10-03", now: NOW });
  }
  it("crea un producto con stock real y precio vigente", async () => {
    const p = await mk();
    expect(p.stock).toBe(24);
    expect(await db.productPrice.count({ where: { productId: p.id } })).toBe(1);
    expect(await code(mk())).toBe("PRODUCTO_EXISTE");
  });
  it("valida tipo y montos", async () => {
    const base = { actor: ale, name: "X", kind: "BEBIDA", price: 1, cost: 1, stock: 1, minStock: 0, validFrom: "2026-10-03", now: NOW };
    expect(await code(createProduct(db, { ...base, kind: "ROPA" }))).toBe("TIPO_INVALIDO");
    expect(await code(createProduct(db, { ...base, price: -5 }))).toBe("MONTO_INVALIDO");
    expect(await code(createProduct(db, { ...base, name: " " }))).toBe("NOMBRE_OBLIGATORIO");
  });
  it("corregir el stock (conteo) o sumar una compra, siempre con motivo y registro", async () => {
    const p = await mk();
    expect(await adjustStock(db, { actor: ale, productId: p.id, mode: "SET", quantity: 10, reason: "Conteo inicial" })).toEqual({ before: 24, after: 10 });
    expect(await adjustStock(db, { actor: ale, productId: p.id, mode: "ADD", quantity: 48, reason: "Compra" })).toEqual({ before: 10, after: 58 });
    expect(await adjustStock(db, { actor: ale, productId: p.id, mode: "ADD", quantity: -3, reason: "Se rompieron" })).toEqual({ before: 58, after: 55 });
    expect(await code(adjustStock(db, { actor: ale, productId: p.id, mode: "SET", quantity: 5, reason: " " }))).toBe("MOTIVO_OBLIGATORIO");
    expect(await code(adjustStock(db, { actor: ale, productId: p.id, mode: "SET", quantity: -5, reason: "x" }))).toBe("CANTIDAD_INVALIDA");
    expect(await code(adjustStock(db, { actor: lucio, productId: p.id, mode: "SET", quantity: 5, reason: "x" }))).toBe("SOLO_ADMIN");
    expect(await db.auditLog.count({ where: { entity: "Product", action: "UPDATE" } })).toBe(3);
  });
  it("precio nuevo con vigencia, mínimo y baja", async () => {
    const p = await mk();
    await addProductPrice(db, { actor: ale, productId: p.id, validFrom: "2026-11-01", price: 2000, cost: 1300, now: NOW });
    expect(await db.productPrice.count({ where: { productId: p.id } })).toBe(2);
    await updateProductSettings(db, { actor: ale, productId: p.id, minStock: 12, active: false });
    expect(await db.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ minStock: 12, active: false });
    expect(await code(updateProductSettings(db, { actor: ale, productId: p.id, minStock: -1 }))).toBe("CANTIDAD_INVALIDA");
  });
});
