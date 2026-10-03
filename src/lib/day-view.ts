import { SERVICE_TYPES, type ServiceType } from "../domain/types";
import { pickEffective, priceFor } from "../domain/rules";
import { getDayCoverage, getDayFigures, loadPricing } from "../services/figures";
import type { SessionUser } from "../services/auth";
import { isAdmin } from "../services/common";
import { db } from "./db";

export interface DayView {
  date: string;
  closed: boolean;
  close: Awaited<ReturnType<typeof db.cashClose.findUnique>>;
  barbers: { id: string; name: string }[];
  /** Barbero para el que se carga (el propio, o el elegido si es admin). */
  barberId: string;
  tariffs: { serviceType: ServiceType; price: number }[];
  products: { id: string; name: string; kind: string; price: number; stock: number; minStock: number }[];
  sales: { id: string; time: string; label: string; method: string | null; amount: number; barber: string; kind: string }[];
  figures: Awaited<ReturnType<typeof getDayFigures>>;
  perBarber: { id: string; name: string; services: number; memberships: number; gross: number }[];
  coverage: Awaited<ReturnType<typeof getDayCoverage>>;
}

const SERVICE_NAME: Record<string, string> = { CORTE: "Corte", CORTE_BARBA: "Corte y barba", BARBA_CEJAS: "Barba y cejas" };

export async function getDayView(date: string, user: SessionUser, wantedBarberId?: string): Promise<DayView> {
  const [barbers, close, figures, coverage, pricing, sales, products] = await Promise.all([
    db.user.findMany({ where: { isBarber: true, active: true, deletedAt: null }, orderBy: { name: "asc" } }),
    db.cashClose.findUnique({ where: { date } }),
    getDayFigures(db, date),
    getDayCoverage(db, date),
    loadPricing(db),
    db.sale.findMany({ where: { date, deletedAt: null }, orderBy: { createdAt: "asc" }, include: { product: true, user: true } }),
    db.product.findMany({ where: { deletedAt: null, active: true }, include: { prices: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
  ]);
  const admin = isAdmin(user);
  const barberId = admin ? (barbers.find((b) => b.id === wantedBarberId)?.id ?? (user.isBarber ? user.id : barbers[0]?.id ?? user.id)) : user.id;

  const perBarber = barbers.map((b) => {
    const mine = sales.filter((s) => s.userId === b.id);
    return {
      id: b.id,
      name: b.name,
      services: mine.filter((s) => s.kind === "SERVICE").reduce((a, s) => a + s.quantity, 0),
      memberships: mine.filter((s) => s.kind === "MEMBERSHIP").reduce((a, s) => a + s.quantity, 0),
      gross: mine.filter((s) => s.kind === "SERVICE").reduce((a, s) => a + s.quantity * s.unitPrice, 0),
    };
  });

  return {
    date,
    closed: !!close && !close.deletedAt && close.status === "CLOSED",
    close: close && !close.deletedAt ? close : null,
    barbers: barbers.map((b) => ({ id: b.id, name: b.name })),
    barberId,
    tariffs: SERVICE_TYPES.map((t) => ({ serviceType: t, price: safePrice(pricing.tariffs, t, date) })),
    products: products
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind, price: pickEffective(p.prices, date)?.price ?? 0, stock: p.stock, minStock: p.minStock }))
      .filter((p) => p.price > 0),
    sales: sales.map((s) => ({
      id: s.id,
      time: new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).format(s.createdAt),
      label: s.kind === "SERVICE" ? (SERVICE_NAME[s.serviceType ?? ""] ?? "Servicio") : s.kind === "MEMBRESIA" || s.kind === "MEMBERSHIP" ? "Socio (membresía)" : `${s.product?.name ?? "Producto"}${s.quantity > 1 ? ` ×${s.quantity}` : ""}`,
      method: s.paymentMethod,
      amount: s.quantity * s.unitPrice,
      barber: s.user?.name ?? "Local",
      kind: s.kind,
    })),
    figures,
    perBarber,
    coverage,
  };
}

function safePrice(tariffs: Parameters<typeof priceFor>[0], t: ServiceType, date: string): number {
  try {
    return priceFor(tariffs, t, date);
  } catch {
    return 0;
  }
}
