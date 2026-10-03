import { WithdrawForm, HandOverForm } from "../../components/CashForms";
import Shell from "../../components/Shell";
import { boxLedger, lastRendicionDate, type BoxKind } from "../../domain/cashbox";
import { formatARS, formatDate, todayBA } from "../../domain/money";
import { requireUser } from "../../lib/auth";
import { db } from "../../lib/db";
import { isAdmin } from "../../services/common";
import { getDayCoverage } from "../../services/figures";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { CIERRE: "Cierre del día", RETIRO_BARBERO: "Retiro de barbero", RENDICION: "Rendición al dueño", AJUSTE: "Ajuste" };

export default async function EfectivoPage() {
  const user = await requireUser();
  const admin = isAdmin(user);
  const today = todayBA();
  const [entries, barbers, coverage] = await Promise.all([
    db.cashBoxEntry.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } }),
    db.user.findMany({ where: { isBarber: true, active: true, deletedAt: null }, orderBy: { name: "asc" } }),
    getDayCoverage(db, today),
  ]);
  const { rows, balance } = boxLedger(entries.map((e) => ({ date: e.date, kind: e.kind as BoxKind, amount: e.amount, expectedAmount: e.expectedAmount })));
  const last = lastRendicionDate(entries.map((e) => ({ date: e.date, kind: e.kind as BoxKind, amount: e.amount })));
  const cov = coverage.map((c) => ({ userId: c.barberId, name: c.name, labor: c.labor, bankCovered: c.coveredByBank, allowed: c.cashAllowed, withdrawn: c.cashWithdrawn, remaining: c.remaining }));
  const covAll = barbers.map((b) => cov.find((c) => c.userId === b.id) ?? { userId: b.id, name: b.name, labor: 0, bankCovered: 0, allowed: 0, withdrawn: 0, remaining: 0 });

  return (
    <Shell user={user}>
      <h1>Efectivo</h1>
      {admin && (
        <>
          <div className="card" style={{ marginTop: 10 }}>
            <div className="muted">Efectivo acumulado en la caja</div>
            <div className="diff" style={{ fontSize: "2rem" }}>{formatARS(balance)}</div>
            <div className="muted">Última rendición: {last ? formatDate(last) : "todavía ninguna"}</div>
          </div>
          <h2>Rendir al dueño</h2>
          <HandOverForm balance={balance} />
        </>
      )}

      <h2>{admin ? "Retiro de un barbero" : "Retirar mi efectivo"}</h2>
      <p className="muted" style={{ marginTop: 0 }}>Se cobra del banco. Solo si el banco no cubrió lo que te toca hoy podés completar con efectivo.</p>
      <WithdrawForm barbers={admin ? barbers.map((b) => ({ id: b.id, name: b.name })) : [{ id: user.id, name: user.name }]} fixedUserId={admin ? undefined : user.id} coverage={admin ? covAll : covAll.filter((c) => c.userId === user.id)} />

      {admin && (
        <>
          <h2>Movimientos</h2>
          <ul className="list card" style={{ padding: "4px 14px" }}>
            {[...rows].reverse().slice(0, 40).map((r, i) => (
              <li key={i}>
                <span>
                  {KIND[r.kind] ?? r.kind}
                  <span className="muted"> · {formatDate(r.date)}</span>
                </span>
                <span className="num">
                  {r.amount > 0 ? "+" : ""}{formatARS(r.amount)} <span className="muted">→ {formatARS(r.balance)}</span>
                </span>
              </li>
            ))}
            {rows.length === 0 && <li className="muted">Sin movimientos todavía.</li>}
          </ul>
        </>
      )}
    </Shell>
  );
}
