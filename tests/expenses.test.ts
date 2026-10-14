import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addExpense, addExtraIncome, createConcept, createRecurring, deleteExpense, deleteExtraIncome, deleteRecurring, getReceipt, listExpenses, listExtraIncome, recurringStatus, setConceptActive, updateExpense } from "../src/services/expenses";
import { syncAlerts } from "../src/services/alerts";
import { DomainError, type Actor } from "../src/services/common";
import { seedCore } from "../src/seed";
import { freshDb, seed, type Seed } from "./helpers/db";

const NOW = new Date("2026-10-08T15:00:00Z"); // jueves 8/10/2026
let db: PrismaClient;
let ids: Seed;
let lucio: Actor;
let ale: Actor;
let alquiler: string;
let luz: string;
let limpieza: string;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return null;
};
const concept = async (name: string) => (await db.expenseConcept.findUniqueOrThrow({ where: { name } })).id;
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

beforeEach(async () => {
  db = freshDb();
  ids = await seed(db);
  await seedCore(db); // conceptos por defecto
  lucio = { id: ids.lucio, role: "BARBERO" };
  ale = { id: ids.ale, role: "ADMIN" };
  [alquiler, luz, limpieza] = [await concept("ALQUILER"), await concept("LUZ"), await concept("LIMPIEZA")];
});
afterEach(async () => {
  await db.$disconnect();
});

describe("alta de gastos", () => {
  it("el seed deja los conceptos de la planilla con su categoría", async () => {
    const all = await db.expenseConcept.findMany();
    expect(all.length).toBeGreaterThanOrEqual(23);
    expect((await db.expenseConcept.findUniqueOrThrow({ where: { name: "ALQUILER" } })).category).toBe("ESTRUCTURA");
    expect((await db.expenseConcept.findUniqueOrThrow({ where: { name: "LIMPIEZA" } })).category).toBe("VARIABLE");
    expect((await db.expenseConcept.findUniqueOrThrow({ where: { name: "TV" } })).category).toBe("INVERSION");
  });

  it("carga un gasto con concepto de la lista, monto y descripción", async () => {
    const e = await addExpense(db, { actor: ale, date: "2026-10-05", conceptId: alquiler, amount: 793000, description: "Octubre", now: NOW });
    expect(e).toMatchObject({ amount: 793000, description: "Octubre", source: "APP" });
    expect(await db.auditLog.count({ where: { entity: "Expense", action: "CREATE" } })).toBe(1);
  });

  it("solo admin/dueño; valida fecha, monto y concepto", async () => {
    const base = { actor: ale, date: "2026-10-05", conceptId: alquiler, amount: 1000, now: NOW };
    expect(await code(addExpense(db, { ...base, actor: lucio }))).toBe("SOLO_ADMIN");
    expect(await code(addExpense(db, { ...base, date: "2026-10-09" }))).toBe("FECHA_FUTURA");
    expect(await code(addExpense(db, { ...base, date: "05/10/2026" }))).toBe("FECHA_INVALIDA");
    expect(await code(addExpense(db, { ...base, amount: 0 }))).toBe("MONTO_INVALIDO");
    expect(await code(addExpense(db, { ...base, amount: 10.5 }))).toBe("MONTO_INVALIDO");
    expect(await code(addExpense(db, { ...base, conceptId: "inventado" }))).toBe("CONCEPTO_INVALIDO");
  });

  it("no se puede cargar con un concepto dado de baja", async () => {
    await setConceptActive(db, { actor: ale, id: limpieza, active: false });
    expect(await code(addExpense(db, { actor: ale, date: "2026-10-05", conceptId: limpieza, amount: 1000, now: NOW }))).toBe("CONCEPTO_INVALIDO");
  });

  it("guarda la foto del comprobante (JPEG chico) y rechaza otros formatos o tamaños", async () => {
    const e = await addExpense(db, { actor: ale, date: "2026-10-05", conceptId: luz, amount: 125000, receiptData: JPEG, now: NOW });
    expect(await getReceipt(db, e.id)).toBe(JPEG);
    expect(await code(addExpense(db, { actor: ale, date: "2026-10-05", conceptId: luz, amount: 1, receiptData: "data:image/png;base64,AAAA", now: NOW }))).toBe("COMPROBANTE_INVALIDO");
    expect(await code(addExpense(db, { actor: ale, date: "2026-10-05", conceptId: luz, amount: 1, receiptData: "data:image/jpeg;base64," + "A".repeat(700_001), now: NOW }))).toBe("COMPROBANTE_GRANDE");
  });
});

describe("editar y borrar", () => {
  it("editar deja el antes y el después en la auditoría", async () => {
    const e = await addExpense(db, { actor: ale, date: "2026-10-05", conceptId: limpieza, amount: 10000, now: NOW });
    await updateExpense(db, { actor: ale, id: e.id, amount: 12000, description: "Corregido", now: NOW });
    const log = await db.auditLog.findFirstOrThrow({ where: { entity: "Expense", action: "UPDATE" } });
    expect(JSON.parse(log.before!).amount).toBe(10000);
    expect(JSON.parse(log.after!).amount).toBe(12000);
  });

  it("borrar es baja lógica y deja de sumar, con registro de quién lo borró", async () => {
    const e = await addExpense(db, { actor: ale, date: "2026-10-05", conceptId: limpieza, amount: 10000, now: NOW });
    await deleteExpense(db, { actor: ale, id: e.id });
    expect((await db.expense.findUniqueOrThrow({ where: { id: e.id } })).deletedAt).not.toBeNull();
    expect((await listExpenses(db, { month: "2026-10" })).summary.total).toBe(0);
    expect(await code(deleteExpense(db, { actor: ale, id: e.id }))).toBe("GASTO_INEXISTENTE");
    expect(await db.auditLog.count({ where: { entity: "Expense", action: "DELETE" } })).toBe(1);
  });
});

