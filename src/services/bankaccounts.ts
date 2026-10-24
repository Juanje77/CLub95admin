import type { PrismaClient } from "@prisma/client";
import type { Db } from "./common";
import { getMonthGrid } from "./grid";

/**
 * Por dónde entra la plata de cada cosa y de qué cuenta se paga. Por defecto (lo que cuenta el dueño):
 *  - Cuenta de Juan (BRUBANK_JUAN): los socios que pagan por transferencia y la venta de bebidas, ceras, polvos y aceites.
 *  - Cuenta de Jere (MP_JERE): los cortes diarios de Jere que no le pagaron en efectivo.
 *  - Cuenta de Ale (BRUBANK): los cortes diarios de Lucio y de Ale que no les pagaron en efectivo; de esa cuenta se le paga a Lucio su 60 %
 *    y Ale retira su parte.
 * Se puede cambiar en Setting "accountRouting" con la misma forma que DEFAULT_ROUTING.
 */
export interface Route {
  /** Clave de la cuenta (PaymentAccount.key). */
  key: string;
  /** De quién es la cuenta, para mostrar. */
  who: string;
  /** Usuarios (username) cuyos cortes entran a esta cuenta. */
  barbers: string[];
  /** Entran las transferencias de socios. */
  memberTransfers?: boolean;
  /** Entra la venta de bebidas sueltas. */
  drinks?: boolean;
  /** Entra la venta de ceras, polvos y aceites. */
  products?: boolean;
  /** Usuarios (username) a los que se les paga su parte desde esta cuenta (si es el dueño de la cuenta, la "retira"). */
  pays?: string[];
  /** Usuario (username) dueño de la cuenta: lo que le corresponde lo retira en lugar de que se le pague. */
  owner?: string;
}

export const DEFAULT_ROUTING: Route[] = [
  { key: "BRUBANK_JUAN", who: "Juan (dueño)", barbers: [], memberTransfers: true, drinks: true, products: true },
  { key: "MP_JERE", who: "Jere", barbers: ["jere"] },
  { key: "BRUBANK", who: "Ale", owner: "ale", barbers: ["lucio", "ale"], pays: ["lucio", "ale"] },
];

export interface AccountLine { label: string; amount: number }
export interface BankAccountView {
  key: string;
  name: string;
  who: string;
  /** Lo que entraría si nada se hubiera pagado en efectivo. */
  expected: AccountLine[];
  expectedTotal: number;
  /** Lo que se ingresó de verdad en esta cuenta (dinero ingresado de cada día). */
  declared: number;
  /** Ingresado − esperado: si es negativo, esa parte se pagó en efectivo o todavía no se cargó. */
  gap: number;
  /** Lo que se paga desde esta cuenta (la parte de los barberos). */
  payouts: AccountLine[];
  payoutsTotal: number;
  /** Ingresado − lo que se paga desde la cuenta. */
  remaining: number;
}
export interface BankAccounts {
  month: string;
  accounts: BankAccountView[];
  /** Efectivo ingresado en el mes (cierres de caja). */
  cashDeclared: number;
  /** Gastos del mes pagados en efectivo. */
  cashExpenses: number;
}

/** De quién es cada cuenta según el recorrido (clave → "Juan", "Ale"…), para mostrar nombres. */
export async function accountOwners(db: Db): Promise<Map<string, string>> {
  return new Map((await loadRouting(db)).map((r) => [r.key, r.who.replace(/ \(.*\)$/, "")]));
}

async function loadRouting(db: Db): Promise<Route[]> {
  const row = await db.setting.findUnique({ where: { key: "accountRouting" } });
  try {
    const v = row ? (JSON.parse(row.value) as unknown) : null;
    if (Array.isArray(v) && v.length && v.every((r) => r && typeof r.key === "string" && typeof r.who === "string" && Array.isArray(r.barbers))) return v as Route[];
  } catch {
    /* se usa el recorrido por defecto */
  }
  return DEFAULT_ROUTING;
}

export async function getBankAccounts(db: Db, month: string, now: Date = new Date()): Promise<BankAccounts> {
  const [grid, users, accounts, routing, memberPays, expenses] = await Promise.all([
    getMonthGrid(db as PrismaClient, month, now),
    db.user.findMany({ where: { isBarber: true } }),
    db.paymentAccount.findMany({ where: { deletedAt: null } }),
    loadRouting(db),
    db.memberLedger.findMany({ where: { deletedAt: null, kind: "PAGO", method: "BANCO", date: { gte: `${month}-01`, lte: `${month}-31` } } }),
    db.expense.findMany({ where: { deletedAt: null, accountKey: { not: null }, date: { gte: `${month}-01`, lte: `${month}-31` } }, select: { accountKey: true, amount: true } }),
  ]);
  const spentBy = new Map<string, number>();
  for (const e of expenses) spentBy.set(e.accountKey!, (spentBy.get(e.accountKey!) ?? 0) + e.amount);
  const idOf = new Map(users.map((u) => [u.username, u.id]));
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const accName = new Map(accounts.map((a) => [a.key, a.name]));

  let drinks = 0;
  let products = 0;
  const gross = new Map<string, number>();
  const labor = new Map<string, number>();
  let cashDeclared = 0;
  const declaredBy = new Map<string, number>();
  for (const d of grid.days) {
    drinks += d.result.drinksRevenue;
    products += d.result.productsRevenue;
    for (const b of d.result.barbers) {
      gross.set(b.userId, (gross.get(b.userId) ?? 0) + b.gross);
      labor.set(b.userId, (labor.get(b.userId) ?? 0) + b.labor);
    }
    for (const [key, amount] of Object.entries(d.declared)) {
      declaredBy.set(key, (declaredBy.get(key) ?? 0) + amount);
      if (key === "EFECTIVO") cashDeclared += amount;
    }
  }
  const memberTransfers = memberPays.reduce((s, l) => s + l.credit, 0);

  const views: BankAccountView[] = routing.map((r) => {
    const expected: AccountLine[] = [];
    if (r.memberTransfers) expected.push({ label: "Socios que pagaron por transferencia", amount: memberTransfers });
    if (r.drinks) expected.push({ label: "Venta de bebidas", amount: drinks });
    if (r.products) expected.push({ label: "Venta de ceras, polvos y aceites", amount: products });
    for (const u of r.barbers) {
      const id = idOf.get(u);
      expected.push({ label: `Cortes de ${id ? nameOf.get(id) : u}`, amount: id ? gross.get(id) ?? 0 : 0 });
    }
    const payouts: AccountLine[] = (r.pays ?? []).map((u) => {
      const id = idOf.get(u);
      const name = id ? nameOf.get(id) : u;
      return { label: u === r.owner ? `Retiro de ${name} (su parte de los cortes)` : `Pago a ${name} (su parte de los cortes)`, amount: id ? labor.get(id) ?? 0 : 0 };
    });
    const spent = spentBy.get(r.key) ?? 0;
    if (spent > 0) payouts.push({ label: "Gastos pagados desde esta cuenta", amount: spent });
    const expectedTotal = expected.reduce((s, l) => s + l.amount, 0);
    const payoutsTotal = payouts.reduce((s, l) => s + l.amount, 0);
    const declared = declaredBy.get(r.key) ?? 0;
    return { key: r.key, name: accName.get(r.key) ?? r.key, who: r.who, expected, expectedTotal, declared, gap: declared - expectedTotal, payouts, payoutsTotal, remaining: declared - payoutsTotal };
  });
  return { month, accounts: views, cashDeclared, cashExpenses: spentBy.get("EFECTIVO") ?? 0 };
}
