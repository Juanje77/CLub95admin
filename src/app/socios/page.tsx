import SociosGrid, { type LedgerView, type PlanillaDiff } from "../../components/SociosGrid";
import Shell from "../../components/Shell";
import { formatDate, shiftMonth, todayBA } from "../../domain/money";
import { requireUser } from "../../lib/auth";
import { db } from "../../lib/db";
import { isAdmin } from "../../services/common";
import { getMonthGrid, monthDates } from "../../services/grid";
import { getMemberLedger, getMembersMonth } from "../../services/members";

export const dynamic = "force-dynamic";

export default async function SociosPage({ searchParams }: { searchParams: Promise<{ mes?: string; socio?: string }> }) {
  const user = await requireUser();
  const admin = isAdmin(user);
  const sp = await searchParams;
  const today = todayBA();
  const month = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : today.slice(0, 7);
  const [data, barbers] = await Promise.all([
    getMembersMonth(db, month),
    db.user.findMany({ where: { isBarber: true, active: true, deletedAt: null }, orderBy: { createdAt: "asc" } }),
  ]);
  const ledger: LedgerView[] = admin && sp.socio ? (await getMemberLedger(db, sp.socio)).map((l) => ({ id: l.id, date: l.date, kind: l.kind, debit: l.debit, credit: l.credit, method: l.method, note: l.note })) : [];

  // La planilla cuenta "socios" por barbero y día; la asistencia los identifica. Si no coinciden, se avisa (no se corrige solo).
  const diffs: PlanillaDiff[] = [];
  if (admin) {
    const [grid, att] = await Promise.all([getMonthGrid(db, month), db.attendance.findMany({ where: { deletedAt: null, date: { gte: `${month}-01`, lte: `${month}-31` } } })]);
    const nameOf = new Map(grid.barbers.map((b) => [b.id, b.name]));
    for (const d of grid.days) {
      for (const b of grid.barbers) {
        const inGrid = d.memberships[b.id] ?? 0;
        const marked = att.filter((a) => a.date === d.date && a.userId === b.id).length;
        if (inGrid !== marked) diffs.push({ text: `${formatDate(d.date)} · ${nameOf.get(b.id)}: la planilla tiene ${inGrid} socio${inGrid === 1 ? "" : "s"} y la asistencia marca ${marked}.` });
      }
    }
  }

  return (
    <Shell user={user} wide>
      <SociosGrid
        data={data}
        days={monthDates(month)}
        today={today}
        prevMonth={shiftMonth(month, -1)}
        nextMonth={shiftMonth(month, 1)}
        isAdmin={admin}
        barbers={barbers.map((b) => ({ id: b.id, name: b.name }))}
        selectedId={admin ? (sp.socio ?? null) : null}
        ledger={ledger}
        diffs={diffs}
      />
    </Shell>
  );
}
