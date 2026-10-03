import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { todayBA } from "./domain/money";
import { DEFAULT_PINS, seedCore, type PinMap } from "./seed";

const randomPins = process.argv.includes("--random-pins");
const pins: PinMap = randomPins
  ? { jere: pin(), ale: pin(), beni: pin(), lucio: pin(), juan: pin() }
  : DEFAULT_PINS;

function pin() {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

const db = new PrismaClient();
try {
  const existing = await db.user.count();
  await seedCore(db, undefined, pins);
  if (randomPins) {
    // Producción: arranque de las alertas = hoy, así los días anteriores sin datos no generan avisos.
    await db.setting.upsert({ where: { key: "alerts" }, update: {}, create: { key: "alerts", value: JSON.stringify({ startDate: todayBA() }) } });
    if (existing > 0) {
      console.log("La base ya tenía usuarios: se conservaron sus PIN actuales (no se cambió ninguno).");
    } else {
      console.log("Usuarios creados con PIN al azar. Anotalos ahora, no se vuelven a mostrar:\n");
      for (const [user, p] of Object.entries(pins)) if (user !== "beni") console.log(`  ${user.padEnd(6)} ${p}`);
    }
  } else {
    console.log("Listo: usuarios de ejemplo, tarifas, cuentas y productos cargados (ver README).");
  }
} finally {
  await db.$disconnect();
}
