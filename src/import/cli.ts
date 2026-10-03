import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { openWorkbook } from "./sheet";
import { readMonth } from "./month";
import { readExpenses, verifyExpenses } from "./expenses";
import { verifyMonth, type Issue } from "./verify";
import { loadMonth } from "./load";
import { verifyTotals } from "./totals";

const MONTH_SHEET: Record<string, string> = {
  "2026-04": "ABR-26", "2026-05": "MAY-26", "2026-06": "JUN-26", "2026-07": "JUL-26",
  "2026-08": "AGO-26", "2026-09": "SEP-26", "2026-10": "OCT-26",
};

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const file = arg("file", "data/planilla.xlsx")!;
const yearMonth = arg("month", "2026-09")!;
const dryRun = process.argv.includes("--dry-run");
const sheetName = MONTH_SHEET[yearMonth];
if (!sheetName) {
  console.error(`Mes no soportado todavía: ${yearMonth}. Soportados: ${Object.keys(MONTH_SHEET).join(", ")}`);
  process.exit(2);
}

const wb = await openWorkbook(file);
const ws = wb.getWorksheet(sheetName);
if (!ws) throw new Error(`No existe la hoja ${sheetName}`);
const month = readMonth(ws, yearMonth);
const monthCheck = verifyMonth(month);
const expensesAll = readExpenses(wb.getWorksheet("Gastos")!);
const expCheck = verifyExpenses(expensesAll, wb.getWorksheet("TOTALES")!, yearMonth);
const totalsCheck = verifyTotals(month, wb.getWorksheet("TOTALES")!, yearMonth);
const issues: Issue[] = [...monthCheck.issues, ...totalsCheck.issues, ...expCheck.issues];

const lines: string[] = [];
lines.push(`# Importación ${yearMonth} (${sheetName})`, "");
lines.push(`- Días leídos: ${month.days.length} (columnas de otro mes: ${month.foreignDays.map((d) => d.date).join(", ") || "ninguna"})`);
lines.push(`- Diferencias entre mi lectura y lo calculado por la planilla: ${monthCheck.stats.fidelityMismatches}`);
lines.push(`- Totales contra la hoja TOTALES: ${totalsCheck.matched}/${totalsCheck.compared} coinciden`);
lines.push(`- Gastos del mes: ${expCheck.rows.length} filas, $ ${Math.round(expCheck.rows.reduce((a, r) => a + r.amount, 0)).toLocaleString("es-AR")}`, "");
for (const sev of ["ERROR", "WARN", "INFO"] as const) {
  const list = issues.filter((i) => i.severity === sev);
  if (!list.length) continue;
  lines.push(`## ${sev} (${list.length})`);
  for (const i of list) lines.push(`- [${i.code}] ${i.message}`);
  lines.push("");
}

if (!dryRun) {
  const db = new PrismaClient();
  try {
    const res = await loadMonth(db, { fileName: file, yearMonth, month, expenses: expCheck.rows, issues });
    lines.push(`## Cargado en la base`, `- ventas: ${res.sales}, cierres: ${res.closes}, gastos: ${res.expenses}`, `- redondeo de centavos en gastos: ${res.roundingDelta.toFixed(2)}`, "");
  } finally {
    await db.$disconnect();
  }
}

mkdirSync("data/reports", { recursive: true });
const out = `data/reports/import-${yearMonth}.md`;
writeFileSync(out, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nReporte guardado en ${out}`);
process.exit(issues.some((i) => i.severity === "ERROR") ? 1 : 0);
