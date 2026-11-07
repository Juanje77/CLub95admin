import BarberosPagos from "../../components/BarberosPagos";
import Shell from "../../components/Shell";
import { shiftMonth, todayBA } from "../../domain/money";
import { requireAdmin } from "../../lib/auth";
import { db } from "../../lib/db";
import { getBarberPayables } from "../../services/barberpay";

export const dynamic = "force-dynamic";

export default async function BarberosPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const today = todayBA();
  const month = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : today.slice(0, 7);
  const data = await getBarberPayables(db, month);
  return (
    <Shell user={user}>
      <BarberosPagos data={data} today={today} prevMonth={shiftMonth(month, -1)} nextMonth={shiftMonth(month, 1)} />
    </Shell>
  );
}
