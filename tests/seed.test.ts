import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hashPin, verifyPin } from "../src/auth/pin";
import { seedCore } from "../src/seed";
import { addProductPrice, addTariff } from "../src/services/admin";
import { freshDb } from "./helpers/db";

let db: PrismaClient;
beforeEach(() => {
  db = freshDb();
});
afterEach(async () => {
  await db.$disconnect();
});

describe("seed: el dueño es Juan", () => {
  it("en una base vacía crea a Juan como dueño", async () => {
    await seedCore(db);
    const juan = await db.user.findUniqueOrThrow({ where: { username: "juan" } });
    expect(juan).toMatchObject({ name: "Juan", role: "DUENO", isBarber: false });
    expect(await db.user.findUnique({ where: { username: "dueno" } })).toBeNull();
  });

  it("migra el usuario genérico 'dueno' a Juan conservando id y PIN", async () => {
    const legacy = await db.user.create({ data: { username: "dueno", name: "Dueño", role: "DUENO", isBarber: false, pinHash: hashPin("6123") } });
    await seedCore(db);
    const juan = await db.user.findUniqueOrThrow({ where: { username: "juan" } });
    expect(juan.id).toBe(legacy.id);
    expect(juan.name).toBe("Juan");
    expect(verifyPin("6123", juan.pinHash)).toBe(true);
    expect(await db.user.findUnique({ where: { username: "dueno" } })).toBeNull();
    expect(await db.user.count({ where: { role: "DUENO" } })).toBe(1);
  });

  it("es idempotente: correrlo de nuevo no cambia usuarios ni PIN", async () => {
    await db.user.create({ data: { username: "dueno", name: "Dueño", role: "DUENO", isBarber: false, pinHash: hashPin("6123") } });
    await seedCore(db);
    const before = await db.user.findMany({ orderBy: { username: "asc" } });
    await seedCore(db);
    const after = await db.user.findMany({ orderBy: { username: "asc" } });
    expect(after.map((u) => [u.username, u.pinHash])).toEqual(before.map((u) => [u.username, u.pinHash]));
  });
});

describe("seed: es seguro correrlo en cada deploy", () => {
  it("no pisa tarifas, comisiones ni precios que el dueño corrigió, ni toca el stock", async () => {
    await seedCore(db);
    const juan = { id: (await db.user.findUniqueOrThrow({ where: { username: "juan" } })).id, role: "DUENO" as const };
    const now = new Date("2026-10-03T15:00:00Z");
    // El dueño corrige a mano la tarifa y el precio vigentes desde septiembre, la comisión de Lucio y el stock.
    await addTariff(db, { actor: juan, serviceType: "CORTE", validFrom: "2026-09-01", price: 21000, now });
    const coca = await db.product.findUniqueOrThrow({ where: { name: "Coca-Cola" } });
    await addProductPrice(db, { actor: juan, productId: coca.id, validFrom: "2026-09-01", price: 2500, cost: 1500, now });
    await db.product.update({ where: { id: coca.id }, data: { stock: 40 } });
    const lucio = await db.user.findUniqueOrThrow({ where: { username: "jere" } });
    await db.barberRule.update({ where: { userId_validFrom: { userId: lucio.id, validFrom: "2026-09-01" } }, data: { commissionBp: 5500 } });

    await seedCore(db); // el siguiente deploy

    expect((await db.tariff.findFirstOrThrow({ where: { serviceType: "CORTE", validFrom: "2026-09-01" } })).price).toBe(21000);
    expect((await db.productPrice.findFirstOrThrow({ where: { productId: coca.id, validFrom: "2026-09-01" } })).price).toBe(2500);
    expect((await db.barberRule.findFirstOrThrow({ where: { userId: lucio.id, validFrom: "2026-09-01" } })).commissionBp).toBe(5500);
    expect((await db.product.findUniqueOrThrow({ where: { id: coca.id } })).stock).toBe(40);
  });
});
