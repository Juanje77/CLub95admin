import { defineConfig } from "vitest/config";

// Los tests crean una base SQLite temporal (prisma db push) la primera vez en cada proceso: con la máquina cargada puede pasar de los 5 s por defecto.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
