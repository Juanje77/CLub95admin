"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { endSession, requireUser, startSession } from "../lib/auth";
import { db } from "../lib/db";
import { todayBA } from "../domain/money";
import type { ServiceType } from "../domain/types";
import { loginWithPin, type SessionUser } from "../services/auth";
import { addProductSale, addMembershipVisit, addServiceSale, undoLastSale } from "../services/sales";
import { addWithdrawal, closeDay, markClosedDay, reopenDay, rendir } from "../services/closing";
import { DomainError } from "../services/common";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function run(fn: (user: SessionUser) => Promise<string | void>): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const message = await fn(user);
    revalidatePath("/", "layout");
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof DomainError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Ocurrió un error. Probá de nuevo." };
  }
}

const int = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d-]/g, "")) || 0);

export async function login(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  try {
    const user = await loginWithPin(db, String(form.get("username") ?? ""), String(form.get("pin") ?? ""));
    await startSession(user.id);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function addService(p: { date: string; userId: string; serviceType: ServiceType; paymentMethod: string }) {
  return run(async (actor) => {
    await addServiceSale(db, { actor, ...p });
  });
}

export async function addMembership(p: { date: string; userId: string }) {
  return run(async (actor) => {
    await addMembershipVisit(db, { actor, ...p });
  });
}

export async function addProduct(p: { date: string; userId: string; productId: string; quantity: number; paymentMethod: string }) {
  return run(async (actor) => {
    await addProductSale(db, { actor, ...p });
  });
}

export async function undoLast(p: { date: string; userId?: string }) {
  return run(async (actor) => {
    await undoLastSale(db, { actor, ...p });
    return "Se deshizo la última venta.";
  });
}

export async function closeCaja(p: { date: string; cash: number; accounts: Record<string, number>; changeLeft: number; note: string }) {
  return run(async (actor) => {
    const lines = Object.entries(p.accounts).filter(([, v]) => int(v) !== 0).map(([account, amount]) => ({ account, amount: int(amount) }));
    const transfers = lines.reduce((a, l) => a + l.amount, 0);
    await closeDay(db, {
      date: p.date,
      actor,
      declaredCash: int(p.cash),
      declaredTransfers: transfers,
      changeLeft: int(p.changeLeft),
      note: p.note,
      lines: [...lines, ...(int(p.cash) ? [{ account: "EFECTIVO", amount: int(p.cash) }] : [])],
    });
    return "Caja cerrada.";
  });
}

export async function reopenCaja(p: { date: string; reason: string }) {
  return run(async (actor) => {
    await reopenDay(db, { actor, ...p });
    return "Caja reabierta.";
  });
}

export async function markDayAsClosed(p: { date: string; reason: string }) {
  return run(async (actor) => {
    await markClosedDay(db, { actor, ...p });
    return "Día marcado como sin actividad.";
  });
}

export async function withdraw(p: { userId: string; amount: number; note: string }) {
  return run(async (actor) => {
    await addWithdrawal(db, { actor, date: todayBA(), userId: p.userId, amount: int(p.amount), note: p.note });
    return "Retiro registrado.";
  });
}

export async function handOver(p: { amount: number; receivedBy: string; note: string }) {
  return run(async (actor) => {
    await rendir(db, { actor, date: todayBA(), handedOver: int(p.amount), receivedBy: p.receivedBy, note: p.note });
    return "Rendición registrada.";
  });
}
