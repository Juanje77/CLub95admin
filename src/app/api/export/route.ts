import { todayBA } from "../../../domain/money";
import { currentUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { isAdmin } from "../../../services/common";
import { buildPanelWorkbook, buildPlanillaWorkbook } from "../../../services/export";
import { getMonthGrid } from "../../../services/grid";
import { getPanel } from "../../../services/report";

export const dynamic = "force-dynamic";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// /api/export?tipo=panel|planilla&mes=2026-10 — solo admin/dueño con sesión.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || !isAdmin(user)) return new Response("No autorizado", { status: 401 });
  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo");
  const mesParam = url.searchParams.get("mes") ?? "";
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(mesParam) ? mesParam : todayBA().slice(0, 7);

  let body: Buffer;
  if (tipo === "panel") body = await buildPanelWorkbook(await getPanel(db, mes));
  else if (tipo === "planilla") body = await buildPlanillaWorkbook(await getMonthGrid(db, mes));
  else return new Response("Tipo inválido (panel o planilla)", { status: 400 });

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="club95-${tipo}-${mes}.xlsx"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
