import type { Prisma, PrismaClient } from "@prisma/client";
import type { Role } from "../domain/types";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface Actor {
  id: string;
  role: Role;
}

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const isAdmin = (a: Actor) => a.role === "ADMIN" || a.role === "DUENO";

export async function audit(db: Db, entry: { userId?: string | null; entity: string; entityId: string; action: string; before?: unknown; after?: unknown }) {
  await db.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      before: entry.before === undefined ? null : JSON.stringify(entry.before),
      after: entry.after === undefined ? null : JSON.stringify(entry.after),
    },
  });
}
