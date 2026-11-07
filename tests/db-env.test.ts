import { describe, expect, it } from "vitest";
import { dbLikeVarNames, deriveSessionSecret, resolveDbEnv } from "../src/lib/db-env";

const POOLED = "postgresql://u:p@ep-abc-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require";
const DIRECT = "postgresql://u:p@ep-abc.sa-east-1.aws.neon.tech/neondb?sslmode=require";

describe("variables de base de datos de Neon/Vercel", () => {
  it("usa DATABASE_URL y DIRECT_URL si están", () => {
    const r = resolveDbEnv({ DATABASE_URL: POOLED, DIRECT_URL: DIRECT });
    expect(r).toMatchObject({ databaseUrl: POOLED, directUrl: DIRECT, databaseVar: "DATABASE_URL", directVar: "DIRECT_URL" });
  });

  it("encuentra las que crea la integración de Neon sin prefijo", () => {
    const r = resolveDbEnv({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT, POSTGRES_URL: POOLED });
    expect(r.directUrl).toBe(DIRECT);
    expect(r.directVar).toBe("DATABASE_URL_UNPOOLED");
  });

  it("encuentra las que tienen prefijo (STORAGE_...)", () => {
    const r = resolveDbEnv({ STORAGE_DATABASE_URL: POOLED, STORAGE_DATABASE_URL_UNPOOLED: DIRECT, STORAGE_URL: "x" });
    expect(r).toMatchObject({ databaseUrl: POOLED, databaseVar: "STORAGE_DATABASE_URL", directUrl: DIRECT, directVar: "STORAGE_DATABASE_URL_UNPOOLED" });
  });

  it("también POSTGRES_URL / POSTGRES_URL_NON_POOLING", () => {
    const r = resolveDbEnv({ POSTGRES_URL: POOLED, POSTGRES_URL_NON_POOLING: DIRECT });
    expect(r).toMatchObject({ databaseUrl: POOLED, directUrl: DIRECT });
  });

  it("la conexión de la app nunca es la unpooled por error", () => {
    const r = resolveDbEnv({ STORAGE_DATABASE_URL_UNPOOLED: DIRECT });
    expect(r.databaseUrl).toBeUndefined();
    expect(r.directUrl).toBe(DIRECT);
  });

  it("respeta DATABASE_URL tal cual (SQLite en desarrollo)", () => {
    expect(resolveDbEnv({ DATABASE_URL: "file:./dev.db" }).databaseUrl).toBe("file:./dev.db");
  });

  it("ignora valores que no son de Postgres (comillas, psql ...)", () => {
    const r = resolveDbEnv({ STORAGE_DATABASE_URL: `psql '${POOLED}'` });
    expect(r.databaseUrl).toBeUndefined();
  });

  it("sin variables no inventa nada", () => {
    expect(resolveDbEnv({})).toEqual({ databaseUrl: undefined, directUrl: undefined, databaseVar: undefined, directVar: undefined });
  });

  it("lista solo nombres de variables relacionadas con la base", () => {
    expect(dbLikeVarNames({ STORAGE_URL: "x", PATH: "y", POSTGRES_HOST: "h", HOME: "z" })).toEqual(["POSTGRES_HOST", "STORAGE_URL"]);
  });
});

describe("clave de sesión derivada", () => {
  it("es estable para la misma base y distinta entre bases", () => {
    const a = deriveSessionSecret({ DATABASE_URL: POOLED });
    expect(a).toBe(deriveSessionSecret({ DATABASE_URL: POOLED }));
    expect(a).not.toBe(deriveSessionSecret({ DATABASE_URL: DIRECT }));
    expect(a!.length).toBeGreaterThanOrEqual(32);
  });
  it("no se puede derivar sin base de Postgres", () => {
    expect(deriveSessionSecret({})).toBeUndefined();
    expect(deriveSessionSecret({ DATABASE_URL: "file:./dev.db" })).toBeUndefined();
  });
});
