import { PrismaClient } from "@prisma/client";
import { computeDay } from "../domain/cash";
import { SERVICE_TYPES } from "../domain/types";
import { hashPin } from "../auth/pin";
import { CONCEPT_CATEGORY, type ExpenseRow } from "./expenses";
import type { BarberKey, MonthData } from "./month";
import { BARBER_NAMES, SYSTEM_FROM, SYSTEM_RULES, SYSTEM_TARIFFS } from "./rules";
import { declaredPayments, extraSales } from "./verify";
import type { Issue } from "./verify";

const KEYS: BarberKey[] = ["JERE", "ALE", "BENI"];

const LOOSE_PRODUCTS: Record<string, { name: string; priceKey: string }> = {
  MONSTER_ROSA: { name: "Monster rosa", priceKey: "MONSTER" },
  MONSTER_ORIGINAL: { name: "Monster original", priceKey: "MONSTER" },
  MONSTER_MANGO: { name: "Monster mango", priceKey: "MONSTER" },
  MONSTER_SIN_AZUCAR: { name: "Monster sin azúcar", priceKey: "MONSTER" },
  COCA: { name: "Coca-Cola", priceKey: "COCA" },
  SPRITE: { name: "Sprite", priceKey: "SPRITE" },
  FANTA: { name: "Fanta", priceKey: "FANTA" },
  ACQUARIUS: { name: "Aquarius", priceKey: "ACQUARIUS" },
};

const SEED_USERS: { key: BarberKey; username: string; role: string; pin: string }[] = [
  { key: "JERE", username: "jere", role: "BARBERO", pin: "1111" },
  { key: "ALE", username: "ale", role: "ADMIN", pin: "2222" },
  { key: "BENI", username: "beni", role: "BARBERO", pin: "3333" },
];

