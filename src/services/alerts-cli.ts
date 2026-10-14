import { PrismaClient } from "@prisma/client";
import { syncAlerts } from "./alerts";

const db = new PrismaClient();
try {
  const alerts = await syncAlerts(db);
  if (alerts.length === 0) console.log("Sin alertas: la caja está al día.");
  for (const a of alerts) console.log(`[${a.severity}] (${a.audience.join("/")}) ${a.message}`);
} finally {
  await db.$disconnect();
}
