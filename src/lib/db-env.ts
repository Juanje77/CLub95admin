import { createHmac } from "node:crypto";

type Env = Record<string, string | undefined>;

export interface DbEnv {
  /** Conexión que usa la app (puede ser con pooler). */
  databaseUrl?: string;
  /** Conexión directa (sin pooler), para crear las tablas. */
  directUrl?: string;
  /** Nombres (nunca valores) de las variables que se usaron, para los logs. */
  databaseVar?: string;
  directVar?: string;
}

const isPg = (v: string | undefined): v is string => !!v && /^postgres(ql)?:\/\//.test(v.trim());

/**
 * Las integraciones de Neon/Vercel crean las variables con nombres propios y, según cómo se conecte la base,
 * con un prefijo (p. ej. STORAGE_DATABASE_URL). Esto las encuentra sin que haya que copiarlas a mano.
 *  - Conexión de la app: DATABASE_URL, POSTGRES_PRISMA_URL, POSTGRES_URL (con o sin prefijo).
 *  - Conexión directa: DIRECT_URL, DATABASE_URL_UNPOOLED, POSTGRES_URL_NON_POOLING (con o sin prefijo).
 * Si DATABASE_URL está definida se respeta tal cual (así sigue funcionando SQLite en desarrollo).
 */
export function resolveDbEnv(env: Env): DbEnv {
  const keys = Object.keys(env).sort();
  const pick = (names: string[], suffixes: RegExp): [string, string] | undefined => {
    for (const n of names) if (isPg(env[n])) return [n, env[n]!.trim()];
    for (const k of keys) if (suffixes.test(k) && isPg(env[k])) return [k, env[k]!.trim()];
    return undefined;
  };
  const direct = pick(["DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"], /(_|^)(DATABASE_URL_UNPOOLED|POSTGRES_URL_NON_POOLING|DIRECT_URL)$/);
  const pooled = pick(["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"], /(_|^)(DATABASE_URL|POSTGRES_PRISMA_URL|POSTGRES_URL)$/);

  const explicit = env.DATABASE_URL?.trim();
  const databaseUrl = explicit || pooled?.[1];
  return {
    databaseUrl: databaseUrl || undefined,
    directUrl: direct?.[1],
    databaseVar: explicit ? "DATABASE_URL" : pooled?.[0],
    directVar: direct?.[0],
  };
}

/** Variables que "parecen" de base de datos, solo los nombres: sirve para diagnosticar sin mostrar secretos. */
export function dbLikeVarNames(env: Env): string[] {
  return Object.keys(env).filter((k) => /(DATABASE|POSTGRES|PG(HOST|USER|DATABASE)|NEON|STORAGE|DB_)/i.test(k)).sort();
}

/**
 * Clave para firmar la cookie de sesión. Si no se definió SESSION_SECRET, se deriva de la conexión a la base:
 * esa URL ya es un secreto (trae la contraseña) y quien la tiene ya accede a todos los datos, así que no agrega exposición.
 */
export function deriveSessionSecret(env: Env): string | undefined {
  const db = resolveDbEnv(env).databaseUrl;
  if (!db || !isPg(db)) return undefined;
  return createHmac("sha256", "club95-session-v1").update(db).digest("hex");
}
