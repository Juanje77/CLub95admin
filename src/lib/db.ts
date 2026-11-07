import { PrismaClient } from "@prisma/client";
import { resolveDbEnv } from "./db-env";

const g = globalThis as unknown as { prisma?: PrismaClient };
// Acepta las variables con los nombres que crea la integración de Neon (con o sin prefijo).
const url = resolveDbEnv(process.env).databaseUrl;
export const db = g.prisma ?? new PrismaClient(url ? { datasourceUrl: url } : undefined);
if (process.env.NODE_ENV !== "production") g.prisma = db;
