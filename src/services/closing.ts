import type { PrismaClient } from "@prisma/client";
import { checkRendicion, boxBalance, type BoxKind } from "../domain/cashbox";
import { validateClose } from "../domain/closing";
import { todayBA } from "../domain/money";
import { audit, DomainError, isAdmin, type Actor, type Db } from "./common";
import { getDayFigures } from "./figures";

export interface CloseDayParams {
  date: string;
  actor: Actor;
  declaredCash: number;
  declaredTransfers: number;
  changeLeft: number;
  note?: string | null;
  /** Detalle por cuenta (Brubank, MP, efectivo...). Opcional. */
  lines?: { account: string; amount: number }[];
  now?: Date;
}

/** Cierra la caja del día. Una vez cerrada no se edita: solo el admin/dueño puede reabrirla, con motivo. */
export async function closeDay(db: PrismaClient, p: CloseDayParams) {
  const now = p.now ?? new Date();
  const today = todayBA(now);
  if (p.date > today) throw new DomainError("FECHA_FUTURA", "No se puede cerrar la caja de un día futuro.");
  if (p.actor.role === "BARBERO" && p.date !== today) {
    throw new DomainError("DIA_PASADO_REQUIERE_ADMIN", "Cerrar o cargar un día pasado requiere permiso del admin.");
  }
  return db.$transaction(async (tx) => {
    const existing = await tx.cashClose.findUnique({ where: { date: p.date } });
    if (existing && !existing.deletedAt && existing.status === "CLOSED") {
      throw new DomainError("YA_CERRADO", "La caja de ese día ya está cerrada. Solo el admin puede reabrirla.");
    }
    const f = await getDayFigures(tx, p.date);
    const check = validateClose({
      expectedIncome: f.expectedIncome,
      expectedCash: f.expectedCash,
      expectedTransfers: f.expectedTransfers,
      declaredCash: p.declaredCash,
      declaredTransfers: p.declaredTransfers,
      changeLeft: p.changeLeft,
      note: p.note,
      unpaidSales: f.unpaidSales,
    });
    if (!check.ok) throw new DomainError(check.errors[0]!.code, check.errors.map((e) => e.message).join(" "), check.errors);

    const data = {
      expectedIncome: f.expectedIncome,
      expectedCash: f.expectedCash,
      expectedTransfers: f.expectedTransfers,
      labor: f.labor,
      expectedNet: f.expectedNet,
      declaredCash: p.declaredCash,
      declaredTransfers: p.declaredTransfers,
      declaredTotal: check.declaredTotal,
      changeLeft: p.changeLeft,
      difference: check.difference,
      note: p.note?.trim() || null,
      status: "CLOSED",
      source: "APP",
      closedAt: now,
      closedById: p.actor.id,
      deletedAt: null,
    };
    const close = existing
      ? await tx.cashClose.update({ where: { id: existing.id }, data })
      : await tx.cashClose.create({ data: { date: p.date, ...data } });
    await tx.cashCloseLine.deleteMany({ where: { closeId: close.id } });
    if (p.lines?.length) await tx.cashCloseLine.createMany({ data: p.lines.map((l) => ({ closeId: close.id, account: l.account, amount: l.amount })) });
    if (check.cashToBox > 0) {
      await tx.cashBoxEntry.create({ data: { date: p.date, kind: "CIERRE", amount: check.cashToBox, closeId: close.id, createdById: p.actor.id } });
    }
    await audit(tx, { userId: p.actor.id, entity: "CashClose", entityId: close.id, action: "CLOSE", after: { date: p.date, ...data, closedAt: undefined } });
    return { close, check };
  });
}

