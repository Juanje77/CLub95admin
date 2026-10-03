import type { PrismaClient } from "@prisma/client";
import { priceFor, pickEffective } from "../domain/rules";
import { todayBA } from "../domain/money";
import type { ServiceType } from "../domain/types";
import { audit, DomainError, isAdmin, type Actor } from "./common";
import { loadPricing } from "./figures";

export const PAYMENT_METHODS = ["TRANSFERENCIA", "EFECTIVO", "MP"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Reglas de quién puede cargar/deshacer ventas:
 *  - el día no puede estar cerrado (la caja cerrada no se edita);
 *  - un barbero solo carga sus propias ventas y solo del día de hoy;
 *  - cargar un día pasado, o a nombre de otro barbero, requiere admin/dueño.
 */
async function guard(db: PrismaClient, actor: Actor, date: string, userId: string | null, now: Date) {
  const today = todayBA(now);
  if (date > today) throw new DomainError("FECHA_FUTURA", "No se pueden cargar ventas de un día futuro.");
  if (!isAdmin(actor)) {
    if (date !== today) throw new DomainError("DIA_PASADO_REQUIERE_ADMIN", "Cargar un día pasado requiere permiso del admin.");
    if (userId && userId !== actor.id) throw new DomainError("SOLO_PROPIO", "Solo podés cargar tus propias ventas.");
  }
  const close = await db.cashClose.findUnique({ where: { date } });
  if (close && !close.deletedAt && close.status === "CLOSED") throw new DomainError("DIA_CERRADO", "La caja de ese día ya está cerrada. Solo el admin puede reabrirla.");
}

function checkPayment(method: string): PaymentMethod {
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) throw new DomainError("MEDIO_DE_PAGO_INVALIDO", "Medio de pago inválido.");
  return method as PaymentMethod;
}

/** Un servicio (corte, corte y barba, barba y cejas), con la tarifa vigente a esa fecha. */
export async function addServiceSale(
  db: PrismaClient,
  p: { actor: Actor; date: string; userId: string; serviceType: ServiceType; paymentMethod: string; now?: Date },
) {
  const now = p.now ?? new Date();
  const method = checkPayment(p.paymentMethod);
  await guard(db, p.actor, p.date, p.userId, now);
  const barber = await db.user.findUnique({ where: { id: p.userId } });
  if (!barber || !barber.active || !barber.isBarber) throw new DomainError("BARBERO_INVALIDO", "Ese barbero no está activo.");
  const { tariffs } = await loadPricing(db);
  const unitPrice = priceFor(tariffs, p.serviceType, p.date);
  const sale = await db.sale.create({
    data: { date: p.date, userId: p.userId, kind: "SERVICE", serviceType: p.serviceType, quantity: 1, unitPrice, drinkIncluded: true, paymentMethod: method, source: "APP", createdById: p.actor.id },
  });
  await audit(db, { userId: p.actor.id, entity: "Sale", entityId: sale.id, action: "CREATE", after: { date: p.date, userId: p.userId, serviceType: p.serviceType, unitPrice, paymentMethod: method } });
  return sale;
}

/** Visita de un socio de membresía: no cobra el corte en caja; descuenta una asistencia y suma al barbero para la compensación. */
export async function addMembershipVisit(db: PrismaClient, p: { actor: Actor; date: string; userId: string; now?: Date }) {
  await guard(db, p.actor, p.date, p.userId, p.now ?? new Date());
  const sale = await db.sale.create({
    data: { date: p.date, userId: p.userId, kind: "MEMBERSHIP", quantity: 1, unitPrice: 0, drinkIncluded: true, paymentMethod: "MEMBRESIA", source: "APP", createdById: p.actor.id },
  });
  await audit(db, { userId: p.actor.id, entity: "Sale", entityId: sale.id, action: "CREATE", after: { date: p.date, userId: p.userId, kind: "MEMBERSHIP" } });
  return sale;
}

/** Venta de bebida, cera, polvo o aceite: precio vigente y descuento de stock. */
export async function addProductSale(
  db: PrismaClient,
  p: { actor: Actor; date: string; userId: string | null; productId: string; quantity?: number; paymentMethod: string; now?: Date },
) {
  const quantity = p.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity <= 0) throw new DomainError("CANTIDAD_INVALIDA", "La cantidad debe ser un entero mayor a 0.");
  const method = checkPayment(p.paymentMethod);
  await guard(db, p.actor, p.date, p.userId, p.now ?? new Date());
  return db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: p.productId }, include: { prices: true } });
    if (!product || product.deletedAt || !product.active) throw new DomainError("PRODUCTO_INVALIDO", "Producto inexistente o inactivo.");
    const price = pickEffective(product.prices, p.date);
    if (!price) throw new DomainError("SIN_PRECIO", `${product.name} no tiene precio vigente.`);
    const sale = await tx.sale.create({
      data: { date: p.date, userId: p.userId, kind: "PRODUCT", productId: product.id, quantity, unitPrice: price.price, drinkIncluded: false, paymentMethod: method, source: "APP", createdById: p.actor.id },
    });
    await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: quantity } } });
    await audit(tx, { userId: p.actor.id, entity: "Sale", entityId: sale.id, action: "CREATE", after: { date: p.date, product: product.name, quantity, unitPrice: price.price, paymentMethod: method } });
    return sale;
  });
}

/** Deshace la última venta cargada ese día (la del barbero, o la última del día si es admin). Baja lógica; el stock vuelve. */
export async function undoLastSale(db: PrismaClient, p: { actor: Actor; date: string; userId?: string | null; now?: Date }) {
  const userId = isAdmin(p.actor) ? (p.userId ?? null) : p.actor.id;
  await guard(db, p.actor, p.date, userId, p.now ?? new Date());
  return db.$transaction(async (tx) => {
    const last = await tx.sale.findFirst({
      where: { date: p.date, deletedAt: null, source: "APP", ...(userId ? { createdById: p.actor.id, userId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    if (!last) throw new DomainError("NADA_PARA_DESHACER", "No hay ventas para deshacer.");
    await tx.sale.update({ where: { id: last.id }, data: { deletedAt: new Date() } });
    if (last.kind === "PRODUCT" && last.productId) {
      await tx.product.update({ where: { id: last.productId }, data: { stock: { increment: last.quantity } } });
    }
    await audit(tx, { userId: p.actor.id, entity: "Sale", entityId: last.id, action: "DELETE", before: { date: last.date, kind: last.kind, serviceType: last.serviceType, unitPrice: last.unitPrice } });
    return last;
  });
}
