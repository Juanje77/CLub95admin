// Prueba de punta a punta en un navegador móvil: la planilla del mes (días en columnas, todo en cantidades).
// Requiere el servidor corriendo (BASE_URL) y una base con `npm run seed`. Hoy debe caer en octubre de 2026 (reloj del servidor).
// Uso: BASE_URL=http://localhost:3100 CHROME=/ruta/a/chrome SHOTS=/tmp/shots node tests/e2e/run.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp/club95-shots";
const TODAY = process.env.TODAY ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const YESTERDAY = new Date(Date.parse(TODAY + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
let step = 0;
const shot = (name) => page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, "0")}-${name}.png`, fullPage: false });
const check = (cond, msg) => { if (!cond) throw new Error("FALLÓ: " + msg); console.log("ok  -", msg); };
const login = async (user, pin) => {
  await page.goto(BASE + "/login");
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="pin"]', pin);
  await page.click('button[type="submit"]');
};
const cell = (id, date = TODAY) => page.locator(`input[data-cell="${id}|${date}"]`);
const calc = (key, date = TODAY) => page.locator(`td[data-calc="${key}|${date}"]`);
const type = async (id, value, date = TODAY) => {
  const c = cell(id, date);
  await c.fill(String(value));
  await c.press("Enter");
  await page.waitForLoadState("networkidle");
};
const calcIs = async (key, expected, date = TODAY) => {
  await page.waitForFunction(([k, d, e]) => document.querySelector(`td[data-calc="${k}|${d}"]`)?.textContent?.trim() === e, [key, date, expected]);
  check(true, `${key} = ${expected}`);
};

// 1. Sin sesión → login
await page.goto(BASE + "/");
check(page.url().endsWith("/login"), "sin sesión redirige al login");

// 2. Barbero entra a la planilla del mes
await login("lucio", "4444");
await page.waitForURL(BASE + "/");
await page.getByRole("heading", { name: /octubre 2026/i }).waitFor();
check((await page.locator("table.grid thead th.day").count()) === 31, "una columna por día del mes (31)");
await shot("planilla-vacia");

// 3. Solo cantidades: servicios, socios, bebida y cera
await type("Lucio|CORTE", 3);
await type("Lucio|CORTE_BARBA", 1);
await type("Lucio|SOCIO", 2);
await type("P|Coca-Cola", 1);
await type("P|Cera 1", 1);
await calcIs("c-ing", "108.700");       // 3×20.000 + 22.000 + 1.700 + 25.000
await calcIs("c-mo", "42.000");         // 3×10.200 + 11.400
await calcIs("c-debe", "66.700");       // ingresos − mano de obra
await calcIs("c-ganancia", "40.517");   // parte del local + margen bebida + margen cera
check((await cell("Lucio|CORTE").inputValue()) === "3", "la cantidad queda guardada en la celda");
await shot("planilla-con-cantidades");

// 4. Cada uno carga lo suyo, y solo hoy
check((await page.locator('input[data-cell^="Jere|"]').count()) === 0, "un barbero no puede editar las filas de otro");
check((await page.locator(`input[data-cell$="|${YESTERDAY}"]`).count()) === 0, "un barbero no puede editar días pasados");

// 5. Dinero ingresado: con diferencia pide nota
await type("A|Efectivo", 12000);
await type("A|Brubank", 90000);
await calcIs("a-dif", "-6.700");
await page.getByRole("button", { name: `Día ${Number(TODAY.slice(8))}`, exact: true }).click();
await page.getByText(/Nota obligatoria/).waitFor();
check(await page.getByRole("button", { name: /Cerrar el día/ }).isDisabled(), "con diferencia no se puede cerrar sin nota");
await shot("diferencia-de-caja");

// 6. Se corrige y se cierra
await type("A|Brubank", 96700);
await calcIs("a-dif", "✓");
await type("A|CAMBIO", 5000);
await page.getByRole("button", { name: /Cerrar el día/ }).click();
await page.getByText("Cerrado ✓").first().waitFor();
check((await cell("Lucio|CORTE").count()) === 0, "con el día cerrado las celdas ya no se editan");
await shot("dia-cerrado");

// 7. Admin: efectivo acumulado, edita un día pasado y reabre
await page.getByRole("button", { name: "Salir" }).click();
await page.waitForURL(/login/);
await login("ale", "2222");
await page.getByRole("link", { name: "Efectivo" }).click();
await page.getByText("Efectivo acumulado en la caja").waitFor();
check(/Efectivo acumulado en la caja\s*\$ 12\.000/.test(await page.locator("body").innerText()), "el efectivo del cierre quedó en la fila acumulada ($ 12.000)");
await page.getByRole("link", { name: "Planilla" }).click();
await page.getByRole("heading", { name: /octubre 2026/i }).waitFor();
await type("Jere|CORTE", 4, YESTERDAY);
await calcIs("c-ing", "80.000", YESTERDAY);
await calcIs("c-mo", "44.400", YESTERDAY); // 4 × (20.000 − 1.500) × 60%
check(true, "el admin puede cargar un día pasado");

await page.getByRole("button", { name: `Día ${Number(TODAY.slice(8))}`, exact: true }).click();
await page.getByLabel(/Motivo de la reapertura/).fill("Faltó cargar un corte");
await page.getByRole("button", { name: "Reabrir caja" }).click();
await cell("Lucio|CORTE").waitFor();
check(true, "el admin reabre el día con motivo y vuelve a ser editable");
await page.getByRole("link", { name: "Efectivo" }).click();
await page.getByText("Efectivo acumulado en la caja").waitFor();
check(/Efectivo acumulado en la caja\s*\$ 0/.test(await page.locator("body").innerText()), "al reabrir, el efectivo sale de la fila acumulada");

// 8. Navegación entre meses y alertas
await page.getByRole("link", { name: "Planilla" }).click();
await page.getByRole("link", { name: "Mes anterior" }).click();
await page.getByRole("heading", { name: /septiembre 2026/i }).waitFor();
check(true, "se puede navegar al mes anterior");
await page.getByRole("link", { name: /Alertas/ }).click();
await page.getByRole("heading", { name: "Alertas" }).waitFor();
await shot("alertas");

// 9. Configuración (admin): resetear PIN, ajustar stock, cambiar el propio PIN
page.on("dialog", (d) => d.accept());
await page.getByRole("link", { name: "Más" }).click();
await page.getByRole("link", { name: /Configuración/ }).click();
await page.getByRole("heading", { name: "Configuración" }).waitFor();
const jereRow = page.locator("li", { hasText: "Jere" }).filter({ has: page.getByRole("button", { name: "Resetear PIN" }) }).first();
await jereRow.getByRole("button", { name: "Resetear PIN" }).click();
await page.getByText("Nuevo PIN de Jere").waitFor();
const newPin = (await page.locator(".alert.WARN .diff").first().innerText()).trim();
check(/^\d{4}$/.test(newPin), "el reseteo muestra un PIN nuevo de 4 dígitos una sola vez");
await shot("config-pin-nuevo");
const cocaRow = page.locator("li", { hasText: "Coca-Cola" }).first();
await cocaRow.locator("summary").click();
await cocaRow.locator('input[placeholder="Cantidad"]').fill("24");
await cocaRow.getByLabel(/Motivo/).fill("Conteo inicial");
await cocaRow.getByRole("button", { name: "Ajustar stock" }).click();
await page.getByText(/Stock: -?\d+ → 24/).waitFor();
check(true, "se ajusta el stock con motivo");
await page.getByRole("link", { name: "Mi PIN" }).click();
await page.getByLabel("PIN actual").fill("2222");
await page.getByLabel("PIN nuevo (4 a 8 números)").fill("7391");
await page.getByLabel("Repetí el PIN nuevo").fill("7391");
await page.getByRole("button", { name: "Cambiar mi PIN" }).click();
await page.getByText("PIN actualizado.").waitFor();
await page.getByRole("button", { name: "Salir" }).click();
await page.waitForURL(/login/);
await login("ale", "2222");
await page.getByText("Usuario o PIN incorrecto.").waitFor();
await login("ale", "7391");
await page.waitForURL(BASE + "/");
check(true, "el PIN viejo deja de servir y el nuevo entra");
await page.getByRole("button", { name: "Salir" }).click();
await page.waitForURL(/login/);
await login("jere", newPin);
await page.waitForURL(BASE + "/");
check(true, "el barbero entra con el PIN que le generó el admin");

await browser.close();
console.log("\nTODO OK — capturas en " + SHOTS);