/** Reabre un día cerrado (solo admin/dueño, con motivo). El efectivo que había sumado a la caja se da de baja hasta volver a cerrar. */
export async function reopenDay(db: PrismaClient, p: { date: string; actor: Actor; reason: string; now?: Date }) {
  if (!isAdmin(p.actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño pueden reabrir una caja cerrada.");
  if (!p.reason.trim()) throw new DomainError("MOTIVO_OBLIGATORIO", "Indicá el motivo de la reapertura.");
  const now = p.now ?? new Date();
  return db.$transaction(async (tx) => {
    const close = await tx.cashClose.findUnique({ where: { date: p.date } });
    if (!close || close.deletedAt || close.status !== "CLOSED") throw new DomainError("NO_ESTA_CERRADO", "Ese día no tiene una caja cerrada.");
    await tx.cashBoxEntry.updateMany({ where: { closeId: close.id, kind: "CIERRE", deletedAt: null }, data: { deletedAt: now } });
    const updated = await tx.cashClose.update({
      where: { id: close.id },
      data: { status: "OPEN", reopenedAt: now, reopenedById: p.actor.id, reopenReason: p.reason.trim() },
    });
    await audit(tx, { userId: p.actor.id, entity: "CashClose", entityId: close.id, action: "REOPEN", before: { status: "CLOSED", difference: close.difference }, after: { reason: p.reason.trim() } });
    return updated;
  });
}

/** Marca un día como "no abrió" (feriado, vacaciones) para que no genere alertas. */
export async function markClosedDay(db: PrismaClient, p: { date: string; actor: Actor; reason?: string }) {
  if (!isAdmin(p.actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño pueden marcar un día como cerrado.");
  const sales = await db.sale.count({ where: { date: p.date, deletedAt: null } });
  if (sales > 0) throw new DomainError("DIA_CON_VENTAS", "Ese día tiene ventas cargadas: hay que cerrarlo, no marcarlo como sin actividad.");
  const row = await db.closedDay.upsert({
    where: { date: p.date },
    update: { reason: p.reason ?? null, deletedAt: null },
    create: { date: p.date, reason: p.reason ?? null, createdById: p.actor.id },
  });
  await audit(db, { userId: p.actor.id, entity: "ClosedDay", entityId: row.id, action: "CREATE", after: { date: p.date, reason: p.reason } });
  return row;
}

// --- Fila de efectivo acumulado -------------------------------------------------------------------------------------

export async function getBoxBalance(db: Db): Promise<number> {
  const entries = await db.cashBoxEntry.findMany({ where: { deletedAt: null } });
  return boxBalance(entries.map((e) => ({ date: e.date, kind: e.kind as BoxKind, amount: e.amount })));
}

/** El barbero se retira de la caja lo que ya le corresponde cobrar. Cuenta como "ya cobrado" en la compensación mensual. */
export async function addWithdrawal(db: PrismaClient, p: { date: string; actor: Actor; userId: string; amount: number; note?: string }) {
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new DomainError("MONTO_INVALIDO", "El retiro debe ser un entero mayor a 0.");
  if (p.actor.role === "BARBERO" && p.actor.id !== p.userId) throw new DomainError("SOLO_PROPIO", "Un barbero solo puede registrar sus propios retiros.");
  const e = await db.cashBoxEntry.create({ data: { date: p.date, kind: "RETIRO_BARBERO", amount: -p.amount, userId: p.userId, note: p.note ?? null, createdById: p.actor.id } });
  await audit(db, { userId: p.actor.id, entity: "CashBoxEntry", entityId: e.id, action: "CREATE", after: { kind: e.kind, amount: e.amount, userId: p.userId } });
  return e;
}

/** Rendición del efectivo acumulado al dueño (fin de semana). Si lo entregado no coincide con el saldo, la nota es obligatoria. */
export async function rendir(db: PrismaClient, p: { date: string; actor: Actor; handedOver: number; receivedBy: string; note?: string }) {
  if (!isAdmin(p.actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño registran la rendición del efectivo.");
  if (!Number.isInteger(p.handedOver) || p.handedOver <= 0) throw new DomainError("MONTO_INVALIDO", "El monto rendido debe ser un entero mayor a 0.");
  return db.$transaction(async (tx) => {
    const balance = await getBoxBalance(tx);
    const check = checkRendicion(balance, p.handedOver);
    if (check.needsNote && !(p.note ?? "").trim()) {
      throw new DomainError("NOTA_OBLIGATORIA", `Lo entregado (${p.handedOver}) no coincide con el efectivo acumulado (${balance}): dejá una nota.`, check);
    }
    const e = await tx.cashBoxEntry.create({
      data: { date: p.date, kind: "RENDICION", amount: -p.handedOver, expectedAmount: balance, receivedBy: p.receivedBy, note: p.note?.trim() || null, userId: p.actor.id, createdById: p.actor.id },
    });
    await audit(tx, { userId: p.actor.id, entity: "CashBoxEntry", entityId: e.id, action: "CREATE", after: { kind: "RENDICION", handedOver: p.handedOver, expected: balance, receivedBy: p.receivedBy } });
    return { entry: e, check, balanceAfter: balance - p.handedOver };
  });
}
