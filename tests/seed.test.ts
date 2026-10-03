import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { hashPin, verifyPin } from "../src/auth/pin";
import { seedCore } from "../src/seed";
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
