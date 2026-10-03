// Prueba de punta a punta en un navegador móvil. Requiere el servidor corriendo (BASE_URL) y una base con `npm run seed`.
// Uso: BASE_URL=http://localhost:3100 CHROME=/ruta/a/chrome SHOTS=/tmp/shots node tests/e2e/run.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = process.env.SHOTS ?? "/tmp/club95-shots";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
let step = 0;
const shot = (name) => page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, "0")}-${name}.png`, fullPage: true });
const check = (cond, msg) => { if (!cond) throw new Error("FALLÓ: " + msg); console.log("ok  -", msg); };
const login = async (user, pin) => {
  await page.goto(BASE + "/login");
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="pin"]', pin);
  await page.click('button[type="submit"]');
};
const text = () => page.locator("body").innerText();

// 1. Sin sesión → login
await page.goto(BASE + "/");
check(page.url().endsWith("/login"), "sin sesión redirige al login");
await shot("login");

// 2. PIN incorrecto
await login("lucio", "0000");
await page.getByText("Usuario o PIN incorrecto.").waitFor();
check(true, "PIN incorrecto muestra error");

// 3. Login del barbero
await login("lucio", "4444");
await page.waitForURL(BASE + "/");
await page.getByText("Caja abierta").waitFor();
check((await text()).includes("Lucio"), "el barbero entra a su caja");
await shot("hoy-vacio");

// 4. Cargar servicios (transferencia por defecto)
const tap = async (name) => { await page.getByRole("button", { name }).first().click(); await page.waitForLoadState("networkidle"); };
await tap(/^Corte \$ 20\.000/);
await page.getByText("Cobrado hasta ahora").waitFor();
await tap(/^Corte \$ 20\.000/);
await page.getByRole("button", { name: "Efectivo" }).click();
await tap(/^Barba y cejas/);
await tap(/Deshacer la última/);
await page.getByText("Se deshizo la última venta.").waitFor();
await tap(/^Barba y cejas/);
await page.getByRole("button", { name: "Transferencia" }).click();
await page.getByRole("button", { name: /Vender bebida/ }).click();
await tap(/^Coca-Cola/);
await tap(/^Socio \(membresía\)/);
await page.getByText("3 servicios + 1 socio").waitFor();
let t = await text();
check(t.includes("$ 56.700"), "cobrado = 2 cortes + barba y cejas + Coca = $ 56.700");
check(/en efectivo\s*\$ 15\.000/.test(t), "efectivo $ 15.000");
check(/por transferencia \/ MP\s*\$ 41\.700/.test(t), "transferencias $ 41.700");
check(t.includes("3 servicios + 1 socio"), "resumen por barbero: 3 servicios + 1 socio");
await shot("hoy-con-ventas");

// 5. Cierre con la plata correcta
await page.getByRole("link", { name: "Cierre" }).click();
await page.getByText("Declarar").waitFor();
await shot("cierre-vacio");
await page.getByLabel(/Efectivo que contaste/).fill("15000");
await page.getByLabel(/Transferencias a Brubank$/).fill("41700");
await page.getByLabel(/Cambio que dejás/).fill("6000");
check((await text()).includes("Diferencia") && !(await text()).includes("Nota obligatoria"), "sin diferencia no pide nota");
await shot("cierre-completo");
// con diferencia primero: exige nota
await page.getByLabel(/Efectivo que contaste/).fill("10000");
await page.getByText("Nota obligatoria").waitFor();
check(await page.getByRole("button", { name: /Cerrar caja del día/ }).isDisabled(), "con diferencia el botón queda deshabilitado hasta escribir la nota");
await shot("cierre-con-diferencia");
await page.getByLabel(/Efectivo que contaste/).fill("15000");
await page.getByRole("button", { name: /Cerrar caja del día/ }).click();
await page.getByText("Cerrada", { exact: true }).waitFor();
check(true, "la caja se cierra");
await shot("cierre-cerrada");

// 6. Cerrada: no se carga más
await page.getByRole("link", { name: "Hoy" }).click();
await page.getByText("Caja cerrada ✓").waitFor();
check((await text()).includes("está cerrada"), "con la caja cerrada no se pueden cargar ventas");
check((await page.getByRole("button", { name: /^Corte/ }).count()) === 0, "no hay botones de servicio");

// 7. El barbero ve su cobertura en Efectivo
await page.getByRole("link", { name: "Efectivo" }).click();
await page.getByText("Puede retirar en efectivo").waitFor();
t = await text();
check(/Le corresponde cobrar hoy\s*\$ 27\.600/.test(t), "le corresponde cobrar $ 27.600 (2×10.200 + 7.200)");
check(/Puede retirar en efectivo\s*\$ 0/.test(t), "el banco cubrió su parte: no puede retirar efectivo sin motivo");
await shot("efectivo-barbero");

// 8. Admin: efectivo acumulado y reapertura
await page.getByRole("button", { name: "Salir" }).click();
await page.waitForURL(/login/);
await login("ale", "2222");
await page.getByRole("link", { name: "Efectivo" }).click();
await page.getByText("Efectivo acumulado en la caja").waitFor();
check(/\$ 15\.000/.test(await text()), "el efectivo del cierre quedó en la fila acumulada ($ 15.000)");
await shot("efectivo-admin");
await page.getByRole("link", { name: "Cierre" }).click();
await page.getByText("Reabrir", { exact: true }).waitFor();
await page.getByLabel(/Motivo de la reapertura/).fill("Faltó cargar un corte");
await page.getByRole("button", { name: "Reabrir caja" }).click();
await page.getByText("Declarar").waitFor();
check(true, "el admin reabre con motivo");
await page.getByRole("link", { name: "Efectivo" }).click();
await page.getByText("Efectivo acumulado en la caja").waitFor();
check(/Efectivo acumulado en la caja\s*\$ 0/.test(await text()), "al reabrir, el efectivo sale de la fila acumulada");

// 9. Alertas
await page.getByRole("link", { name: /Alertas/ }).click();
await page.getByRole("heading", { name: "Alertas" }).waitFor();
await shot("alertas-admin");

await browser.close();
console.log("\nTODO OK — capturas en " + SHOTS);
