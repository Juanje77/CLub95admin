// Genera prisma/schema.postgres.prisma a partir del esquema de desarrollo (SQLite).
// Se usa en el build de Vercel: el modelo es el mismo, solo cambia el proveedor.
//   DIRECT_URL (opcional): conexión directa (sin pooler) para `db push`, p. ej. la "non-pooling" de Neon.
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
if (!src.includes('provider = "sqlite"')) throw new Error('prisma/schema.prisma ya no usa provider = "sqlite": revisar scripts/prisma-pg.mjs');

let out = src.replace('provider = "sqlite"', 'provider  = "postgresql"');
out = out.replace(
  'url      = env("DATABASE_URL")',
  'url       = env("DATABASE_URL")' + (process.env.DIRECT_URL ? '\n  directUrl = env("DIRECT_URL")' : ""),
);
// Motor nativo para el entorno de Vercel (Linux, OpenSSL 3).
out = out.replace('provider = "prisma-client-js"', 'provider      = "prisma-client-js"\n  binaryTargets = ["native", "rhel-openssl-3.0.x"]');

writeFileSync(new URL("../prisma/schema.postgres.prisma", import.meta.url), out);
console.log("Generado prisma/schema.postgres.prisma" + (process.env.DIRECT_URL ? " (con DIRECT_URL)" : ""));
