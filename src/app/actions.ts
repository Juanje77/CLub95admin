"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { endSession, requireUser, startSession } from "../lib/auth";
import { db } from "../lib/db";
import { todayBA } from "../domain/money";
import type { ServiceType } from "../domain/types";
import { loginWithPin, type SessionUser } from "../services/auth";
import { addWithdrawal, markClosedDay, reopenDay, rendir } from "../services/closing";
import { closeDayFromGrid, setChangeLeft, setDeclared, setMembershipCount, setProductCount, setServiceCount } from "../services/grid";
import { DomainError } from "../services/common";
import { addMemberPrice, adjustMember, createMember, registerPayment, setAttendance, updateMember, voidLedgerEntry } from "../services/members";
import { addExpense, addExtraIncome, createConcept, createRecurring, deleteExpense, deleteExtraIncome, deleteRecurring, setConceptActive, updateExpense } from "../services/expenses";
import { addBarberRule, addProductPrice, addTariff, adjustStock, changeOwnPin, createBarber, createProduct, resetPin, setUserActive, updateProductSettings } from "../services/admin";

export type ActionResult = { ok: true; message?: string; data?: unknown } | { ok: false; error: string };

async function run(fn: (user: SessionUser) => Promise<string | { message?: string; data?: unknown } | void>): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const out = await fn(user);
    revalidatePath("/", "layout");
    if (out && typeof out === "object") return { ok: true, message: out.message, data: out.data };
    return { ok: true, message: out ?? undefined };
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

// --- Planilla: se carga la cantidad de cada cosa por día ---------------------------------------------------------------

export async function saveServiceCount(p: { date: string; userId: string; serviceType: ServiceType; count: number }) {
  return run(async (actor) => {
    await setServiceCount(db, { actor, ...p });
  });
}

export async function saveMembershipCount(p: { date: string; userId: string; count: number }) {
  return run(async (actor) => {
    await setMembershipCount(db, { actor, ...p });
  });
}

export async function saveProductCount(p: { date: string; productId: string; count: number }) {
  return run(async (actor) => {
    await setProductCount(db, { actor, ...p });
  });
}

export async function saveDeclared(p: { date: string; account: string; amount: number }) {
  return run(async (actor) => {
    await setDeclared(db, { actor, ...p });
  });
}

export async function saveChange(p: { date: string; amount: number }) {
  return run(async (actor) => {
    await setChangeLeft(db, { actor, ...p });
  });
}

