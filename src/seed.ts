import type { PrismaClient } from "@prisma/client";
import { hashPin } from "./auth/pin";
import { CONCEPT_CATEGORY } from "./domain/concepts";
import type { BarberKey } from "./import/month";
import { BARBER_NAMES, SYSTEM_FROM, SYSTEM_RULES, SYSTEM_TARIFFS } from "./import/rules";

export interface CatalogItem {
  name: string;
  kind: string;
  price: number;
  cost: number;
}

/** Precios de la planilla de septiembre 2026. */
export const DEFAULT_CATALOG: CatalogItem[] = [
  { name: "Gaseosa de vidrio (incluida en el corte)", kind: "BEBIDA", price: 0, cost: 1500 },
  { name: "Monster rosa", kind: "BEBIDA", price: 3900, cost: 2658 },
  { name: "Monster original", kind: "BEBIDA", price: 3900, cost: 2658 },
  { name: "Monster mango", kind: "BEBIDA", price: 3900, cost: 2658 },
  { name: "Monster sin azúcar", kind: "BEBIDA", price: 3900, cost: 2658 },
  { name: "Coca-Cola", kind: "BEBIDA", price: 1700, cost: 1183 },
  { name: "Sprite", kind: "BEBIDA", price: 1700, cost: 1183 },
  { name: "Fanta", kind: "BEBIDA", price: 1700, cost: 1183 },
  { name: "Aquarius", kind: "BEBIDA", price: 1800, cost: 1183 },
  { name: "Cera 1", kind: "CERA", price: 25000, cost: 13000 },
  { name: "Cera 2", kind: "CERA", price: 25000, cost: 13000 },
  { name: "Cera 3", kind: "CERA", price: 25000, cost: 13000 },
  { name: "Polvo", kind: "POLVO", price: 15000, cost: 6200 },
  { name: "Aceite", kind: "ACEITE", price: 11000, cost: 4900 },
]; 

// Septiembre 2026: Beni y Lucio compartían el puesto y la planilla no los separa (columna "BENI / LUCIO").
// Desde octubre queda solo Lucio: Beni queda como usuario inactivo para conservar el histórico.
const SEED_USERS: { key: BarberKey; username: string; role: string; pin: string; active: boolean; name: string }[] = [
  { key: "JERE", username: "jere", role: "BARBERO", pin: "1111", active: true, name: BARBER_NAMES.JERE },
  { key: "ALE", username: "ale", role: "ADMIN", pin: "2222", active: true, name: BARBER_NAMES.ALE },
  { key: "BENI", username: "beni", role: "BARBERO", pin: "3333", active: false, name: BARBER_NAMES.BENI },
];

export const LUCIO_FROM = "2026-10-01";

/** A qué usuario corresponde la columna "BENI / LUCIO" de la planilla según el mes. */
export function slotUsername(yearMonth: string): string {
  return `${yearMonth}-01` >= LUCIO_FROM ? "lucio" : "beni";
}

const ACCOUNTS: { key: string; name: string; kind: string; owner?: string }[] = [
  { key: "EFECTIVO", name: "Efectivo", kind: "EFECTIVO" },
  { key: "BRUBANK", name: "Brubank", kind: "TRANSFERENCIA" },
  { key: "BRUBANK_JUAN", name: "Brubank Juan", kind: "TRANSFERENCIA" },
  { key: "MP_JERE", name: "Mercado Pago Jere", kind: "TRANSFERENCIA", owner: "jere" },
  { key: "MEMBRESIA_EFECTIVO", name: "Membresía en efectivo", kind: "EFECTIVO" },
  { key: "MEMBRESIA_BANCO", name: "Membresía por Brubank/MP", kind: "TRANSFERENCIA" },
];

/** PIN por usuario. Por defecto los de ejemplo (solo desarrollo); en producción se generan al azar (`--random-pins`). */
export type PinMap = Record<"jere" | "ale" | "beni" | "lucio" | "juan", string>;
export const DEFAULT_PINS: PinMap = { jere: "1111", ale: "2222", beni: "3333", lucio: "4444", juan: "9999" };

export async function seedCore(db: PrismaClient, catalog: CatalogItem[] = DEFAULT_CATALOG, pins: PinMap = DEFAULT_PINS): Promise<Record<BarberKey, string>> {
  const ids = {} as Record<BarberKey, string>;
  for (const u of SEED_USERS) {
    const user = await db.user.upsert({
      where: { username: u.username },
      update: {},
      create: { username: u.username, name: u.name, role: u.role, isBarber: true, active: u.active, pinHash: hashPin(pins[u.username as keyof PinMap] ?? u.pin) },
    });
    ids[u.key] = user.id;
    for (const r of SYSTEM_RULES[u.key]) {
      await db.barberRule.upsert({
        where: { userId_validFrom: { userId: user.id, validFrom: r.validFrom } },
        update: { commissionBp: r.commissionBp, drinkDeduction: r.drinkDeduction, drinkCost: r.drinkCost },
        create: { userId: user.id, ...r },
      });
    }
  }
  const lucio = await db.user.upsert({
    where: { username: "lucio" },
    update: {},
    create: { username: "lucio", name: "Lucio", role: "BARBERO", isBarber: true, pinHash: hashPin(pins.lucio) },
  });
  // Lucio ocupa el puesto de Beni desde octubre con las mismas condiciones (60%, bebida de $3.000): confirmar.
  await db.barberRule.upsert({
    where: { userId_validFrom: { userId: lucio.id, validFrom: LUCIO_FROM } },
    update: {},
    create: { userId: lucio.id, validFrom: LUCIO_FROM, commissionBp: 6000, drinkDeduction: 3000, drinkCost: 3000, note: "Mismas condiciones que Beni (a confirmar)" },
  });
  // El dueño es Juan. Migración: antes se creaba un usuario genérico "dueno"; se renombra (mismo usuario, mismo PIN).
  const legacyOwner = await db.user.findUnique({ where: { username: "dueno" } });
  if (legacyOwner && !(await db.user.findUnique({ where: { username: "juan" } }))) {
    await db.user.update({ where: { id: legacyOwner.id }, data: { username: "juan", name: "Juan" } });
  }
  await db.user.upsert({
    where: { username: "juan" },
    update: {},
    create: { username: "juan", name: "Juan", role: "DUENO", isBarber: false, pinHash: hashPin(pins.juan) },
  });
  for (const [name, category] of Object.entries(CONCEPT_CATEGORY)) {
    await db.expenseConcept.upsert({ where: { name }, update: {}, create: { name, category } });
  }
  for (const a of ACCOUNTS) {
    const ownerId = a.owner ? (await db.user.findUnique({ where: { username: a.owner } }))?.id ?? null : null;
    await db.paymentAccount.upsert({
      where: { key: a.key },
      update: {},
      create: { key: a.key, name: a.name, kind: a.kind, ownerUserId: ownerId },
    });
  }
  for (const t of SYSTEM_TARIFFS) {
    await db.tariff.upsert({
      where: { serviceType_validFrom: { serviceType: t.serviceType, validFrom: t.validFrom } },
      update: { price: t.price },
      create: t,
    });
  }
  for (const c of catalog) {
    const prod = await db.product.upsert({ where: { name: c.name }, update: {}, create: { name: c.name, kind: c.kind } });
    await db.productPrice.upsert({
      where: { productId_validFrom: { productId: prod.id, validFrom: SYSTEM_FROM } },
      update: { price: c.price, cost: c.cost },
      create: { productId: prod.id, validFrom: SYSTEM_FROM, price: c.price, cost: c.cost },
    });
  }
  return ids;
}

