import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { applySociosImport, monthFromSheetName, norm, parseSociosSheet, planSociosImport, readSociosWorkbook, sociosSheets } from "../src/import/socios";
import { getMembersMonth, getMemberStatement } from "../src/services/members";
import type { Actor } from "../src/services/common";
import { freshDb, seed, type Seed } from "./helpers/db";

const NOW = new Date("2026-10-07T15:00:00Z");
let db: PrismaClient;
let ids: Seed;
let ale: Actor;

/** Hoja con el mismo formato que Club95_v3.xlsx: encabezado en la fila 4, una fila por socio y "TOTALES DEL MES" al final. */
async function workbook(rows: (string | number | Date | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("OCTUBRE 2026");
  ws.addRow(["✂ CLUB 95"]);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow(["#", "NOMBRE", "PLAN", "TIPO", "BARBERO", "SESIONES", "PRECIO/SES", "TOTAL MES $", "COBRADO $", "FECHA PAGO", "MES QUE CORRESPONDE"]);
  rows.forEach((r, i) => ws.addRow([i + 1, ...r]));
  ws.addRow(["TOTALES DEL MES"]);
  wb.addWorksheet("Dashboard");
  const buf = await wb.xlsx.writeBuffer();
  return readSociosWorkbook(buf as ArrayBuffer);
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const parse = async (rows: Parameters<typeof workbook>[0]) => parseSociosSheet((await workbook(rows)).getWorksheet("OCTUBRE 2026")!, "2026-10");

beforeEach(async () => {
  db = freshDb();
  ids = await seed(db);
  ale = { id: ids.ale, role: "ADMIN" };
});
afterEach(async () => {
  await db.$disconnect();
});

describe("leer la planilla de socios", () => {
  it("reconoce los nombres de hoja de mes y descarta las otras", async () => {
    expect(monthFromSheetName("OCTUBRE 2026")).toBe("2026-10");
    expect(monthFromSheetName("AGOSTO 2026 ")).toBe("2026-08");
    expect(monthFromSheetName("SEPTIEMBRE 2026 (2)")).toBe("2026-09");
    expect(monthFromSheetName("Dashboard")).toBeNull();
    expect(monthFromSheetName("PLANTILLA")).toBeNull();
    expect(sociosSheets(await workbook([]))).toEqual([{ name: "OCTUBRE 2026", month: "2026-10" }]);
    expect(norm("  Matías   ARRUE ")).toBe("matias arrue");
  });
  it("lee plan, tipo, barbero, sesiones, precio, cobro, fecha y el mes que corresponde", async () => {
    const p = await parse([
      ["MATIAS ARRUE", "BLACK", "CORTE Y BARBA", "JERE", 4, 17500, 70000, 70000, D("2026-10-01"), "MES ANTERIOR"],
      ["EMILIO GATICA", "BLACK", "corte", "JERE", 5, 16250, 81250, 80000, D("2026-10-02"), "MES ACTUAL"],
      ["MAURO REY", "GOLD", "CORTE", "JERE", 4, 20000, 80000, 80000, null, "MES SIGUIENTE"],
    ]);
    expect(p.rows.map((r) => [r.name, r.plan, r.serviceType, r.sessions, r.price, r.paid, r.payDate, r.serviceMonth])).toEqual([
      ["MATIAS ARRUE", "BLACK", "CORTE_BARBA", 4, 17500, 70000, "2026-10-01", "2026-09"],
      ["EMILIO GATICA", "BLACK", "CORTE", 5, 16250, 80000, "2026-10-02", "2026-10"],
      ["MAURO REY", "GOLD", "CORTE", 4, 20000, 80000, null, "2026-11"],
    ]);
  });
  it("no carga filas sin plan o tipo ni se traga datos sin nombre: los lista", async () => {
    const p = await parse([
      ["MARCELA", null, null, "ALE", null, 20000, null, null, null, null],
      [null, "BLACK", "CORTE", "JERE", 4, 16250, 65000, 65000, null, "MES ANTERIOR"],
      [null, "BLACK", "CORTE", "JERE", null, null, null, null, null, "MES ANTERIOR"], // fila vacía de la plantilla: se ignora
    ]);
    expect(p.rows).toEqual([]);
    expect(p.skipped.map((s) => s.name)).toEqual(["MARCELA", "(sin nombre)"]);
  });
});

describe("vista previa y carga", () => {
  const rows = [
    ["MATIAS ARRUE", "BLACK", "CORTE Y BARBA", "JERE", 4, 17500, 70000, 70000, D("2026-10-01"), "MES ANTERIOR"],
    ["TIAGO BENVENUTO", "BLACK", "CORTE", "JERE", 4, 16250, 65000, null, null, "MES ANTERIOR"],
    ["GUSTAVO", "BLACK", "CORTE", "JERE", 4, 13750, 55000, 55000, D("2026-10-03"), "MES SIGUIENTE"],
    ["PEDRO BERON", "BLACK", "CORTE", "BENI", 0, 16250, null, null, null, "MES ANTERIOR"],
  ];

  it("la vista previa no guarda nada y avisa de lo dudoso", async () => {
    const plan = await planSociosImport(db, await parse(rows), NOW);
    expect(await db.member.count()).toBe(0);
    expect(plan.totals).toEqual({ toCreate: 4, existing: 0, payments: 2, paymentsAmount: 125000, sessions: 12 });
    const by = (n: string) => plan.rows.find((r) => r.name === n)!;
    expect(by("GUSTAVO")).toMatchObject({ priceToSet: 13750, serviceMonth: "2026-11" });
    expect(by("PEDRO BERON").warnings.join(" ")).toContain('"BENI" no está cargado');
    expect(by("MATIAS ARRUE")).toMatchObject({ barberId: ids.jere, payAction: "NEW", payDateUsed: "2026-10-01" });
  });

  it("carga socios, sesiones del mes de servicio y cobros; el que no pagó queda debiendo", async () => {
    const plan = await planSociosImport(db, await parse(rows), NOW);
    const res = await applySociosImport(db, ale, plan, NOW);
    expect(res).toMatchObject({ created: 4, sessionsSet: 3, payments: 2 });
    const sep = (await getMembersMonth(db, "2026-09", NOW)).members;
    expect(sep.find((m) => m.name === "MATIAS ARRUE")).toMatchObject({ visits: 4, charged: 70000, paid: 70000, status: "PAGO", balance: 0 });
    expect(sep.find((m) => m.name === "TIAGO BENVENUTO")).toMatchObject({ visits: 4, charged: 65000, paid: 0, status: "INPAGO", balance: 65000, oldestUnpaid: "2026-09" });
    const nov = (await getMembersMonth(db, "2026-11", NOW)).members.find((m) => m.name === "GUSTAVO")!;
    expect(nov).toMatchObject({ price: 13750, visits: 4, charged: 55000, paid: 55000, status: "PAGO" }); // pago adelantado con precio propio
    const pedro = await db.member.findFirstOrThrow({ where: { name: "PEDRO BERON" } });
    expect(pedro.userId).toBeNull();
    const payment = await db.memberLedger.findFirstOrThrow({ where: { kind: "PAGO", credit: 70000 } });
    expect(payment).toMatchObject({ period: "2026-09", date: "2026-10-01", method: "BANCO" });
    expect(await db.auditLog.count({ where: { entity: "Member", action: "CREATE" } })).toBe(4);
  });

  it("se puede repetir sin duplicar socios ni cobros", async () => {
    await applySociosImport(db, ale, await planSociosImport(db, await parse(rows), NOW), NOW);
    const again = await planSociosImport(db, await parse(rows), NOW);
    expect(again.totals).toMatchObject({ toCreate: 0, existing: 4, payments: 0 });
    expect(again.rows.filter((r) => r.payAction === "DUPLICATE")).toHaveLength(2);
    await applySociosImport(db, ale, again, NOW);
    expect(await db.member.count()).toBe(4);
    expect(await db.memberLedger.count()).toBe(2);
    const st = await getMemberStatement(db, (await db.member.findFirstOrThrow({ where: { name: "MATIAS ARRUE" } })).id);
    expect(st).toHaveLength(1);
  });

  it("no toca un día que ya está cerrado en la caja", async () => {
    await db.cashClose.create({ data: { date: "2026-10-01", expectedIncome: 0, labor: 0, expectedNet: 0, declaredTotal: 0, difference: 0, status: "CLOSED" } });
    const plan = await planSociosImport(db, await parse(rows), NOW);
    expect(plan.rows.find((r) => r.name === "MATIAS ARRUE")).toMatchObject({ payAction: "DAY_CLOSED" });
    const res = await applySociosImport(db, ale, plan, NOW);
    expect(res).toMatchObject({ payments: 1, skippedPayments: 1 });
    expect(await db.memberLedger.count({ where: { date: "2026-10-01" } })).toBe(0);
  });

  it("un cobro sin fecha se registra el primer día del mes de la hoja (nunca en el futuro)", async () => {
    const plan = await planSociosImport(db, await parse([["MAURO REY", "BLACK", "CORTE", "JERE", 4, 16250, 65000, 65000, null, "MES ACTUAL"]]), NOW);
    expect(plan.rows[0]).toMatchObject({ payDateUsed: "2026-10-01" });
    expect(plan.rows[0]!.warnings.join(" ")).toContain("no tiene fecha");
  });
});
