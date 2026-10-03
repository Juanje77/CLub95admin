import { randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashPin, verifyPin } from "../auth/pin";
import { todayBA } from "../domain/money";
import { SERVICE_TYPES, type ServiceType } from "../domain/types";
import { audit, DomainError, isAdmin, type Actor } from "./common";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireAdmin(actor: Actor) {
  if (!isAdmin(actor)) throw new DomainError("SOLO_ADMIN", "Solo el admin o el dueño pueden hacer esto.");
}

function checkDate(d: string) {
  if (!DATE_RE.test(d) || Number.isNaN(Date.parse(`${d}T12:00:00Z`))) throw new DomainError("FECHA_INVALIDA", "La fecha es inválida (AAAA-MM-DD).");
}

/** Los cambios de reglas y precios rigen desde una fecha. Solo el dueño puede corregir hacia atrás. */
function checkEffectiveDate(actor: Actor, validFrom: string, now: Date) {
  checkDate(validFrom);
  if (validFrom < todayBA(now) && actor.role !== "DUENO") {
    throw new DomainError("VIGENCIA_PASADA", "Un cambio no puede regir desde una fecha pasada (cambiaría el historial). Pedile al dueño que lo corrija.");
  }
}

const TRIVIAL = new Set(["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234", "4321", "0123"]);

/** PIN de 4 dígitos al azar, sin los obvios. */
export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10000)).padStart(4, "0");
    if (!TRIVIAL.has(pin)) return pin;
  }
}

// --- PIN ------------------------------------------------------------------------------------------------------------------

export async function changeOwnPin(db: PrismaClient, p: { userId: string; current: string; next: string }) {
  const user = await db.user.findUnique({ where: { id: p.userId } });
  if (!user || user.deletedAt || !user.active) throw new DomainError("USUARIO_INVALIDO", "Usuario inválido.");
  if (!verifyPin(p.current, user.pinHash)) throw new DomainError("PIN_ACTUAL_INCORRECTO", "El PIN actual no es correcto.");
  if (!/^\d{4,8}$/.test(p.next)) throw new DomainError("PIN_INVALIDO", "El PIN nuevo debe tener entre 4 y 8 dígitos.");
  if (p.next === p.current) throw new DomainError("PIN_IGUAL", "El PIN nuevo tiene que ser distinto del actual.");
  if (TRIVIAL.has(p.next)) throw new DomainError("PIN_FACIL", "Ese PIN es muy fácil de adivinar (1234, 0000, 1111…). Elegí otro.");
  await db.user.update({ where: { id: user.id }, data: { pinHash: hashPin(p.next), failedAttempts: 0, lockedUntil: null } });
  await audit(db, { userId: user.id, entity: "User", entityId: user.id, action: "UPDATE", after: { pinChanged: true } });
}

/** Genera un PIN nuevo para otro usuario y lo devuelve (se muestra una sola vez). El admin resetea barberos; solo el dueño resetea admin/dueño. */
export async function resetPin(db: PrismaClient, p: { actor: Actor; targetId: string }) {
  requireAdmin(p.actor);
  if (p.actor.id === p.targetId) throw new DomainError("USAR_MI_PIN", "Para cambiar tu propio PIN usá \"Mi PIN\".");
  const target = await db.user.findUnique({ where: { id: p.targetId } });
  if (!target || target.deletedAt) throw new DomainError("USUARIO_INVALIDO", "Usuario inexistente.");
  if (target.role !== "BARBERO" && p.actor.role !== "DUENO") throw new DomainError("SOLO_DUENO", "Solo el dueño puede resetear el PIN de un admin o del dueño.");
  const pin = generatePin();
  await db.user.update({ where: { id: target.id }, data: { pinHash: hashPin(pin), failedAttempts: 0, lockedUntil: null } });
  await audit(db, { userId: p.actor.id, entity: "User", entityId: target.id, action: "UPDATE", after: { pinReset: true } });
  return { pin, name: target.name };
}

// --- Equipo ------------------------------------------------------------------------------------------------------------------

export interface RuleInput {
  commissionBp: number;
  drinkDeduction: number;
  drinkCost: number;
}

function checkRule(r: RuleInput) {
  if (!Number.isInteger(r.commissionBp) || r.commissionBp < 0 || r.commissionBp > 10000) throw new DomainError("COMISION_INVALIDA", "La comisión debe estar entre 0% y 100%.");
  for (const [label, v] of [["descuento de bebida", r.drinkDeduction], ["costo de la bebida", r.drinkCost]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 1_000_000) throw new DomainError("MONTO_INVALIDO", `El ${label} debe ser un entero mayor o igual a 0.`);
  }
}

