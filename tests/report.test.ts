import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addExpense, addExtraIncome } from "../src/services/expenses";
import { setDeclared, setProductCount, setServiceCount } from "../src/services/grid";
import { createMember, setAttendance } from "../src/services/members";
import ExcelJS from "exceljs";
import { buildPanelWorkbook, buildPlanillaWorkbook } from "../src/services/export";
import { getMonthGrid } from "../src/services/grid";
import { getMonthReport, getPanel } from "../src/services/report";
import { type Actor } from "../src/services/common";
import { seedCore } from "../src/seed";
import { freshDb, seed, type Seed } from "./helpers/db";

const NOW = new Date("2026-10-08T15:00:00Z");
let db: PrismaClient;
let ids: Seed;
let ale: Actor;

async function build() {
  db = freshDb();
  ids = await seed(db);
  await seedCore(db);
  ale = { id: ids.ale, role: "ADMIN" };
  // seedCore ya carga el catálogo con los precios de septiembre (Coca $ 1.700 / costo $ 1.183; Cera $ 25.000 / costo $ 13.000).
  const coca = await db.product.update({ where: { name: "Coca-Cola" }, data: { stock: 50 } });
  const cera = await db.product.update({ where: { name: "Cera 1" }, data: { stock: 50 } });

  const set = (date: string, userId: string, serviceType: "CORTE" | "CORTE_BARBA", count: number) => setServiceCount(db, { actor: ale, date, userId, serviceType, count, now: NOW });
  await set("2026-10-01", ids.jere, "CORTE", 4);
  await set("2026-10-01", ids.ale, "CORTE", 2);
  await set("2026-10-02", ids.lucio, "CORTE", 3);
  await set("2026-10-02", ids.lucio, "CORTE_BARBA", 1);
  await setProductCount(db, { actor: ale, date: "2026-10-02", productId: coca.id, count: 2, now: NOW });
  await setProductCount(db, { actor: ale, date: "2026-10-02", productId: cera.id, count: 1, now: NOW });

  const socio = await createMember(db, { actor: ale, name: "Matías", serviceType: "CORTE_BARBA", userId: ids.lucio, price: 16500, startDate: "2026-09-01", now: NOW });
  for (const d of ["2026-10-02", "2026-10-03"]) await setAttendance(db, { actor: ale, memberId: socio.id, date: d, present: true, barberId: ids.lucio, now: NOW });
  await addExtraIncome(db, { actor: ale, date: "2026-10-03", concept: "Publicidad", amount: 120000, now: NOW });

  const concept = async (name: string) => (await db.expenseConcept.findUniqueOrThrow({ where: { name } })).id;
  await addExpense(db, { actor: ale, date: "2026-10-01", conceptId: await concept("ALQUILER"), amount: 793000, now: NOW });
  await addExpense(db, { actor: ale, date: "2026-10-02", conceptId: await concept("LIMPIEZA"), amount: 29000, now: NOW });
  await addExpense(db, { actor: ale, date: "2026-10-03", conceptId: await concept("TV"), amount: 68888, now: NOW });
  await addExpense(db, { actor: ale, date: "2026-10-04", conceptId: await concept("REPOSICION DE BEBIDAS"), amount: 54000, now: NOW });

  await setDeclared(db, { actor: ale, date: "2026-10-01", account: "BRUBANK", amount: 110000, now: NOW }); // faltan 10.000
}

beforeAll(build);
afterEach(() => undefined);

