import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Hash de PIN con scrypt. Formato: scrypt$<salt hex>$<hash hex>. */
export function hashPin(pin: string): string {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("El PIN debe tener entre 4 y 8 dígitos");
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const got = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(got, expected);
}
