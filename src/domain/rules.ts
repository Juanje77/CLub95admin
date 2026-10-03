import type { BarberRule, ServiceType, TariffEntry } from "./types";

/** Elige la entrada vigente a `date`: la de mayor `validFrom` que no supere la fecha. */
export function pickEffective<T extends { validFrom: string }>(entries: T[], date: string): T | undefined {
  let best: T | undefined;
  for (const e of entries) {
    if (e.validFrom <= date && (!best || e.validFrom > best.validFrom)) best = e;
  }
  return best;
}

export function priceFor(tariffs: TariffEntry[], serviceType: ServiceType, date: string): number {
  const t = pickEffective(
    tariffs.filter((x) => x.serviceType === serviceType),
    date,
  );
  if (!t) throw new Error(`Sin tarifa vigente para ${serviceType} al ${date}`);
  return t.price;
}

export function ruleFor(rules: BarberRule[], date: string): BarberRule {
  const r = pickEffective(rules, date);
  if (!r) throw new Error(`Sin regla de comisión vigente al ${date}`);
  return r;
}
