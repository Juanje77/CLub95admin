import { PrismaClient } from "@prisma/client";
import { seedCore } from "./seed";

const db = new PrismaClient();
try {
  await seedCore(db);
  console.log("Listo: usuarios de ejemplo, tarifas, cuentas y productos cargados (ver README).");
} finally {
  await db.$disconnect();
}