export async function seedBase(db: PrismaClient, m: MonthData): Promise<Record<BarberKey, string>> {
  const ids = {} as Record<BarberKey, string>;
  for (const u of SEED_USERS) {
    const user = await db.user.upsert({
      where: { username: u.username },
      update: {},
      create: { username: u.username, name: BARBER_NAMES[u.key], role: u.role, isBarber: true, pinHash: hashPin(u.pin) },
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
  await db.user.upsert({
    where: { username: "dueno" },
    update: {},
    create: { username: "dueno", name: "Dueño", role: "DUENO", isBarber: false, pinHash: hashPin("9999") },
  });
  for (const t of SYSTEM_TARIFFS) {
    await db.tariff.upsert({
      where: { serviceType_validFrom: { serviceType: t.serviceType, validFrom: t.validFrom } },
      update: { price: t.price },
      create: t,
    });
  }
  const p = m.params;
  const catalog: { name: string; kind: string; price: number; cost: number }[] = [
    { name: "Gaseosa de vidrio (incluida en el corte)", kind: "BEBIDA", price: 0, cost: p.glassDrinkCost },
    ...Object.values(LOOSE_PRODUCTS).map((lp) => ({
      name: lp.name,
      kind: "BEBIDA",
      price: p.looseDrinkPrice[lp.priceKey] ?? 0,
      cost: p.looseDrinkCost[lp.priceKey] ?? 0,
    })),
    { name: "Cera 1", kind: "CERA", price: p.waxPrice, cost: p.waxCost },
    { name: "Cera 2", kind: "CERA", price: p.waxPrice, cost: p.waxCost },
    { name: "Cera 3", kind: "CERA", price: p.waxPrice, cost: p.waxCost },
    { name: "Polvo", kind: "POLVO", price: p.powderPrice, cost: p.powderCost },
    { name: "Aceite", kind: "ACEITE", price: p.oilPrice, cost: p.oilCost },
  ];
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

export interface LoadResult {
  batchId: string;
  sales: number;
  closes: number;
  expenses: number;
  roundingDelta: number;
}

export async function loadMonth(
  db: PrismaClient,
  opts: { fileName: string; yearMonth: string; month: MonthData; expenses: ExpenseRow[]; issues: Issue[] },
): Promise<LoadResult> {
  const { month: m, yearMonth } = opts;
  const ids = await seedBase(db, m);
  const prefix = `${yearMonth}-`;
  const productByName = new Map((await db.product.findMany()).map((p) => [p.name, p]));

  return db.$transaction(
    async (tx) => {
      // Reimportar = dar de baja lógica lo importado antes para ese mes.
      const now = new Date();
      await tx.sale.updateMany({ where: { source: "IMPORT", date: { startsWith: prefix }, deletedAt: null }, data: { deletedAt: now } });
      await tx.expense.updateMany({ where: { source: "IMPORT", date: { startsWith: prefix }, deletedAt: null }, data: { deletedAt: now } });
      await tx.cashClose.updateMany({ where: { source: "IMPORT", date: { startsWith: prefix }, deletedAt: null }, data: { deletedAt: now } });

      const batch = await tx.importBatch.create({
        data: { scope: yearMonth, fileName: opts.fileName, issues: { create: opts.issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message })) } },
      });

      let sales = 0;
      const saleRows: {
        date: string; userId: string | null; kind: string; serviceType?: string; productId?: string;
        quantity: number; unitPrice: number; drinkIncluded: boolean; source: string; importBatchId: string;
      }[] = [];
      for (const day of m.days) {
        for (const k of KEYS) {
          const prices = k === "JERE" ? m.params.jere : m.params.base;
          for (const t of SERVICE_TYPES) {
            const q = day.barbers[k].services[t];
            if (q > 0) saleRows.push({ date: day.date, userId: ids[k], kind: "SERVICE", serviceType: t, quantity: q, unitPrice: prices[t], drinkIncluded: true, source: "IMPORT", importBatchId: batch.id });
          }
          if (day.barbers[k].memberships > 0) {
            saleRows.push({ date: day.date, userId: ids[k], kind: "MEMBERSHIP", quantity: day.barbers[k].memberships, unitPrice: 0, drinkIncluded: true, source: "IMPORT", importBatchId: batch.id });
          }
        }
        for (const [key, qty] of Object.entries(day.looseDrinks)) {
          const lp = LOOSE_PRODUCTS[key];
          const prod = lp && productByName.get(lp.name);
          if (qty > 0 && lp && prod) saleRows.push({ date: day.date, userId: null, kind: "PRODUCT", productId: prod.id, quantity: qty, unitPrice: m.params.looseDrinkPrice[lp.priceKey] ?? 0, drinkIncluded: false, source: "IMPORT", importBatchId: batch.id });
        }
        const prodMap: Record<string, [string, number]> = {
          CERA_1: ["Cera 1", m.params.waxPrice], CERA_2: ["Cera 2", m.params.waxPrice], CERA_3: ["Cera 3", m.params.waxPrice],
          POLVO: ["Polvo", m.params.powderPrice], ACEITE: ["Aceite", m.params.oilPrice],
        };
        for (const [key, qty] of Object.entries(day.products)) {
          const entry = prodMap[key];
          const prod = entry && productByName.get(entry[0]);
          if (qty > 0 && entry && prod) saleRows.push({ date: day.date, userId: null, kind: "PRODUCT", productId: prod.id, quantity: qty, unitPrice: entry[1], drinkIncluded: false, source: "IMPORT", importBatchId: batch.id });
        }
      }
      for (const row of saleRows) await tx.sale.create({ data: row });
      sales = saleRows.length;

      let closes = 0;
      for (const day of m.days) {
        const payments = declaredPayments(day);
        const hasDeclared = Object.values(day.declared).some((v) => v !== 0);
        if (!hasDeclared) continue;
        const r = computeDay({
          date: day.date,
          tariffs: SYSTEM_TARIFFS,
          barbers: KEYS.map((k) => ({ barberId: k, rules: SYSTEM_RULES[k], services: day.barbers[k].services })),
          extraSales: extraSales(day, m),
        });
        const close = await tx.cashClose.create({
          data: {
            date: day.date, userId: null, expectedIncome: r.expectedIncome, labor: r.labor, expectedNet: r.expectedNet,
            declaredTotal: payments, changeLeft: day.declared.CAMBIO ?? 0, difference: payments - r.expectedIncome,
            status: "CLOSED", source: "IMPORT", closedAt: now,
            lines: { create: Object.entries(day.declared).filter(([k, v]) => k !== "CAMBIO" && v !== 0).map(([account, amount]) => ({ account, amount })) },
          },
        });
        void close;
        closes++;
      }

      let expenses = 0;
      let roundingDelta = 0;
      for (const e of opts.expenses) {
        const category = CONCEPT_CATEGORY[e.concept];
        if (!category) continue;
        const concept = await tx.expenseConcept.upsert({ where: { name: e.concept }, update: {}, create: { name: e.concept, category } });
        const amount = Math.round(e.amount);
        roundingDelta += amount - e.amount;
        await tx.expense.create({ data: { date: e.date, conceptId: concept.id, amount, description: e.description || null, source: "IMPORT", importBatchId: batch.id } });
        expenses++;
      }
      await tx.auditLog.create({ data: { entity: "ImportBatch", entityId: batch.id, action: "IMPORT", after: JSON.stringify({ scope: yearMonth, sales, closes, expenses }) } });
      return { batchId: batch.id, sales, closes, expenses, roundingDelta };
    },
    { timeout: 60000 },
  );
}
