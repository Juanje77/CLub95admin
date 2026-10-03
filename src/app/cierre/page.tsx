import CloseForm from "../../components/CloseForm";
import ReopenForm from "../../components/ReopenForm";
import Shell from "../../components/Shell";
import { formatARS, formatDate, todayBA } from "../../domain/money";
import { requireUser } from "../../lib/auth";
import { db } from "../../lib/db";
import { getDayFigures } from "../../services/figures";
import { isAdmin } from "../../services/common";

export const dynamic = "force-dynamic";

export default async function CierrePage({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayBA();
  const admin = isAdmin(user);
  const date = admin && sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) && sp.fecha <= today ? sp.fecha : today;

  const [f, close, accounts, lastClose] = await Promise.all([
    getDayFigures(db, date),
    db.cashClose.findUnique({ where: { date }, include: { lines: true } }),
    db.paymentAccount.findMany({ where: { active: true, deletedAt: null, kind: "TRANSFERENCIA", key: { not: { startsWith: "MEMBRESIA" } } }, orderBy: { name: "asc" } }),
    db.cashClose.findFirst({ where: { deletedAt: null, status: "CLOSED", date: { lt: date } }, orderBy: { date: "desc" } }),
  ]);
  const closed = !!close && !close.deletedAt && close.status === "CLOSED";

  return (
    <Shell user={user}>
      <h1>Cierre de caja · {formatDate(date)}</h1>

      <h2>Lo que tiene que haber</h2>
      <div className="card">
        <div className="row spread"><span>Ingresos del día</span><span className="num">{formatARS(f.expectedIncome)}</span></div>
        <div className="row spread muted"><span>en efectivo</span><span className="num">{f.expectedCash === null ? "—" : formatARS(f.expectedCash)}</span></div>
        <div className="row spread muted"><span>por transferencia / MP</span><span className="num">{f.expectedTransfers === null ? "—" : formatARS(f.expectedTransfers)}</span></div>
        <div className="row spread"><span>Mano de obra de los barberos</span><span className="num">{formatARS(f.labor)}</span></div>
        <div className="row spread"><b>Dinero que debe haber (ingresos − mano de obra)</b><span className="num">{formatARS(f.expectedNet)}</span></div>
      </div>

      {closed && close ? (
        <>
          <h2>Cerrada</h2>
          <div className="card">
            <div className="row spread"><span>Efectivo</span><span className="num">{formatARS(close.declaredCash)}</span></div>
            <div className="row spread"><span>Transferencias</span><span className="num">{formatARS(close.declaredTransfers)}</span></div>
            <div className="row spread"><span>Cambio dejado</span><span className="num">{formatARS(close.changeLeft)}</span></div>
            <div className="row spread"><span>Diferencia</span><span className={`diff ${close.difference === 0 ? "ok" : "err"}`}>{formatARS(close.difference)}</span></div>
            {close.note && <p className="muted">Nota: {close.note}</p>}
          </div>
          {admin && (
            <>
              <h2>Reabrir</h2>
              <ReopenForm date={date} />
            </>
          )}
        </>
      ) : (
        <>
          <h2>Declarar</h2>
          <CloseForm
            date={date}
            expectedIncome={f.expectedIncome}
            expectedCash={f.expectedCash}
            expectedTransfers={f.expectedTransfers}
            unpaidSales={f.unpaidSales}
            accounts={accounts.map((a) => ({ key: a.key, name: a.name }))}
            defaultChange={lastClose?.changeLeft ?? 0}
          />
        </>
      )}
    </Shell>
  );
}