export async function closeDayAction(p: { date: string; note: string }) {
  return run(async (actor) => {
    await closeDayFromGrid(db, { actor, ...p });
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

// --- Mi PIN y configuración ---------------------------------------------------------------------------------------------------

export async function changePin(p: { current: string; next: string }) {
  return run(async (user) => {
    await changeOwnPin(db, { userId: user.id, ...p });
    return "PIN actualizado.";
  });
}

export async function adminResetPin(p: { userId: string }) {
  return run(async (actor) => {
    const r = await resetPin(db, { actor, targetId: p.userId });
    return { data: r };
  });
}

export async function adminCreateBarber(p: { name: string; username: string; validFrom: string; commissionBp: number; drinkDeduction: number; drinkCost: number }) {
  return run(async (actor) => {
    const r = await createBarber(db, { actor, ...p, commissionBp: int(p.commissionBp), drinkDeduction: int(p.drinkDeduction), drinkCost: int(p.drinkCost) });
    return { data: { pin: r.pin, name: r.user.name, username: r.user.username } };
  });
}

export async function adminSetActive(p: { userId: string; active: boolean }) {
  return run(async (actor) => {
    await setUserActive(db, { actor, ...p });
    return p.active ? "Usuario activado." : "Usuario desactivado.";
  });
}

export async function adminAddRule(p: { userId: string; validFrom: string; commissionBp: number; drinkDeduction: number; drinkCost: number }) {
  return run(async (actor) => {
    await addBarberRule(db, { actor, ...p, commissionBp: int(p.commissionBp), drinkDeduction: int(p.drinkDeduction), drinkCost: int(p.drinkCost) });
    return "Comisión guardada.";
  });
}

export async function adminAddTariff(p: { serviceType: ServiceType; validFrom: string; price: number }) {
  return run(async (actor) => {
    await addTariff(db, { actor, ...p, price: int(p.price) });
    return "Tarifa guardada.";
  });
}

export async function adminCreateProduct(p: { name: string; kind: string; price: number; cost: number; stock: number; minStock: number; validFrom: string }) {
  return run(async (actor) => {
    await createProduct(db, { actor, ...p, price: int(p.price), cost: int(p.cost), stock: int(p.stock), minStock: int(p.minStock) });
    return "Producto creado.";
  });
}

export async function adminAddPrice(p: { productId: string; validFrom: string; price: number; cost: number }) {
  return run(async (actor) => {
    await addProductPrice(db, { actor, ...p, price: int(p.price), cost: int(p.cost) });
    return "Precio guardado.";
  });
}

export async function adminAdjustStock(p: { productId: string; mode: "SET" | "ADD"; quantity: number; reason: string }) {
  return run(async (actor) => {
    const r = await adjustStock(db, { actor, ...p, quantity: Number(p.quantity) });
    return `Stock: ${r.before} → ${r.after}`;
  });
}

export async function adminProductSettings(p: { productId: string; minStock?: number; active?: boolean }) {
  return run(async (actor) => {
    await updateProductSettings(db, { actor, ...p });
    return "Guardado.";
  });
}

// --- Gastos ----------------------------------------------------------------------------------------------------------------------

export async function saveExpense(p: { date: string; conceptId: string; amount: number; description: string; receiptData: string | null }) {
  return run(async (actor) => {
    await addExpense(db, { actor, ...p, amount: int(p.amount) });
    return "Gasto cargado.";
  });
}

export async function editExpense(p: { id: string; date: string; conceptId: string; amount: number; description: string }) {
  return run(async (actor) => {
    await updateExpense(db, { actor, ...p, amount: int(p.amount) });
    return "Gasto actualizado.";
  });
}

export async function removeExpense(p: { id: string }) {
  return run(async (actor) => {
    await deleteExpense(db, { actor, ...p });
    return "Gasto borrado.";
  });
}

export async function saveConcept(p: { name: string; category: string }) {
  return run(async (actor) => {
    await createConcept(db, { actor, ...p });
    return "Concepto creado.";
  });
}

export async function toggleConcept(p: { id: string; active: boolean }) {
  return run(async (actor) => {
    await setConceptActive(db, { actor, ...p });
    return p.active ? "Concepto activado." : "Concepto dado de baja.";
  });
}

export async function saveRecurring(p: { conceptId: string; dayOfMonth: number; amount: number | null; description: string }) {
  return run(async (actor) => {
    await createRecurring(db, { actor, ...p, amount: p.amount ? int(p.amount) : null });
    return "Gasto fijo guardado.";
  });
}

export async function removeRecurring(p: { id: string }) {
  return run(async (actor) => {
    await deleteRecurring(db, { actor, ...p });
    return "Gasto fijo borrado.";
  });
}

export async function saveExtraIncome(p: { date: string; concept: string; amount: number; note: string }) {
  return run(async (actor) => {
    await addExtraIncome(db, { actor, ...p, amount: int(p.amount) });
    return "Ingreso cargado.";
  });
}

export async function removeExtraIncome(p: { id: string }) {
  return run(async (actor) => {
    await deleteExtraIncome(db, { actor, ...p });
    return "Ingreso borrado.";
  });
}

// --- Socios (membresías) ------------------------------------------------------------------------------------------------------

export async function toggleAttendance(p: { memberId: string; date: string; present: boolean }) {
  return run(async (actor) => {
    await setAttendance(db, { actor, ...p });
  });
}

export async function saveMember(p: { name: string; serviceType: string; userId: string | null; price: number | null; phone: string; note: string }) {
  return run(async (actor) => {
    await createMember(db, { actor, ...p, price: p.price ? int(p.price) : undefined });
    return "Socio agregado.";
  });
}

export async function editMember(p: { id: string; name: string; userId: string | null; serviceType: string; phone: string; active: boolean }) {
  return run(async (actor) => {
    await updateMember(db, { actor, ...p });
    return "Socio actualizado.";
  });
}

export async function saveMemberPrice(p: { memberId: string; validFrom: string; price: number }) {
  return run(async (actor) => {
    await addMemberPrice(db, { actor, ...p, price: int(p.price) });
    return "Precio guardado.";
  });
}

export async function saveMemberPayment(p: { memberId: string; date: string; amount: number; method: string; note: string }) {
  return run(async (actor) => {
    await registerPayment(db, { actor, ...p, amount: int(p.amount) });
    return "Cobro registrado.";
  });
}

export async function saveMemberAdjustment(p: { memberId: string; date: string; amount: number; reason: string }) {
  return run(async (actor) => {
    await adjustMember(db, { actor, ...p, amount: Number(p.amount) });
    return "Ajuste registrado.";
  });
}

export async function voidMemberEntry(p: { id: string; reason: string }) {
  return run(async (actor) => {
    await voidLedgerEntry(db, { actor, ...p });
    return "Movimiento anulado.";
  });
}
