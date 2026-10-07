import type { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { MEMBER_PLANS } from "../domain/members";
import { todayBA } from "../domain/money";
import type { Actor } from "../services/common";
import { createMember, defaultMemberPrice, registerPayment, setMemberSessions, type MemberType } from "../services/members";
import { cellValue, isoDate } from "./sheet";

/**
 * Carga de los socios desde la planilla `Club95_v3.xlsx` (una hoja por mes, una fila por socio).
 * Columnas: B nombre · C plan · D tipo · E barbero · F sesiones · G precio por sesión · I cobrado · J fecha de pago · K mes que corresponde.
 * La hoja es del mes en que se cobra; "MES QUE CORRESPONDE" dice a qué mes de servicio pertenecen las sesiones y el cobro.
 * Nada se corrige en silencio: lo que no se puede cargar queda en la lista de advertencias.
 */

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "OCTUBRE 2026" → "2026-10"; las hojas que no son de un mes (Dashboard, PLANTILLA…) devuelven null. */
export function monthFromSheetName(name: string): string | null {
  const m = /([a-záéíóúñ]+)\s+(\d{4})/i.exec(name);
  if (!m) return null;
  const i = MONTHS.indexOf(norm(m[1] ?? ""));
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, "0")}`;
}

export function sociosSheets(wb: ExcelJS.Workbook): { name: string; month: string }[] {
  return wb.worksheets.flatMap((ws) => {
    const month = monthFromSheetName(ws.name);
    return month && hasSociosHeader(ws) ? [{ name: ws.name, month }] : [];
  });
}

const headerRow = (ws: ExcelJS.Worksheet): number => {
  for (let r = 1; r <= 12; r++) if (norm(String(cellValue(ws.getCell(r, 2)) ?? "")) === "nombre") return r;
  return 0;
};
const hasSociosHeader = (ws: ExcelJS.Worksheet) => headerRow(ws) > 0 && norm(String(cellValue(ws.getCell(headerRow(ws), 6)) ?? "")) === "sesiones";

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

export interface SocioRow {
  row: number;
  name: string;
  plan: string;
  serviceType: MemberType;
  barber: string;
  sessions: number;
  /** Precio por sesión de la fila, si lo trae. */
  price: number | null;
  paid: number;
  payDate: string | null;
  /** Mes de servicio al que corresponden las sesiones y el cobro. */
  serviceMonth: string;
}
export interface ParsedSocios {
  sheet: string;
  month: string;
  rows: SocioRow[];
  skipped: { row: number; name: string; reason: string }[];
}

export function parseSociosSheet(ws: ExcelJS.Worksheet, month: string): ParsedSocios {
  const out: ParsedSocios = { sheet: ws.name, month, rows: [], skipped: [] };
  const first = headerRow(ws);
  if (!first) return out;
  for (let r = first + 1; r <= ws.rowCount; r++) {
    const a = String(cellValue(ws.getCell(r, 1)) ?? "").trim();
    if (/^totales/i.test(a)) break;
    const name = String(cellValue(ws.getCell(r, 2)) ?? "").replace(/\s+/g, " ").trim();
    const sessionsRaw = cellValue(ws.getCell(r, 6));
    const paidRaw = cellValue(ws.getCell(r, 9));
    const sessions = typeof sessionsRaw === "number" ? sessionsRaw : 0;
    const paid = typeof paidRaw === "number" ? paidRaw : 0;
    if (!name) {
      if (sessions > 0 || paid > 0) out.skipped.push({ row: r, name: "(sin nombre)", reason: "tiene sesiones o cobro pero no tiene nombre" });
      continue;
    }
    const plan = norm(String(cellValue(ws.getCell(r, 3)) ?? "")).toUpperCase();
    const typeText = norm(String(cellValue(ws.getCell(r, 4)) ?? ""));
    const serviceType: MemberType | null = typeText === "corte y barba" ? "CORTE_BARBA" : typeText === "corte" ? "CORTE" : null;
    if (!(MEMBER_PLANS as readonly string[]).includes(plan) || !serviceType) {
      out.skipped.push({ row: r, name, reason: `falta el plan (Black/Gold) o el tipo (corte / corte y barba): cargalo a mano en la app` });
      continue;
    }
    const priceRaw = cellValue(ws.getCell(r, 7));
    const dateRaw = cellValue(ws.getCell(r, 10));
    const kText = norm(String(cellValue(ws.getCell(r, 11)) ?? ""));
    const offset = kText.includes("anterior") ? -1 : kText.includes("siguiente") ? 1 : 0;
    out.rows.push({
      row: r,
      name,
      plan,
      serviceType,
      barber: String(cellValue(ws.getCell(r, 5)) ?? "").trim(),
      sessions,
      price: typeof priceRaw === "number" && priceRaw > 0 ? priceRaw : null,
      paid,
      payDate: dateRaw instanceof Date ? isoDate(dateRaw) : typeof dateRaw === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateRaw) ? dateRaw.slice(0, 10) : null,
      serviceMonth: shiftMonth(month, offset),
    });
  }
  return out;
}

export async function readSociosWorkbook(buf: ArrayBuffer | Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

// --- Plan (vista previa) y aplicación -------------------------------------------------------------------------------------------

export interface ImportRow extends SocioRow {
  exists: boolean;
  barberId: string | null;
  /** Precio a fijar al crear el socio (solo si la planilla trae uno distinto del plan). */
  priceToSet: number | null;
  /** Fecha con la que se registraría el cobro. */
  payDateUsed: string | null;
  payAction: "NONE" | "NEW" | "DUPLICATE" | "DAY_CLOSED";
  warnings: string[];
}
export interface ImportPlan {
  sheet: string;
  month: string;
  rows: ImportRow[];
  skipped: ParsedSocios["skipped"];
  totals: { toCreate: number; existing: number; payments: number; paymentsAmount: number; sessions: number };
}

export async function planSociosImport(db: PrismaClient, parsed: ParsedSocios, now: Date = new Date()): Promise<ImportPlan> {
  const today = todayBA(now);
  const [members, users, payments, closes] = await Promise.all([
    db.member.findMany({ where: { deletedAt: null } }),
    db.user.findMany({ where: { isBarber: true, active: true, deletedAt: null } }),
    db.memberLedger.findMany({ where: { deletedAt: null, kind: "PAGO" } }),
    db.cashClose.findMany({ where: { status: "CLOSED" }, select: { date: true } }),
  ]);
  const byName = new Map(members.map((m) => [norm(m.name), m]));
  const barbers = new Map(users.map((u) => [norm(u.name), u.id]));
  const closed = new Set(closes.map((c) => c.date));
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  for (const r of parsed.rows) {
    const warnings: string[] = [];
    const key = norm(r.name);
    if (seen.has(key)) {
      parsed.skipped.push({ row: r.row, name: r.name, reason: "el nombre está repetido en la hoja" });
      continue;
    }
    seen.add(key);
    const existing = byName.get(key);
    const barberId = barbers.get(norm(r.barber)) ?? null;
    if (!barberId && !existing) warnings.push(`el barbero "${r.barber || "—"}" no está cargado en el equipo: el socio queda sin asignar`);
    let priceToSet: number | null = null;
    if (!existing && r.price !== null && r.price !== (await defaultMemberPrice(db, r.serviceType, r.plan as "BLACK" | "GOLD"))) {
      priceToSet = r.price;
      warnings.push(`precio propio de $ ${r.price.toLocaleString("es-AR")} por sesión (distinto del plan)`);
    }
    if (existing && existing.plan !== r.plan) warnings.push(`ya existe con plan ${existing.plan} (la planilla dice ${r.plan}): no se cambia`);
    let payAction: ImportRow["payAction"] = "NONE";
    let payDateUsed: string | null = null;
    if (r.paid > 0) {
      payDateUsed = r.payDate ?? (`${parsed.month}-01` > today ? today : `${parsed.month}-01`);
      if (!r.payDate) warnings.push(`el cobro no tiene fecha en la planilla: se registra el ${payDateUsed.split("-").reverse().join("/")}`);
      if (payDateUsed > today) {
        payDateUsed = today;
        warnings.push("la fecha de pago es futura: se registra hoy");
      }
      const dup = existing && payments.some((p) => p.memberId === existing.id && p.date === payDateUsed && p.credit === r.paid && p.period === r.serviceMonth);
      if (dup) payAction = "DUPLICATE";
      else if (closed.has(payDateUsed)) {
        payAction = "DAY_CLOSED";
        warnings.push("el día de ese cobro ya está cerrado en la caja: no se carga (cargalo a mano o reabrí el día)");
      } else payAction = "NEW";
    }
    rows.push({ ...r, exists: !!existing, barberId, priceToSet, payDateUsed, payAction, warnings });
  }
  const pay = rows.filter((r) => r.payAction === "NEW");
  return {
    sheet: parsed.sheet,
    month: parsed.month,
    rows,
    skipped: parsed.skipped,
    totals: {
      toCreate: rows.filter((r) => !r.exists).length,
      existing: rows.filter((r) => r.exists).length,
      payments: pay.length,
      paymentsAmount: pay.reduce((s, r) => s + r.paid, 0),
      sessions: rows.reduce((s, r) => s + r.sessions, 0),
    },
  };
}

export interface ImportResult { created: number; sessionsSet: number; payments: number; skippedPayments: number }

/** Aplica el plan: crea los socios que faltan, fija las sesiones del mes de servicio y registra los cobros nuevos. Se puede repetir sin duplicar. */
export async function applySociosImport(db: PrismaClient, actor: Actor, plan: ImportPlan, now: Date = new Date()): Promise<ImportResult> {
  const res: ImportResult = { created: 0, sessionsSet: 0, payments: 0, skippedPayments: 0 };
  for (const r of plan.rows) {
    let member = (await db.member.findMany({ where: { deletedAt: null } })).find((m) => norm(m.name) === norm(r.name)) ?? null;
    if (!member) {
      const created = await createMember(db, {
        actor, name: r.name, plan: r.plan, serviceType: r.serviceType, userId: r.barberId,
        price: r.priceToSet ?? undefined, startDate: `${r.serviceMonth}-01`, note: `Cargado desde la planilla ${plan.sheet}`, now,
      });
      member = created;
      res.created++;
    }
    if (r.sessions > 0) {
      await setMemberSessions(db, { actor, memberId: member.id, month: r.serviceMonth, sessions: r.sessions });
      res.sessionsSet++;
    }
    if (r.payAction === "NEW" && r.payDateUsed) {
      await registerPayment(db, { actor, memberId: member.id, date: r.payDateUsed, amount: r.paid, method: "BANCO", period: r.serviceMonth, note: `Cobro de la planilla ${plan.sheet}`, now });
      res.payments++;
    } else if (r.paid > 0) res.skippedPayments++;
  }
  return res;
}
