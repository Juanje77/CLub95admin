import GastosClient, { type ConceptView, type ExtraView } from "../../components/GastosClient";
import Shell from "../../components/Shell";
import { shiftMonth, todayBA } from "../../domain/money";
import { requireAdmin } from "../../lib/auth";
import { db } from "../../lib/db";
import { listExpenses, listExtraIncome, recurringStatus, type Category } from "../../services/expenses";

export const dynamic = "force-dynamic";

export default async function GastosPage({ searchParams }: { searchParams: Promise<{ mes?: string; concepto?: string }> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const today = todayBA();
  const month = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : today.slice(0, 7);
  const since = shiftMonth(month, -2) + "-01";
  const [{ rows, summary }, prev, recent, concepts, recurring, extra] = await Promise.all([
    listExpenses(db, { month, conceptId: sp.concepto || undefined }),
    listExpenses(db, { month: shiftMonth(month, -1) }),
    db.expense.findMany({ where: { deletedAt: null, date: { gte: since } }, select: { conceptId: true } }),
    db.expenseConcept.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    recurringStatus(db, month),
    listExtraIncome(db, month),
  ]);
  const uses = new Map<string, number>();
  for (const e of recent) uses.set(e.conceptId, (uses.get(e.conceptId) ?? 0) + 1);
  const topConcepts = [...uses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
  const conceptViews: ConceptView[] = concepts.map((c) => ({ id: c.id, name: c.name, category: c.category as Category, active: c.active }));
  const extraViews: ExtraView[] = extra.map((e) => ({ id: e.id, date: e.date, concept: e.concept, amount: e.amount, note: e.note }));
  return (
    <Shell user={user}>
      <GastosClient
        month={month}
        prevMonth={shiftMonth(month, -1)}
        nextMonth={shiftMonth(month, 1)}
        today={today}
        conceptFilter={sp.concepto ?? ""}
        concepts={conceptViews}
        rows={rows}
        summary={summary}
        recurring={recurring}
        extra={extraViews}
        topConcepts={topConcepts}
        prevTotal={prev.summary.total}
      />
    </Shell>
  );
}
