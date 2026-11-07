import { execSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashPin } from "../../src/auth/pin";

let templatePath: string | null = null;

/** Crea (una sola vez) una base SQLite con el esquema aplicado y devuelve su ruta. */
function template(): string {
  if (templatePath) return templatePath;
  const dir = mkdtempSync(join(tmpdir(), "club95-tpl-"));
  const file = join(dir, "template.db");
  execSync("npx prisma db push --skip-generate --accept-data-loss", { env: { ...process.env, DATABASE_URL: `file:${file}` }, stdio: "pipe" });
  templatePath = file;
  return file;
}

/** Base nueva y vacía por test (copia del template). */
export function freshDb(): PrismaClient {
  const file = join(mkdtempSync(join(tmpdir(), "club95-")), "test.db");
  copyFileSync(template(), file);
  return new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
}

export interface Seed {
  jere: string;
  ale: string;
  lucio: string;
  juan: string;
}

export async function seed(db: PrismaClient): Promise<Seed> {
  const mk = (username: string, name: string, role: string, isBarber: boolean) =>
    db.user.create({ data: { username, name, role, isBarber, pinHash: hashPin("1234") } });
  const [jere, ale, lucio, juan] = [await mk("jere", "Jere", "BARBERO", true), await mk("ale", "Ale", "ADMIN", true), await mk("lucio", "Lucio", "BARBERO", true), await mk("juan", "Juan", "DUENO", false)];
  for (const [u, bp, drink] of [[jere, 6000, 1500], [ale, 10000, 3000], [lucio, 6000, 3000]] as const) {
    await db.barberRule.create({ data: { userId: u.id, validFrom: "2026-09-01", commissionBp: bp, drinkDeduction: drink, drinkCost: drink } });
  }
  for (const [t, price] of [["CORTE", 20000], ["CORTE_BARBA", 22000], ["BARBA_CEJAS", 15000]] as const) {
    await db.tariff.create({ data: { serviceType: t, validFrom: "2026-09-01", price } });
  }
  await db.paymentAccount.create({ data: { key: "MP_JERE", name: "MP Jere", kind: "TRANSFERENCIA", ownerUserId: jere.id } });
  await db.paymentAccount.create({ data: { key: "BRUBANK", name: "Brubank", kind: "TRANSFERENCIA" } });
  await db.paymentAccount.create({ data: { key: "EFECTIVO", name: "Efectivo", kind: "EFECTIVO" } });
  return { jere: jere.id, ale: ale.id, lucio: lucio.id, juan: juan.id };
}

export async function sale(
  db: PrismaClient,
  p: { date: string; userId: string; serviceType: string; quantity?: number; unitPrice: number; paymentMethod: string | null },
) {
  return db.sale.create({ data: { date: p.date, userId: p.userId, kind: "SERVICE", serviceType: p.serviceType, quantity: p.quantity ?? 1, unitPrice: p.unitPrice, drinkIncluded: true, paymentMethod: p.paymentMethod } });
}
