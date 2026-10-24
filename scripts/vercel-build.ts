// Build de Vercel: resuelve las variables de la base (Neon crea DATABASE_URL, DATABASE_URL_UNPOOLED, POSTGRES_URL...),
// genera el cliente de Postgres, crea/actualiza las tablas, crea los usuarios la primera vez y compila.
import { execSync } from "node:child_process";
import { dbLikeVarNames, resolveDbEnv } from "../src/lib/db-env";

const run = (cmd: string) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env: process.env });
};

const r = resolveDbEnv(process.env);

if (!r.databaseUrl || !/^postgres(ql)?:\/\//.test(r.databaseUrl)) {
  console.error("\n❌ No se puede construir Club 95 todavía:\n");
  console.error(
    r.databaseUrl
      ? "  • DATABASE_URL no parece de Postgres (debe empezar con postgresql://). ¿Quedó la de SQLite de desarrollo?"
      : "  • No encuentro la conexión a la base de datos Postgres (DATABASE_URL, POSTGRES_URL...).",
  );
  const seen = dbLikeVarNames(process.env);
  console.error(`\n  Variables relacionadas que sí veo (solo nombres): ${seen.length ? seen.join(", ") : "ninguna"}`);
  console.error(
    "\nCómo arreglarlo: Vercel → tu proyecto → Storage → conectá la base Neon a este proyecto (entornos Production y Preview),\n" +
      "o agregá DATABASE_URL en Settings → Environment Variables. Después volvé a hacer Redeploy.\n",
  );
  process.exit(1);
}

process.env.DATABASE_URL = r.databaseUrl;
console.log(`✔ Base de datos: uso ${r.databaseVar}`);
if (r.directUrl) {
  process.env.DIRECT_URL = r.directUrl;
  console.log(`✔ Conexión directa para crear las tablas: uso ${r.directVar}`);
} else if (/-pooler\./.test(r.databaseUrl)) {
  console.warn("⚠️  Uso el pooler de Neon y no encuentro la conexión sin pooler (DATABASE_URL_UNPOOLED): crear las tablas puede fallar.");
}
if ((process.env.SESSION_SECRET ?? "").length < 16) {
  console.log("ℹ️  No hay SESSION_SECRET: la clave de sesión se deriva de la conexión a la base (opcional, podés definir SESSION_SECRET).");
}

run("node scripts/prisma-pg.mjs");
run("prisma generate --schema prisma/schema.postgres.prisma");
run("prisma db push --schema prisma/schema.postgres.prisma --skip-generate");
// Primer deploy: crea los usuarios con PIN al azar y los muestra UNA vez en este log. Si ya hay usuarios, no toca nada.
run("tsx src/seed-cli.ts --random-pins");
run("next build");