export async function createBarber(db: PrismaClient, p: { actor: Actor; name: string; username: string; validFrom: string } & RuleInput & { now?: Date }) {
  requireAdmin(p.actor);
  const name = p.name.trim();
  const username = p.username.trim().toLowerCase();
  if (!name) throw new DomainError("NOMBRE_OBLIGATORIO", "Ingresá el nombre.");
  if (!/^[a-z0-9._-]{3,20}$/.test(username)) throw new DomainError("USUARIO_INVALIDO", "El usuario debe tener de 3 a 20 letras minúsculas, números, punto, guion o guion bajo.");
  checkRule(p);
  checkEffectiveDate(p.actor, p.validFrom, p.now ?? new Date());
  if (await db.user.findUnique({ where: { username } })) throw new DomainError("USUARIO_EXISTE", "Ya existe un usuario con ese nombre.");
  const pin = generatePin();
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { username, name, role: "BARBERO", isBarber: true, pinHash: hashPin(pin) } });
    await tx.barberRule.create({ data: { userId: u.id, validFrom: p.validFrom, commissionBp: p.commissionBp, drinkDeduction: p.drinkDeduction, drinkCost: p.drinkCost } });
    await audit(tx, { userId: p.actor.id, entity: "User", entityId: u.id, action: "CREATE", after: { username, name, commissionBp: p.commissionBp } });
    return u;
  });
  return { user, pin };
}

export async function setUserActive(db: PrismaClient, p: { actor: Actor; userId: string; active: boolean }) {
  requireAdmin(p.actor);
  if (p.actor.id === p.userId) throw new DomainError("NO_TE_DESACTIVES", "No podés desactivar tu propio usuario.");
  const user = await db.user.findUnique({ where: { id: p.userId } });
  if (!user || user.deletedAt) throw new DomainError("USUARIO_INVALIDO", "Usuario inexistente.");
  if (user.role === "DUENO" && p.actor.role !== "DUENO") throw new DomainError("SOLO_DUENO", "Solo el dueño puede cambiar el estado del dueño.");
  await db.user.update({ where: { id: user.id }, data: { active: p.active } });
  await audit(db, { userId: p.actor.id, entity: "User", entityId: user.id, action: "UPDATE", before: { active: user.active }, after: { active: p.active } });
}

/** Nueva comisión / descuento de bebida de un barbero desde una fecha. El historial anterior no cambia. */
export async function addBarberRule(db: PrismaClient, p: { actor: Actor; userId: string; validFrom: string; note?: string; now?: Date } & RuleInput) {
  requireAdmin(p.actor);
  checkRule(p);
  checkEffectiveDate(p.actor, p.validFrom, p.now ?? new Date());
  const user = await db.user.findUnique({ where: { id: p.userId } });
  if (!user || !user.isBarber) throw new DomainError("USUARIO_INVALIDO", "Ese usuario no es un barbero.");
  const row = await db.barberRule.upsert({
    where: { userId_validFrom: { userId: p.userId, validFrom: p.validFrom } },
    update: { commissionBp: p.commissionBp, drinkDeduction: p.drinkDeduction, drinkCost: p.drinkCost, note: p.note ?? null, deletedAt: null },
    create: { userId: p.userId, validFrom: p.validFrom, commissionBp: p.commissionBp, drinkDeduction: p.drinkDeduction, drinkCost: p.drinkCost, note: p.note ?? null },
  });
  await audit(db, { userId: p.actor.id, entity: "BarberRule", entityId: row.id, action: "CREATE", after: { userId: p.userId, validFrom: p.validFrom, commissionBp: p.commissionBp, drinkDeduction: p.drinkDeduction } });
  return row;
}

// --- Tarifas ------------------------------------------------------------------------------------------------------------------

export async function addTariff(db: PrismaClient, p: { actor: Actor; serviceType: ServiceType; validFrom: string; price: number; now?: Date }) {
  requireAdmin(p.actor);
  if (!(SERVICE_TYPES as readonly string[]).includes(p.serviceType)) throw new DomainError("SERVICIO_INVALIDO", "Tipo de servicio inválido.");
  if (!Number.isInteger(p.price) || p.price <= 0 || p.price > 10_000_000) throw new DomainError("PRECIO_INVALIDO", "El precio debe ser un entero mayor a 0.");
  checkEffectiveDate(p.actor, p.validFrom, p.now ?? new Date());
  const row = await db.tariff.upsert({
    where: { serviceType_validFrom: { serviceType: p.serviceType, validFrom: p.validFrom } },
    update: { price: p.price, deletedAt: null },
    create: { serviceType: p.serviceType, validFrom: p.validFrom, price: p.price },
  });
  await audit(db, { userId: p.actor.id, entity: "Tariff", entityId: row.id, action: "CREATE", after: { serviceType: p.serviceType, validFrom: p.validFrom, price: p.price } });
  return row;
}

// --- Productos y stock --------------------------------------------------------------------------------------------------------

const PRODUCT_KINDS = ["BEBIDA", "CERA", "POLVO", "ACEITE"] as const;