describe("resumen del mes (como la hoja TOTALES)", () => {
  it("cantidades por tipo e ingresos", async () => {
    const r = await getMonthReport(db, "2026-10", NOW);
    expect(r.quantities).toEqual({ CORTE: 9, CORTE_BARBA: 1, BARBA_CEJAS: 0, MEMBERSHIP: 2 });
    expect(r.income.byType).toEqual({ CORTE: 180000, CORTE_BARBA: 22000, BARBA_CEJAS: 0 });
    expect(r.income).toMatchObject({ services: 202000, memberships: 33000, drinks: 3400, products: 25000, extraTotal: 120000, total: 383400 });
    expect(r.income.extra).toEqual([{ concept: "Publicidad", amount: 120000 }]);
  });

  it("mano de obra por barbero (servicios + membresías) y el libre", async () => {
    const r = await getMonthReport(db, "2026-10", NOW);
    const by = Object.fromEntries(r.labor.byBarber.map((b) => [b.name, b.labor]));
    expect(by).toEqual({ Jere: 44400, Ale: 34000, Lucio: 42000 + 16200 });
    expect(r.labor.total).toBe(136600);
    expect(r.free).toBe(383400 - 136600);
  });

  it("costos, margen bruto, gastos y resultado final", async () => {
    const r = await getMonthReport(db, "2026-10", NOW);
    expect(r.costs).toEqual({ drinks: 26366, products: 13000, memberDrinks: 6000, total: 45366 });
    expect(r.grossMargin).toBe(246800 - 45366);
    expect(r.expenses).toEqual({ variable: 29000, structure: 793000, investment: 68888, total: 890888, replenishment: 54000 });
    expect(r.result).toBe(201434 - 890888);
  });

  it("la reposición de mercadería no resta del resultado (el costo ya está en lo consumido)", async () => {
    const r = await getMonthReport(db, "2026-10", NOW);
    expect(r.expenses.replenishment).toBe(54000);
    expect(r.result).toBe(r.grossMargin - (r.expenses.variable + r.expenses.structure + r.expenses.investment));
  });

  it("coincide con la suma de la ganancia diaria de la planilla + membresías netas + otros ingresos", async () => {
    const r = await getMonthReport(db, "2026-10", NOW);
    const membershipNet = 33000 - 16200 - 6000;
    expect(r.dailyProfitTotal).toBe(70634);
    expect(r.grossMargin).toBe(r.dailyProfitTotal + membershipNet + r.income.extraTotal);
  });

  it("el ranking pone primero a quien más generó e informa los descuadres de caja", async () => {
    const r = await getMonthReport(db, "2026-10", NOW);
    expect(r.labor.byBarber.map((b) => b.name)).toEqual(["Lucio", "Jere", "Ale"]);
    expect(r.labor.byBarber.find((b) => b.name === "Lucio")).toMatchObject({ services: 4, memberships: 2, gross: 82000 });
    expect(r.gaps).toEqual([{ date: "2026-10-01", difference: -10000, note: null }]);
    expect(r.gapsTotal).toBe(-10000);
  });

  it("días fuertes ordenados por ingreso", async () => {
    const r = await getMonthReport(db, "2026-10", NOW);
    expect(r.bestDays.map((d) => [d.date, d.income])).toEqual([["2026-10-01", 120000], ["2026-10-02", 110400]]);
    expect(r.worstDays).toEqual([]); // con pocos días no se repite la lista
    expect(r.activeDays).toBe(2);
  });
});

describe("panel: comparativo y días de la semana", () => {
  it("compara los últimos 6 meses terminando en el elegido", async () => {
    const p = await getPanel(db, "2026-10", { now: NOW });
    expect(p.series.map((s) => s.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(p.series[5]).toMatchObject({ income: 383400, labor: 136600, result: 201434 - 890888, gaps: 1 });
    expect(p.series[4]).toMatchObject({ income: 0, result: 0 });
  });
  it("promedio por día de la semana (solo días con ventas)", async () => {
    const p = await getPanel(db, "2026-10", { now: NOW });
    expect(p.weekdays.map((w) => w.label)).toEqual(["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]);
    expect(p.weekdays.find((w) => w.label === "Jueves")).toMatchObject({ days: 1, avgIncome: 120000, avgServices: 6 });
    expect(p.weekdays.find((w) => w.label === "Viernes")).toMatchObject({ days: 1, avgIncome: 110400, avgServices: 4 });
    expect(p.weekdays.find((w) => w.label === "Lunes")).toMatchObject({ days: 0, avgIncome: 0 });
  });
});

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}
const rowByLabel = (ws: ExcelJS.Worksheet, label: string) => {
  let found: ExcelJS.Row | undefined;
  ws.eachRow((row) => { if (row.getCell(1).value === label) found = found ?? row; });
  return found;
};

describe("exportar a Excel", () => {
  it("el panel trae las hojas y los mismos números que la pantalla", async () => {
    const wb = await load(await buildPanelWorkbook(await getPanel(db, "2026-10", { now: NOW })));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Resumen", "Comparativo", "Barberos", "Días y caja"]);
    const res = wb.getWorksheet("Resumen")!;
    expect(rowByLabel(res, "TOTAL INGRESOS")!.getCell(2).value).toBe(383400);
    expect(rowByLabel(res, "TOTAL MANO DE OBRA")!.getCell(2).value).toBe(136600);
    expect(rowByLabel(res, "RESULTADO FINAL (neto a distribuir)")!.getCell(2).value).toBe(201434 - 890888);
    const cmp = wb.getWorksheet("Comparativo")!;
    expect(cmp.rowCount).toBe(2 + 1 + 6); // título + vacía + encabezado + 6 meses
    const bar = wb.getWorksheet("Barberos")!;
    expect(rowByLabel(bar, "Lucio")!.getCell(7).value).toBe(58200);
  });

  it("la planilla se exporta con los días en columnas y el total del mes", async () => {
    const wb = await load(await buildPlanillaWorkbook(await getMonthGrid(db, "2026-10", NOW)));
    const ws = wb.worksheets[0]!;
    const head = ws.getRow(1);
    expect(head.getCell(2).value).toBe(1);
    expect(head.getCell(32).value).toBe(31);
    expect(head.getCell(33).value).toBe("MES");
    const gan = rowByLabel(ws, "GANANCIA DEL DÍA")!;
    expect(gan.getCell(2).value).toBe(29600); // 1/10
    expect(gan.getCell(3).value).toBe(41034); // 2/10
    expect(gan.getCell(33).value).toBe(70634);
    expect(rowByLabel(ws, "Diferencia de caja")!.getCell(2).value).toBe(-10000);
  });
});
