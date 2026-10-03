import type { PrismaClient } from "@prisma/client";
import { computeGridDay, emptyGridDay, type CatalogItem, type GridDayResult } from "../domain/grid";
import { pickEffective, priceFor } from "../domain/rules";
import { todayBA } from "../domain/money";
import { SERVICE_TYPES, type BarberRule, type ServiceCounts, type ServiceType, type TariffEntry } from "../domain/types";
import { audit, DomainError, type Actor, type Db } from "./common";
import { closeDay } from "./closing";
import { guardEdit } from "./sales";
import { loadPricing } from "./figures";

const MAX_COUNT = 999;

function checkCount(n: number) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) throw new DomainError("CANTIDAD_INVALIDA", `La cantidad debe ser un número entero entre 0 y ${MAX_COUNT}.`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Carga por cantidad: cada celda de la grilla es "cuántos se hicieron/vendieron ese día". Se guarda UNA fila agregada por celda.
// ---------------------------------------------------------------------------------------------------------------------------

export async function setServiceCount(db: PrismaClient, p: { actor: Actor; date: string; userId: string; serviceType: ServiceType; count: number; now?: Date }) {
  checkCount(p.count);
  if (!(SERVICE_TYPES as readonly string[]).includes(p.serviceType)) throw new DomainError("SERVICIO_INVALIDO", "Tipo de servicio inválido.");
  await guardEdit(db, p.actor, p.date, p.userId, p.now ?? new Date());
  return db.$transaction(async (tx) => {
    const barber = await tx.user.findUnique({ where: { id: p.userId } });
    if (!barber || !barber.isBarber) throw new DomainError("BARBERO_INVALIDO", "Ese usuario no es un barbero.");
    const { tariffs } = await loadPricing(tx);
    let unitPrice = 0;
    if (p.count > 0) {
      try {
        unitPrice = priceFor(tariffs, p.serviceType, p.date);
      } catch {
        throw new DomainError("SIN_TARIFA", "No hay una tarifa vigente para esa fecha.");
      }
    }
    return replaceCell(tx, p.actor, { date: p.date, userId: p.userId, kind: "SERVICE", serviceType: p.serviceType, productId: null }, p.count, unitPrice);
  });
}

export async function setMembershipCount(db: PrismaClient, p: { actor: Actor; date: string; userId: string; count: number; now?: Date }) {
  checkCount(p.count);
  await guardEdit(db, p.actor, p.date, p.userId, p.now ?? new Date());
  return db.$transaction((tx) => replaceCell(tx, p.actor, { date: p.date, userId: p.userId, kind: "MEMBERSHIP", serviceType: null, productId: null }, p.count, 0));
}

/** Cantidad vendida de una bebida, cera, polvo o aceite ese día. Ajusta el stock por la diferencia. */
export async function setProductCount(db: PrismaClient, p: { actor: Actor; date: string; productId: string; count: number; now?: Date }) {
  checkCount(p.count);
  await guardEdit(db, p.actor, p.date, null, p.now ?? new Date());
  return db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: p.productId }, include: { prices: true } });
    if (!product || product.deletedAt || !product.active) throw new DomainError("PRODUCTO_INVALIDO", "Producto inexistente o inactivo.");
    let unitPrice = 0;
    if (p.count > 0) {
      const price = pickEffective(product.prices, p.date);
      if (!price) throw new DomainError("SIN_PRECIO", `${product.name} no tiene precio vigente.`);
      unitPrice = price.price;
    }
    const r = await replaceCell(tx, p.actor, { date: p.date, userId: null, kind: "PRODUCT", serviceType: null, productId: p.productId }, p.count, unitPrice);
    if (r.before !== p.count) await tx.product.update({ where: { id: p.productId }, data: { stock: { increment: r.before - p.count } } });
    return r;
  });
}

interface CellKey {
  date: string;
  userId: string | null;
  kind: "SERVICE" | "MEMBERSHIP" | "PRODUCT";
  serviceType: string | null;
  productId: string | null;
}

