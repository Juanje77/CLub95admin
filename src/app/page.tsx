import PlanillaGrid from "../components/PlanillaGrid";
import Shell, { loadAlerts } from "../components/Shell";
import { todayBA } from "../domain/money";
import { requireUser } from "../lib/auth";
import { db } from "../lib/db";
import { isAdmin } from "../services/common";
import { getMonthGrid } from "../services/grid";

export const dynamic = "force-dynamic";

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayBA();
  const month = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : today.slice(0, 7);
  const [grid, alerts] = await Promise.all([getMonthGrid(db, month), loadAlerts(user)]);
  const [y, m] = month.split("-").map(Number) as [number, number];

  return (
    <Shell user={user} alertCount={alerts.length} wide>
      {alerts.slice(0, 2).map((a) => (
        <div key={a.key} className={`alert ${a.severity}`}>{a.message}</div>
      ))}
      <PlanillaGrid
        grid={grid}
        viewer={{ id: user.id, isAdmin: isAdmin(user) }}
        prevMonth={shiftMonth(month, -1)}
        nextMonth={shiftMonth(month, 1)}
        monthLabel={`${MONTH_NAMES[m - 1]} ${y}`}
      />
    </Shell>
  );
}
