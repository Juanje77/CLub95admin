// Se corre al inicio del build de Vercel: falla rápido y en castellano si falta alguna variable de entorno.
const problems = [];
const warnings = [];

const db = process.env.DATABASE_URL ?? "";
if (!db) problems.push("Falta DATABASE_URL: la cadena de conexión de Postgres (empieza con postgresql://).");
else if (!/^postgres(ql)?:\/\//.test(db)) problems.push("DATABASE_URL no parece de Postgres (debe empezar con postgresql://). ¿Quedó la de SQLite de desarrollo?");

if (db && !process.env.DIRECT_URL && /-pooler\./.test(db)) {
  warnings.push("DATABASE_URL usa el pooler de Neon y no hay DIRECT_URL: crear las tablas puede fallar. Agregá DIRECT_URL con la conexión sin pooler (la 'unpooled').");
}

const secret = process.env.SESSION_SECRET ?? "";
if (secret.length < 16) problems.push("Falta SESSION_SECRET (mínimo 16 caracteres). Generá una con: openssl rand -base64 32");

for (const w of warnings) console.warn("⚠️  " + w);
if (problems.length) {
  console.error("\n❌ No se puede construir Club 95 todavía:\n");
  for (const p of problems) console.error("  • " + p);
  console.error(
    "\nCómo arreglarlo: Vercel → tu proyecto → Settings → Environment Variables. Agregá las variables que faltan con los entornos\n" +
      "Production y Preview tildados, y volvé a hacer Redeploy.\n" +
      "Si no tenés base: Storage → Create → Neon (Postgres), región São Paulo, y conectala a este proyecto.\n",
  );
  process.exit(1);
}
console.log("✔ Variables de entorno OK");
