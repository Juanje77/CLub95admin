import type { PrismaClient } from "@prisma/client";
import { verifyPin } from "../auth/pin";
import type { Role } from "../domain/types";
import { DomainError, type Actor } from "./common";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 10;

export interface SessionUser extends Actor {
  name: string;
  username: string;
  isBarber: boolean;
}

/** Login por usuario y PIN. Tras 5 intentos fallidos la cuenta se bloquea 10 minutos. */
export async function loginWithPin(db: PrismaClient, username: string, pin: string, now: Date = new Date()): Promise<SessionUser> {
  const user = await db.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  // Mismo mensaje para usuario inexistente, inactivo o PIN malo: no se revela cuál falló.
  const invalid = new DomainError("CREDENCIALES_INVALIDAS", "Usuario o PIN incorrecto.");
  if (!user || user.deletedAt || !user.active) throw invalid;
  if (user.lockedUntil && user.lockedUntil > now) {
    const mins = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60000);
    throw new DomainError("CUENTA_BLOQUEADA", `Demasiados intentos. Probá de nuevo en ${mins} minuto${mins === 1 ? "" : "s"}.`);
  }
  if (!verifyPin(pin, user.pinHash)) {
    const failed = user.failedAttempts + 1;
    const lock = failed >= MAX_FAILED_ATTEMPTS;
    await db.user.update({
      where: { id: user.id },
      data: { failedAttempts: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60000) : null },
    });
    throw invalid;
  }
  await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
  return { id: user.id, role: user.role as Role, name: user.name, username: user.username, isBarber: user.isBarber };
}

export async function getSessionUser(db: PrismaClient, id: string): Promise<SessionUser | null> {
  const user = await db.user.findUnique({ where: { id } });
  if (!user || user.deletedAt || !user.active) return null;
  return { id: user.id, role: user.role as Role, name: user.name, username: user.username, isBarber: user.isBarber };
}
