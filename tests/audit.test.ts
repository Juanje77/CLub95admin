import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { actionLabel, entityLabel, listAudit, summarize } from "../src/services/audit-view";
import { addTariff, changeOwnPin, resetPin } from "../src/services/admin";
import { setServiceCount } from "../src/services/grid";
import { type Actor } from "../src/services/common";
import { freshDb, seed, type Seed } from "./helpers/db";

const NOW = new Date("2026-10-03T15:00:00Z");
let db: PrismaClient;
let ids: Seed;
let ale: Actor;

beforeEach(async () => {
  db = freshDb();
  ids = await seed(db);
  ale = { id: ids.ale, role: "ADMIN" };
});
afterEach(async () => {
  await db.$disconnect();
});

describe("visor de auditoría", () => {
  it("muestra quién hizo qué, con los nombres y lo más reciente primero", async () => {
    await setServiceCount(db, { actor: ale, date: "2026-10-03", userId: ids.jere, serviceType: "CORTE", count: 3, now: NOW });
    await addTariff(db, { actor: ale, serviceType: "CORTE", validFrom: "2026-11-01", price: 23000, now: NOW });
    const rows = await listAudit(db);
    expect(rows.map((r) => [r.user, r.entity, r.action])).toEqual([["Ale", "Tariff", "CREATE"], ["Ale", "SaleCell", "UPDATE"]]);
    expect(rows[1]!.detail).toBe("count: 0  →  count: 3");
    expect(entityLabel("SaleCell")).toBe("Cantidad en la planilla");
    expect(actionLabel("REOPEN")).toBe("Reabrió");
  });

  it("filtra por qué y por quién", async () => {
    await setServiceCount(db, { actor: ale, date: "2026-10-03", userId: ids.jere, serviceType: "CORTE", count: 1, now: NOW });
    await setServiceCount(db, { actor: { id: ids.jere, role: "BARBERO" }, date: "2026-10-03", userId: ids.jere, serviceType: "CORTE_BARBA", count: 2, now: NOW });
    expect((await listAudit(db, { userId: ids.jere })).map((r) => r.user)).toEqual(["Jere"]);
    expect(await listAudit(db, { entity: "Tariff" })).toEqual([]);
    expect((await listAudit(db, { entity: "SaleCell" })).length).toBe(2);
  });

  it("nunca muestra PIN ni hashes, ni siquiera el hecho de que se reseteó con su valor", async () => {
    await changeOwnPin(db, { userId: ids.lucio, current: "1234", next: "7391" });
    await resetPin(db, { actor: ale, targetId: ids.jere });
    const all = JSON.stringify(await listAudit(db));
    expect(all).not.toContain("7391");
    expect(all).not.toMatch(/scrypt\$/);
    expect(summarize(null, JSON.stringify({ pinHash: "scrypt$a$b", pin: "1234", nombre: "x" }))).toBe("nombre: x");
  });

  it("pagina hacia atrás y tolera detalles rotos", async () => {
    for (let i = 1; i <= 3; i++) await setServiceCount(db, { actor: ale, date: "2026-10-03", userId: ids.jere, serviceType: "CORTE", count: i, now: NOW });
    const first = await listAudit(db, { limit: 2 });
    expect(first).toHaveLength(2);
    const older = await listAudit(db, { limit: 2, before: first[first.length - 1]!.at });
    expect(older.length).toBeLessThanOrEqual(1);
    expect(summarize("{roto", "tampoco")).toBe("");
  });
});
