// Auditoría de interfaz: recorre todas las pantallas como admin y como barbero, en celular y escritorio, en claro y oscuro,
// y detecta desborde horizontal, botones/enlaces demasiado chicos, campos sin etiqueta y errores de consola.
// Uso: CHROME=... bash scripts/audit-ui.sh   (deja capturas en /tmp/club95-audit)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = "/tmp/club95-audit";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const ADMIN_PAGES = ["/", "/socios", "/gastos", "/panel", "/alertas", "/mas", "/efectivo", "/cuentas", "/barberos", "/config", "/auditoria", "/cuenta", "/socios/importar", "/socios?vista=cajas"];
const BARBER_PAGES = ["/", "/socios", "/alertas", "/efectivo", "/cuenta"];
const problems = [];

async function run(user, pin, pages, vp, scheme) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/login");
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="pin"]', pin);
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/");
  for (const path of pages) {
    errors.length = 0;
    const res = await page.goto(BASE + path);
    await page.waitForLoadState("networkidle");
    const tag = `${user}${path} ${vp.width}px ${scheme}`;
    if (!res || res.status() >= 400) problems.push(`${tag}: HTTP ${res?.status()}`);
    const r = await page.evaluate(() => {
      const out = { hscroll: document.documentElement.scrollWidth > window.innerWidth + 1, small: [], nolabel: [], clipped: [] };
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
      for (const el of document.querySelectorAll("button, a[href], summary, select, input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio])")) {
        if (!vis(el) || el.closest("table.grid") || el.closest("nav.tabs")) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 40 && r.width < 200) out.small.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || el.getAttribute("name") || "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        const named = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (el.labels && el.labels.length) || el.textContent?.trim() || el.closest("label") || el.getAttribute("placeholder") || el.getAttribute("title");
        if (!named) out.nolabel.push(`${el.tagName.toLowerCase()}[${el.getAttribute("name") || el.getAttribute("type") || ""}]`);
      }
      for (const el of document.querySelectorAll("main *, .card, .card *")) {
        if (!vis(el) || el.closest("table") || el.closest("[style*='overflow']") || el.closest(".hbars")) continue;
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 2 && el.children.length === 0 && el.textContent?.trim()) out.clipped.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}"`);
      }
      return out;
    });
    if (r.hscroll) problems.push(`${tag}: scroll horizontal de la página`);
    for (const s of [...new Set(r.small)].slice(0, 6)) problems.push(`${tag}: objetivo táctil chico ${s}`);
    for (const s of [...new Set(r.nolabel)].slice(0, 6)) problems.push(`${tag}: sin etiqueta ${s}`);
    for (const s of [...new Set(r.clipped)].slice(0, 6)) problems.push(`${tag}: texto fuera de pantalla ${s}`);
    for (const e of errors.slice(0, 3)) problems.push(`${tag}: consola: ${e.slice(0, 160)}`);
    if (scheme === "dark" || vp.width > 600) await page.screenshot({ path: `${OUT}/${user}-${path.replace(/[^a-z0-9]/gi, "_") || "home"}-${vp.width}-${scheme}.png` });
  }
  await ctx.close();
}

for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const scheme of ["light", "dark"]) {
    await run("ale", "2222", ADMIN_PAGES, vp, scheme);
    await run("lucio", "4444", BARBER_PAGES, vp, scheme);
  }
}
// Un barbero no debe poder abrir pantallas de admin.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + "/login");
  await page.fill('input[name="username"]', "lucio");
  await page.fill('input[name="pin"]', "4444");
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE + "/");
  for (const p of ["/panel", "/gastos", "/barberos", "/cuentas", "/config", "/auditoria", "/mas"]) {
    await page.goto(BASE + p);
    if (new URL(page.url()).pathname === p) problems.push(`lucio puede abrir ${p}`);
  }
  await ctx.close();
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "SIN PROBLEMAS");
console.log(`\n${problems.length} hallazgos`);