export async function createProduct(db: PrismaClient, p: { actor: Actor; name: string; kind: string; price: number; cost: number; stock: number; minStock: number; validFrom: string; now?: Date }) {
  requireAdmin(p.actor);
  const name = p.name.trim();
  if (!name) throw new DomainError("NOMBRE_OBLIGATORIO", "Ingresá el nombre del producto.");
  if (!(PRODUCT_KINDS as readonly string[]).includes(p.kind)) throw new DomainError("TIPO_INVALIDO", "Tipo de producto inválido.");
  for (const [label, v] of [["precio", p.price], ["costo", p.cost], ["stock", p.stock], ["stock mínimo", p.minStock]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 100_000_000) throw new DomainError("MONTO_INVALIDO", `El ${label} debe ser un entero mayor o igual a 0.`);
  }
  checkEffectiveDate(p.actor, p.validFrom, p.now ?? new Date());
  if (await db.product.findUnique({ where: { name } })) throw new DomainError("PRODUCTO_EXISTE", "Ya existe un producto con ese nombre.");
  return db.$transaction(async (tx) => {
    const prod = await tx.product.create({ data: { name, kind: p.kind, stock: p.stock, minStock: p.minStock } });
    await tx.productPrice.create({ data: { productId: prod.id, validFrom: p.validFrom, price: p.price, cost: p.cost } });
    await audit(tx, { userId: p.actor.id, entity: "Product", entityId: prod.id, action: "CREATE", after: { name, kind: p.kind, price: p.price, stock: p.stock } });
    return prod;
  });
}

export async function addProductPrice(db: PrismaClient, p: { actor: Actor; productId: string; validFrom: string; price: number; cost: number; now?: Date }) {
  requireAdmin(p.actor);
  for (const [label, v] of [["precio", p.price], ["costo", p.cost]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 100_000_000) throw new DomainError("MONTO_INVALIDO", `El ${label} debe ser un entero mayor o igual a 0.`);
  }
  checkEffectiveDate(p.actor, p.validFrom, p.now ?? new Date());
  if (!(await db.product.findUnique({ where: { id: p.productId } }))) throw new DomainError("PRODUCTO_INVALIDO", "Producto inexistente.");
  const row = await db.productPrice.upsert({
    where: { productId_validFrom: { productId: p.productId, validFrom: p.validFrom } },
    update: { price: p.price, cost: p.cost },
    create: { productId: p.productId, validFrom: p.validFrom, price: p.price, cost: p.cost },
  });
  await audit(db, { userId: p.actor.id, entity: "ProductPrice", entityId: row.id, action: "CREATE", after: { productId: p.productId, validFrom: p.validFrom, price: p.price, cost: p.cost } });
  return row;
}

/** Corrige el stock (conteo real) o suma una compra. Siempre con motivo y registro. */
export async function adjustStock(db: PrismaClient, p: { actor: Actor; productId: string; mode: "SET" | "ADD"; quantity: number; reason: string }) {
  requireAdmin(p.actor);
  if (!Number.isInteger(p.quantity) || Math.abs(p.quantity) > 1_000_000 || (p.mode === "SET" && p.quantity < 0)) throw new DomainError("CANTIDAD_INVALIDA", "La cantidad debe ser un entero válido.");
  if (!p.reason.trim()) throw new DomainError("MOTIVO_OBLIGATORIO", "Indicá el motivo (conteo inicial, compra, rotura…).");
  return db.$transaction(async (tx) => {
    const prod = await tx.product.findUnique({ where: { id: p.productId } });
    if (!prod || prod.deletedAt) throw new DomainError("PRODUCTO_INVALIDO", "Producto inexistente.");
    const after = p.mode === "SET" ? p.quantity : prod.stock + p.quantity;
    await tx.product.update({ where: { id: prod.id }, data: { stock: after } });
    await audit(tx, { userId: p.actor.id, entity: "Product", entityId: prod.id, action: "UPDATE", before: { stock: prod.stock }, after: { stock: after, reason: p.reason.trim() } });
    return { before: prod.stock, after };
  });
}

export async function updateProductSettings(db: PrismaClient, p: { actor: Actor; productId: string; minStock?: number; active?: boolean }) {
  requireAdmin(p.actor);
  const prod = await db.product.findUnique({ where: { id: p.productId } });
  if (!prod || prod.deletedAt) throw new DomainError("PRODUCTO_INVALIDO", "Producto inexistente.");
  if (p.minStock !== undefined && (!Number.isInteger(p.minStock) || p.minStock < 0)) throw new DomainError("CANTIDAD_INVALIDA", "El stock mínimo debe ser un entero mayor o igual a 0.");
  await db.product.update({ where: { id: prod.id }, data: { ...(p.minStock !== undefined ? { minStock: p.minStock } : {}), ...(p.active !== undefined ? { active: p.active } : {}) } });
  await audit(db, { userId: p.actor.id, entity: "Product", entityId: prod.id, action: "UPDATE", before: { minStock: prod.minStock, active: prod.active }, after: { minStock: p.minStock, active: p.active } });
}