describe("listado, filtros y totales", () => {
  beforeEach(async () => {
    await addExpense(db, { actor: ale, date: "2026-10-01", conceptId: alquiler, amount: 793000, now: NOW });
    await addExpense(db, { actor: ale, date: "2026-10-02", conceptId: limpieza, amount: 15000, now: NOW });
    await addExpense(db, { actor: ale, date: "2026-10-06", conceptId: limpieza, amount: 14000, now: NOW });
    await addExpense(db, { actor: ale, date: "2026-10-07", conceptId: await concept("REPOSICION DE BEBIDAS"), amount: 54000, now: NOW });
    await db.expense.create({ data: { date: "2026-09-30", conceptId: luz, amount: 99999, source: "APP" } }); // otro mes
  });

  it("totales por categoría y por concepto del mes", async () => {
    const { summary } = await listExpenses(db, { month: "2026-10" });
    expect(summary.total).toBe(793000 + 29000 + 54000);
    expect(summary.byCategory).toEqual({ VARIABLE: 29000, ESTRUCTURA: 793000, INVERSION: 0, REPOSICION: 54000 });
    expect(summary.byConcept[0]).toMatchObject({ concept: "ALQUILER", total: 793000, count: 1 });
    expect(summary.byConcept.find((c) => c.concept === "LIMPIEZA")).toMatchObject({ total: 29000, count: 2 });
  });

  it("filtra por concepto sin cambiar los totales del mes", async () => {
    const r = await listExpenses(db, { month: "2026-10", conceptId: limpieza });
    expect(r.rows.map((x) => x.amount)).toEqual([14000, 15000]); // más reciente primero
    expect(r.summary.total).toBe(876000);
  });
});

describe("conceptos administrables", () => {
  it("crea un concepto nuevo (en mayúsculas) y no deja duplicados", async () => {
    const c = await createConcept(db, { actor: ale, name: " ventilador ", category: "INVERSION" });
    expect(c.name).toBe("VENTILADOR");
    expect(await code(createConcept(db, { actor: ale, name: "ventilador", category: "INVERSION" }))).toBe("CONCEPTO_EXISTE");
    expect(await code(createConcept(db, { actor: ale, name: "x", category: "OTRA" }))).toBe("CATEGORIA_INVALIDA");
    expect(await code(createConcept(db, { actor: lucio, name: "y", category: "VARIABLE" }))).toBe("SOLO_ADMIN");
  });
});

describe("gastos fijos y recordatorio", () => {
  it("un fijo aparece pendiente desde su día y deja de estarlo al cargar el gasto", async () => {
    await createRecurring(db, { actor: ale, conceptId: alquiler, dayOfMonth: 5, amount: 793000 });
    await createRecurring(db, { actor: ale, conceptId: luz, dayOfMonth: 20 });
    let s = await recurringStatus(db, "2026-10", NOW);
    expect(s.map((r) => [r.concept, r.due, r.done])).toEqual([["ALQUILER", true, false], ["LUZ", false, false]]); // hoy es 8
    await addExpense(db, { actor: ale, date: "2026-10-08", conceptId: alquiler, amount: 793000, now: NOW });
    s = await recurringStatus(db, "2026-10", NOW);
    expect(s.find((r) => r.concept === "ALQUILER")).toMatchObject({ due: false, done: true });
  });

  it("valida el día y se puede borrar", async () => {
    expect(await code(createRecurring(db, { actor: ale, conceptId: alquiler, dayOfMonth: 31 }))).toBe("DIA_INVALIDO");
    const r = await createRecurring(db, { actor: ale, conceptId: alquiler, dayOfMonth: 5 });
    await deleteRecurring(db, { actor: ale, id: r.id });
    expect(await recurringStatus(db, "2026-10", NOW)).toEqual([]);
  });

  it("genera la alerta para el admin hasta que se carga", async () => {
    await db.setting.create({ data: { key: "alerts", value: JSON.stringify({ startDate: "2026-10-08" }) } });
    await createRecurring(db, { actor: ale, conceptId: alquiler, dayOfMonth: 5 });
    const a = await syncAlerts(db, { now: NOW });
    expect(a.find((x) => x.code === "GASTO_FIJO_PENDIENTE")!.message).toContain("ALQUILER de octubre 2026");
    await addExpense(db, { actor: ale, date: "2026-10-08", conceptId: alquiler, amount: 793000, now: NOW });
    expect((await syncAlerts(db, { now: NOW })).some((x) => x.code === "GASTO_FIJO_PENDIENTE")).toBe(false);
  });
});

describe("otros ingresos", () => {
  it("publicidad y alquiler de yerba por mes, con baja lógica", async () => {
    const a = await addExtraIncome(db, { actor: ale, date: "2026-10-03", concept: "Publicidad", amount: 120000, now: NOW });
    await addExtraIncome(db, { actor: ale, date: "2026-10-04", concept: "Alquiler de yerba", amount: 60000, now: NOW });
    expect((await listExtraIncome(db, "2026-10")).map((r) => r.amount).sort()).toEqual([120000, 60000]);
    await deleteExtraIncome(db, { actor: ale, id: a.id });
    expect((await listExtraIncome(db, "2026-10")).map((r) => r.amount)).toEqual([60000]);
    expect(await code(addExtraIncome(db, { actor: ale, date: "2026-10-03", concept: " ", amount: 5, now: NOW }))).toBe("CONCEPTO_INVALIDO");
    expect(await code(addExtraIncome(db, { actor: lucio, date: "2026-10-03", concept: "x", amount: 5, now: NOW }))).toBe("SOLO_ADMIN");
  });
});