/** Deja la celda con exactamente `count`: actualiza la fila de la grilla, o reemplaza las filas cargadas de otra forma. */
async function replaceCell(tx: Db, actor: Actor, key: CellKey, count: number, unitPrice: number) {
  const rows = await tx.sale.findMany({ where: { date: key.date, userId: key.userId, kind: key.kind, serviceType: key.serviceType, productId: key.productId, deletedAt: null } });
  const before = rows.reduce((a, r) => a + r.quantity, 0);
  if (before === count) return { before, after: count, changed: false };

  const single = rows.length === 1 && rows[0]!.source === "GRID" ? rows[0]! : null;
  if (single && count > 0) {
    await tx.sale.update({ where: { id: single.id }, data: { quantity: count, unitPrice } });
  } else {
    const now = new Date();
    for (const r of rows) await tx.sale.updateMany({ where: { id: r.id }, data: { deletedAt: now } });
    if (count > 0) {
      await tx.sale.create({
        data: { date: key.date, userId: key.userId, kind: key.kind, serviceType: key.serviceType, productId: key.productId, quantity: count, unitPrice, drinkIncluded: key.kind !== "PRODUCT", paymentMethod: null, source: "GRID", createdById: actor.id },
      });
    }
  }
  await audit(tx, { userId: actor.id, entity: "SaleCell", entityId: `${key.date}:${key.userId ?? "local"}:${key.serviceType ?? key.productId ?? key.kind}`, action: "UPDATE", before: { count: before }, after: { count } });
  return { before, after: count, changed: true };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Dinero ingresado (efectivo, Brubank, MP...) y cambio dejado: se cargan en números, igual que en la planilla.
// Quedan en un cierre en borrador (status OPEN) hasta que se cierra el día.
// ---------------------------------------------------------------------------------------------------------------------------

async function draftFor(tx: Db, date: string) {
  const existing = await tx.cashClose.findUnique({ where: { date } });
  if (existing && !existing.deletedAt && existing.status === "CLOSED") throw new DomainError("DIA_CERRADO", "La caja de ese día ya está cerrada. Solo el admin puede reabrirla.");
  if (existing) return existing;
  return tx.cashClose.create({ data: { date, expectedIncome: 0, labor: 0, expectedNet: 0, declaredTotal: 0, difference: 0, status: "OPEN", source: "APP" } });
}

async function refreshDraftTotals(tx: Db, closeId: string) {
  const lines = await tx.cashCloseLine.findMany({ where: { closeId } });
  const cash = lines.filter((l) => l.account === "EFECTIVO").reduce((a, l) => a + l.amount, 0);
  const transfers = lines.filter((l) => l.account !== "EFECTIVO").reduce((a, l) => a + l.amount, 0);
  await tx.cashClose.update({ where: { id: closeId }, data: { declaredCash: cash, declaredTransfers: transfers, declaredTotal: cash + transfers } });
}

export async function setDeclared(db: PrismaClient, p: { actor: Actor; date: string; account: string; amount: number; now?: Date }) {
  checkMoney(p.amount);
  await guardEdit(db, p.actor, p.date, null, p.now ?? new Date());
  return db.$transaction(async (tx) => {
    const account = await tx.paymentAccount.findUnique({ where: { key: p.account } });
    if (!account || account.deletedAt || !account.active) throw new DomainError("CUENTA_INVALIDA", "Esa cuenta no existe.");
    const close = await draftFor(tx, p.date);
    const prev = await tx.cashCloseLine.findMany({ where: { closeId: close.id, account: p.account } });
    const before = prev.reduce((a, l) => a + l.amount, 0);
    if (before === p.amount) return { before, after: p.amount, changed: false };
    await tx.cashCloseLine.deleteMany({ where: { closeId: close.id, account: p.account } });
    if (p.amount > 0) await tx.cashCloseLine.create({ data: { closeId: close.id, account: p.account, amount: p.amount } });
    await refreshDraftTotals(tx, close.id);
    await audit(tx, { userId: p.actor.id, entity: "CashClose", entityId: close.id, action: "UPDATE", before: { [p.account]: before }, after: { [p.account]: p.amount } });
    return { before, after: p.amount, changed: true };
  });
}

export async function setChangeLeft(db: PrismaClient, p: { actor: Actor; date: string; amount: number; now?: Date }) {
  checkMoney(p.amount);
  await guardEdit(db, p.actor, p.date, null, p.now ?? new Date());
  return db.$transaction(async (tx) => {
    const close = await draftFor(tx, p.date);
    if (close.changeLeft === p.amount) return { changed: false };
    await tx.cashClose.update({ where: { id: close.id }, data: { changeLeft: p.amount } });
    await audit(tx, { userId: p.actor.id, entity: "CashClose", entityId: close.id, action: "UPDATE", before: { changeLeft: close.changeLeft }, after: { changeLeft: p.amount } });
    return { changed: true };
  });
}

function checkMoney(n: number) {
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000) throw new DomainError("MONTO_INVALIDO", "El monto debe ser un entero mayor o igual a 0.");
}

