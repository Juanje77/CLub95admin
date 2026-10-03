/** Formato "$ 12.500" (ARS, sin decimales, miles con punto). */
export function formatARS(amount: number): string {
  const n = Math.round(amount);
  const sign = n < 0 ? "-" : "";
  const digits = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}$ ${digits}`;
}

/** dd/mm/aaaa a partir de "YYYY-MM-DD". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Fecha de hoy en Buenos Aires como "YYYY-MM-DD". */
export function todayBA(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(now);
}
