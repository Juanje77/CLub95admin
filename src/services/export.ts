import ExcelJS from "exceljs";
import { formatDate, monthLabel } from "../domain/money";
import { SERVICE_LABEL, SERVICE_TYPES } from "../domain/types";
import type { MonthGrid } from "./grid";
import type { PanelData } from "./report";

const MONEY = '#,##0;[Red]-#,##0';
const BOLD = { bold: true } as const;

function title(ws: ExcelJS.Worksheet, text: string, cols: number) {
  ws.addRow([text]).font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, cols);
  ws.addRow([]);
}

/** Resumen mensual del panel del dueño: mismas filas que la hoja TOTALES, más comparativo, barberos y descuadres. */
export async function buildPanelWorkbook(panel: PanelData): Promise<Buffer> {
  const r = panel.report;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Club 95";
  wb.created = new Date();

  const ws = wb.addWorksheet("Resumen");
  title(ws, `Club 95 · Resumen de ${monthLabel(r.month)}`, 2);
  const rows: [string, number | null, boolean?][] = [
    ["CANTIDADES", null, true],
    ["Cortes", r.quantities.CORTE],
    ["Corte y barba", r.quantities.CORTE_BARBA],
    ["Barba y cejas", r.quantities.BARBA_CEJAS],
    ["Visitas de socios (membresía)", r.quantities.MEMBERSHIP],
    ["INGRESOS", null, true],
    ["Cortes", r.income.byType.CORTE],
    ["Corte y barba", r.income.byType.CORTE_BARBA],
    ["Barba y cejas", r.income.byType.BARBA_CEJAS],
    ["Membresías (visitas × precio)", r.income.memberships],
    ["Bebidas", r.income.drinks],
    ["Ceras, polvo y aceite", r.income.products],
    ...r.income.extra.map((e): [string, number] => [e.concept, e.amount]),
    ["TOTAL INGRESOS", r.income.total, true],
    ["MANO DE OBRA", null, true],
    ...r.labor.byBarber.map((b): [string, number] => [b.name, b.labor]),
    ["TOTAL MANO DE OBRA", r.labor.total, true],
    ["LIBRE (ingresos − mano de obra)", r.free, true],
    ["COSTOS", null, true],
    ["Bebidas", r.costs.drinks + r.costs.memberDrinks],
    ["Ceras, polvo y aceite", r.costs.products],
    ["TOTAL COSTOS", r.costs.total, true],
    ["MARGEN BRUTO", r.grossMargin, true],
    ["GASTOS", null, true],
    ["Gastos variables", r.expenses.variable],
    ["Gastos de estructura", r.expenses.structure],
    ["Inversiones", r.expenses.investment],
    ["TOTAL GASTOS", r.expenses.total, true],
    ["RESULTADO FINAL (neto a distribuir)", r.result, true],
    ["Reposición de mercadería (compras, informativo)", r.expenses.replenishment],
  ];
  for (const [label, value, bold] of rows) {
    const row = ws.addRow([label, value]);
    if (bold) row.font = BOLD;
    row.getCell(2).numFmt = MONEY;
  }
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 18;

  const cmp = wb.addWorksheet("Comparativo");
  title(cmp, "Comparativo de los últimos meses", 6);
  cmp.addRow(["Mes", "Ingresos", "Mano de obra", "Margen bruto", "Resultado", "Días con descuadre"]).font = BOLD;
  for (const s of panel.series) {
    const row = cmp.addRow([monthLabel(s.month), s.income, s.labor, s.grossMargin, s.result, s.gaps]);
    for (const c of [2, 3, 4, 5]) row.getCell(c).numFmt = MONEY;
  }
  cmp.columns.forEach((c) => (c.width = 20));

  const bar = wb.addWorksheet("Barberos");
  title(bar, "Ranking de barberos", 8);
  bar.addRow(["Barbero", "Servicios", "Socios atendidos", "Generado", "M.O. servicios", "M.O. socios", "M.O. total", "Queda al local"]).font = BOLD;
  for (const b of r.labor.byBarber) {
    const row = bar.addRow([b.name, b.services, b.memberships, b.gross, b.laborServices, b.laborMemberships, b.labor, b.forLocal]);
    for (const c of [4, 5, 6, 7, 8]) row.getCell(c).numFmt = MONEY;
  }
  bar.columns.forEach((c) => (c.width = 18));

  const days = wb.addWorksheet("Días y caja");
  title(days, "Días fuertes y flojos, y descuadres de caja", 3);
  days.addRow(["Promedio por día de la semana (últimos 3 meses)"]).font = BOLD;
  days.addRow(["Día", "Días con ventas", "Ingreso promedio", "Servicios promedio"]).font = BOLD;
  for (const w of panel.weekdays) {
    const row = days.addRow([w.label, w.days, w.avgIncome, w.avgServices]);
    row.getCell(3).numFmt = MONEY;
  }
  days.addRow([]);
  days.addRow(["Días fuertes del mes"]).font = BOLD;
  for (const d of r.bestDays) days.addRow([formatDate(d.date), d.income, `${d.services} servicios`]).getCell(2).numFmt = MONEY;
  days.addRow([]);
  days.addRow(["Días flojos del mes"]).font = BOLD;
  for (const d of r.worstDays) days.addRow([formatDate(d.date), d.income, `${d.services} servicios`]).getCell(2).numFmt = MONEY;
  days.addRow([]);
  days.addRow(["Descuadres de caja"]).font = BOLD;
  for (const g of r.gaps) days.addRow([formatDate(g.date), g.difference, g.note ?? ""]).getCell(2).numFmt = MONEY;
  if (r.gaps.length === 0) days.addRow(["Sin descuadres este mes."]);
  days.columns.forEach((c) => (c.width = 26));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** La planilla del mes en Excel, con la misma forma que la hoja original: días en columnas. */
export async function buildPlanillaWorkbook(grid: MonthGrid): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Club 95";
  const ws = wb.addWorksheet(monthLabel(grid.month).slice(0, 31));
  const days = grid.days;
  const head = ws.addRow(["", ...days.map((d) => Number(d.date.slice(8))), "MES"]);
  head.font = BOLD;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

  const add = (label: string, get: (d: (typeof days)[number]) => number | null, opts: { bold?: boolean; money?: boolean; sum?: boolean } = {}) => {
    const vals = days.map(get);
    const total = opts.sum === false ? null : vals.reduce<number>((a, v) => a + (v ?? 0), 0);
    const row = ws.addRow([label, ...vals.map((v) => (v === 0 ? null : v)), total]);
    if (opts.bold) row.font = BOLD;
    if (opts.money !== false) row.eachCell((c, n) => { if (n > 1) c.numFmt = MONEY; });
  };
  const section = (label: string) => {
    const row = ws.addRow([label]);
    row.font = { bold: true, color: { argb: "FF666666" } };
  };

  for (const b of grid.barbers) {
    section(b.name.toUpperCase());
    for (const t of SERVICE_TYPES) add(SERVICE_LABEL[t], (d) => d.services[b.id]?.[t] ?? 0, { money: false });
    add("Socios (membresía)", (d) => d.memberships[b.id] ?? 0, { money: false });
    add("Generado", (d) => d.result.barbers.find((x) => x.userId === b.id)?.gross ?? 0);
    add("Mano de obra", (d) => d.result.barbers.find((x) => x.userId === b.id)?.labor ?? 0);
  }
  const drinks = grid.products.filter((p) => p.kind === "BEBIDA");
  const others = grid.products.filter((p) => p.kind !== "BEBIDA");
  if (drinks.length) {
    section("BEBIDAS (SIN CORTE)");
    for (const p of drinks) add(p.name, (d) => d.products[p.id] ?? 0, { money: false });
  }
  if (others.length) {
    section("CERAS, POLVO Y ACEITE");
    for (const p of others) add(p.name, (d) => d.products[p.id] ?? 0, { money: false });
  }
  section("CONTROL DEL DÍA");
  add("Ingresos por servicios", (d) => d.result.servicesGross);
  add("Bebidas, ceras y otros", (d) => d.result.drinksRevenue + d.result.productsRevenue);
  add("TOTAL INGRESOS", (d) => d.result.income, { bold: true });
  add("Mano de obra", (d) => d.result.labor);
  add("Dinero que debe haber", (d) => d.result.expectedNet, { bold: true });
  add("Cobros de socios", (d) => d.memberPayments);
  add("Costos (bebidas, ceras)", (d) => d.result.costs.total);
  add("GANANCIA DEL DÍA", (d) => d.result.profit.total, { bold: true });
  section("DINERO INGRESADO");
  for (const a of grid.accounts) add(a.name, (d) => d.declared[a.key] ?? 0);
  add("Total ingresado", (d) => d.totalDeclared);
  add("Cambio dejado", (d) => d.changeLeft, { sum: false });
  add("Diferencia de caja", (d) => d.difference, { bold: true });

  ws.getColumn(1).width = 34;
  for (let c = 2; c <= days.length + 2; c++) ws.getColumn(c).width = 11;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