/** Cierra el día con lo que quedó cargado en la grilla. Si hay diferencia, la nota es obligatoria. */
export async function closeDayFromGrid(db: PrismaClient, p: { actor: Actor; date: string; note?: string | null; now?: Date }) {
  const draft = await db.cashClose.findUnique({ where: { date: p.date }, include: { lines: true } });
  const lines = draft && !draft.deletedAt ? draft.lines : [];
  const cash = lines.filter((l) => l.account === "EFECTIVO").reduce((a, l) => a + l.amount, 0);
  const transfers = lines.filter((l) => l.account !== "EFECTIVO").reduce((a, l) => a + l.amount, 0);
  return closeDay(db, {
    date: p.date,
    actor: p.actor,
    declaredCash: cash,
    declaredTransfers: transfers,
    changeLeft: draft && !draft.deletedAt ? draft.changeLeft : 0,
    note: p.note,
    lines: lines.map((l) => ({ account: l.account, amount: l.amount })),
    now: p.now,
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Lectura del mes: todo lo que muestra la grilla, ya calculado.
// ---------------------------------------------------------------------------------------------------------------------------

export interface GridDayCol {
  date: string;
  closed: boolean;
  /** Cantidades: servicios por barbero y tipo, socios por barbero, productos por id. */
  services: Record<string, ServiceCounts>;
  memberships: Record<string, number>;
  products: Record<string, number>;
  /** Dinero ingresado por cuenta, y cambio dejado. */
  declared: Record<string, number>;
  changeLeft: number;
  note: string | null;
  result: GridDayResult;
  /** Cobros de cuotas de socios registrados ese día (entran a la caja, no son ventas de la grilla). */
  memberPayments: number;
  /** Total ingresado − (ingresos del día + cobros de socios). null si todavía no se cargó nada de dinero. */
  difference: number | null;
  totalDeclared: number;
  error?: string;
}

export interface MonthGrid {
  month: string;
  today: string;
  barbers: { id: string; name: string; active: boolean }[];
  products: { id: string; name: string; kind: string; stock: number; minStock: number }[];
  accounts: { key: string; name: string }[];
  days: GridDayCol[];
}

export function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export async function getMonthGrid(db: PrismaClient, month: string, now: Date = new Date()): Promise<MonthGrid> {
  const dates = monthDates(month);
  const range = { gte: dates[0]!, lte: dates[dates.length - 1]! };
  const [users, sales, closes, products, accounts, pricing, memberPays] = await Promise.all([
    db.user.findMany({ where: { isBarber: true, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    db.sale.findMany({ where: { deletedAt: null, date: range } }),
    db.cashClose.findMany({ where: { deletedAt: null, date: range }, include: { lines: true } }),
    db.product.findMany({ where: { deletedAt: null }, include: { prices: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    db.paymentAccount.findMany({ where: { active: true, deletedAt: null, key: { not: { startsWith: "MEMBRESIA" } } }, orderBy: { name: "asc" } }),
    loadPricing(db),
    db.memberLedger.findMany({ where: { deletedAt: null, kind: "PAGO", date: range } }),
  ]);

  // Filas: barberos activos y los inactivos que tuvieron actividad en el mes (p. ej. Beni en septiembre).
  const withData = new Set(sales.map((s) => s.userId).filter((x): x is string => !!x));
  const barbers = users.filter((u) => u.active || withData.has(u.id)).map((u) => ({ id: u.id, name: u.name, active: u.active }));

  const sellable = products.filter((p) => p.active && (p.kind !== "BEBIDA" || p.prices.some((x) => x.price > 0)) || sales.some((s) => s.productId === p.id));
  const accountOrder = ["EFECTIVO", "BRUBANK", "BRUBANK_JUAN", "MP_JERE"];
  const accountsSorted = [...accounts].sort((a, b) => (accountOrder.indexOf(a.key) + 1 || 99) - (accountOrder.indexOf(b.key) + 1 || 99));

  const days: GridDayCol[] = dates.map((date) => {
    const ds = sales.filter((s) => s.date === date);
    const services: Record<string, ServiceCounts> = {};
    const memberships: Record<string, number> = {};
    const prod: Record<string, number> = {};
    for (const s of ds) {
      if (s.kind === "SERVICE" && s.userId && s.serviceType) {
        const c = (services[s.userId] ??= {});
        c[s.serviceType as ServiceType] = (c[s.serviceType as ServiceType] ?? 0) + s.quantity;
      } else if (s.kind === "MEMBERSHIP" && s.userId) memberships[s.userId] = (memberships[s.userId] ?? 0) + s.quantity;
      else if (s.kind === "PRODUCT" && s.productId) prod[s.productId] = (prod[s.productId] ?? 0) + s.quantity;
    }

    const close = closes.find((c) => c.date === date);
    const declared: Record<string, number> = {};
    for (const l of close?.lines ?? []) declared[l.account] = (declared[l.account] ?? 0) + l.amount;
    const totalDeclared = Object.entries(declared).filter(([k]) => !k.startsWith("MEMBRESIA")).reduce((a, [, v]) => a + v, 0);

    const active = [...new Set([...Object.keys(services), ...Object.keys(memberships)])];
    const catalog: Record<string, CatalogItem> = {};
    for (const p of products) {
      const price = pickEffective(p.prices, date);
      if (price) catalog[p.id] = { id: p.id, name: p.name, kind: p.kind, price: price.price, cost: price.cost };
    }
    let result: GridDayResult = emptyGridDay(date);
    let error: string | undefined;
    if (ds.length > 0) {
      try {
        result = computeGridDay({
          date,
          tariffs: pricing.tariffs as TariffEntry[],
          barbers: active.map((userId) => ({ userId, rules: (pricing.rules.get(userId) ?? []) as BarberRule[], services: services[userId] ?? {}, memberships: memberships[userId] ?? 0 })),
          products: prod,
          catalog,
        });
      } catch (e) {
        error = e instanceof Error ? e.message : "No se pudo calcular el día.";
      }
    }
    const memberPayments = memberPays.filter((l) => l.date === date).reduce((a, l) => a + l.credit, 0);
    const hasMoney = !!close && (totalDeclared > 0 || close.changeLeft > 0);
    return {
      date,
      closed: !!close && close.status === "CLOSED",
      services,
      memberships,
      products: prod,
      declared,
      changeLeft: close?.changeLeft ?? 0,
      note: close?.note ?? null,
      result,
      memberPayments,
      difference: hasMoney ? totalDeclared - (result.income + memberPayments) : null,
      totalDeclared,
      error,
    };
  });

  return {
    month,
    today: todayBA(now),
    barbers,
    products: sellable.map((p) => ({ id: p.id, name: p.name, kind: p.kind, stock: p.stock, minStock: p.minStock })),
    accounts: accountsSorted.map((a) => ({ key: a.key, name: a.name })),
    days,
  };
}
