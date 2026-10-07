import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveSessionSecret } from "./db-env";

export const SESSION_COOKIE = "c95_session";
export const SESSION_HOURS = 12;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    // Sin SESSION_SECRET se deriva de la conexión a la base (que ya es un secreto). Recomendado: definir SESSION_SECRET.
    const derived = deriveSessionSecret(process.env);
    if (derived) return derived;
    throw new Error("Falta SESSION_SECRET (mínimo 16 caracteres) y no hay una base Postgres de la cual derivarla.");
  }
  return "dev-only-secret-change-me-please";
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Cookie firmada (HMAC-SHA256): `<payload>.<firma>`. El payload solo lleva el id de usuario y el vencimiento. */
export function signSession(userId: string, now: Date = new Date()): string {
  const payload = b64(JSON.stringify({ uid: userId, exp: now.getTime() + SESSION_HOURS * 3600_000 }));
  const sig = b64(createHmac("sha256", secret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined, now: Date = new Date()): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: string; exp: number };
    return exp > now.getTime() ? uid : null;
  } catch {
    return null;
  }
}
