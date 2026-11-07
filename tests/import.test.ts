import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openWorkbook } from "../src/import/sheet";
import { readMonth } from "../src/import/month";
import { readExpenses, verifyExpenses } from "../src/import/expenses";
import { verifyMonth } from "../src/import/verify";
import { verifyTotals } from "../src/import/totals";

const FILE = "data/planilla.xlsx";

// La planilla real tiene datos del negocio y no se versiona: estos tests corren solo si está en data/.
describe.skipIf(!existsSync(FILE))("importación de septiembre 2026", async () => {
  const wb = await openWorkbook(FILE);
  const month = readMonth(wb.getWorksheet("SEP-26")!, "2026-09");

  it("lee 30 días y deja el 1/10 aparte", () => {
    expect(month.days).toHaveLength(30);
    expect(month.foreignDays.map((d) => d.date)).toEqual(["2026-10-01"]);
  });
  it("recalcular cada día con las reglas de la planilla da lo mismo que la planilla", () => {
    const { stats } = verifyMonth(month);
    expect(stats.fidelityMismatches).toBe(0);
  });
  it("los totales del mes coinciden con TOTALES", () => {
    const r = verifyTotals(month, wb.getWorksheet("TOTALES")!, "2026-09");
    expect(r.compared).toBeGreaterThan(0);
    expect(r.matched).toBe(r.compared);
  });
  it("los gastos del mes coinciden con TOTALES por concepto", () => {
    const { issues, rows } = verifyExpenses(readExpenses(wb.getWorksheet("Gastos")!), wb.getWorksheet("TOTALES")!, "2026-09");
    expect(rows).toHaveLength(16);
    expect(issues.filter((i) => i.severity !== "INFO")).toEqual([]);
  });
  it("informa que con las reglas vigentes Ale y Beni cobran menos que en la planilla", () => {
    const { issues } = verifyMonth(month);
    const labor = issues.filter((i) => i.code === "MANO_DE_OBRA_DIFIERE");
    expect(labor.map((i) => i.message.slice(0, 4))).toEqual(["ALE:", "BENI"]);
  });
});
