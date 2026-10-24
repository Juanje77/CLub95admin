import { ProductSection, TariffSection, TeamSection, type ProductView, type TariffView, type UserView } from "../../components/ConfigForms";
import Shell from "../../components/Shell";
import { pickEffective } from "../../domain/rules";
import { todayBA } from "../../domain/money";
import { SERVICE_TYPES } from "../../domain/types";
import { requireAdmin } from "../../lib/auth";
import { db } from "../../lib/db";

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  const me = await requireAdmin();
  const today = todayBA();
  const [users, tariffs, products] = await Promise.all([
    db.user.findMany({ where: { deletedAt: null }, include: { rules: { where: { deletedAt: null } } }, orderBy: { createdAt: "asc" } }),
    db.tariff.findMany({ where: { deletedAt: null } }),
    db.product.findMany({ where: { deletedAt: null }, include: { prices: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
  ]);

  const userViews: UserView[] = users.map((u) => {
    const r = pickEffective(u.rules, today);
    return { id: u.id, name: u.name, username: u.username, role: u.role, active: u.active, isBarber: u.isBarber, isMe: u.id === me.id, rule: r ? { commissionBp: r.commissionBp, drinkDeduction: r.drinkDeduction, drinkCost: r.drinkCost, validFrom: r.validFrom } : null };
  });
  const tariffViews: TariffView[] = SERVICE_TYPES.flatMap((t) => {
    const mine = tariffs.filter((x) => x.serviceType === t);
    const cur = pickEffective(mine, today);
    return cur ? [{ serviceType: t, price: cur.price, validFrom: cur.validFrom, upcoming: mine.filter((x) => x.validFrom > today).sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1)).map((x) => ({ price: x.price, validFrom: x.validFrom })) }] : [];
  });
  const productViews: ProductView[] = products.map((p) => {
    const price = pickEffective(p.prices, today);
    return { id: p.id, name: p.name, kind: p.kind, price: price?.price ?? 0, cost: price?.cost ?? 0, stock: p.stock, minStock: p.minStock, active: p.active };
  });

  return (
    <Shell user={me}>
      <h1>Configuración</h1>
      <h2>Equipo y comisiones</h2>
      <TeamSection users={userViews} />
      <h2>Tarifas</h2>
      <TariffSection tariffs={tariffViews} />
      <h2>Productos y stock</h2>
      <ProductSection products={productViews} />
    </Shell>
  );
}
