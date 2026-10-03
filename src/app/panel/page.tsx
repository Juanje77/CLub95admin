import Link from "next/link";
import { DivergingBars, HBars } from "../../components/Charts";
import PrintButton from "../../components/PrintButton";
import Shell from "../../components/Shell";
import { formatARS, formatDate, monthLabel, shiftMonth, todayBA } from "../../domain/money";
import { requireAdmin } from "../../lib/auth";
import { db } from "../../lib/db";
import { getPanel } from "../../services/report";

export const dynamic = "force-dynamic";

const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const short = (m: string) => `${MONTH_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + formatARS(Math.abs(n));

function Row({ label, value, kind, sub }: { label: string; value: number | string; kind?: "sec" | "tot" | "fin"; sub?: boolean }) {
  if (kind === "sec") return <tr className="sec"><td colSpan={2}>{label}</td></tr>;
  return (
    <tr className={kind ?? ""}>
      <td className={sub ? "sub" : ""}>{label}</td>
      <td>{typeof value === "number" ? formatARS(value) : value}</td>
    </tr>
  );
}

export default async function PanelPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const today = todayBA();
  const month = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : today.slice(0, 7);
  const { report: r, series, weekdays } = await getPanel(db, month);
  const prev = series[series.length - 2];
  const cur = series[series.length - 1]!;
  const pct = (a: number, b: number) => (b > 0 ? `${a >= b ? "↑" : "↓"} ${Math.abs(Math.round(((a - b) / b) * 100))}% vs ${monthLabel(prev!.month).split(" ")[0]}` : "sin mes anterior para comparar");
  const maxDow = Math.max(...weekdays.map((w) => w.avgIncome));

  return (
    <Shell user={user} wide>
      <div className="row spread" style={{ margin: "4px 0 8px" }}>
        <Link className="btn noprint" href={`/panel?mes=${shiftMonth(month, -1)}`} aria-label="Mes anterior">←</Link>
        <h1 style={{ textTransform: "capitalize" }}>Panel · {monthLabel(month)}</h1>
        <Link className="btn noprint" href={`/panel?mes=${shiftMonth(month, 1)}`} aria-label="Mes siguiente">→</Link>
      </div>
      <div className="row noprint" style={{ marginBottom: 10 }}>
        <a className="btn" href={`/api/export?tipo=panel&mes=${month}`} download>Excel del panel</a>
        <a className="btn" href={`/api/export?tipo=planilla&mes=${month}`} download>Planilla en Excel</a>
        <PrintButton />
      </div>

      <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card"><div className="muted">Ingresos</div><div className="num big2">{formatARS(r.income.total)}</div><div className="delta">{pct(cur.income, prev?.income ?? 0)}</div></div>
        <div className="card"><div className="muted">Mano de obra</div><div className="num big2">{formatARS(r.labor.total)}</div><div className="delta">{r.income.total > 0 ? `${Math.round((r.labor.total / r.income.total) * 100)}% de los ingresos` : "—"}</div></div>
        <div className="card"><div className="muted">Margen bruto</div><div className="num big2">{formatARS(r.grossMargin)}</div><div className="delta">{r.income.total > 0 ? `${Math.round((r.grossMargin / r.income.total) * 100)}% de los ingresos` : "—"}</div></div>
        <div className="card"><div className="muted">Resultado final</div><div className={`num big2 ${r.result >= 0 ? "okc" : "errc"}`}>{r.result >= 0 ? "▲ " : "▼ "}{signed(r.result)}</div><div className="delta">{r.result >= 0 ? "ganancia del mes" : "pérdida del mes"}</div></div>
      </div>

      <h2>Resumen del mes</h2>
      <div className="card">
        <table className="stmt">
          <tbody>
            <Row kind="sec" label="Cantidades" value="" />
            <Row sub label="Cortes" value={String(r.quantities.CORTE)} />
            <Row sub label="Corte y barba" value={String(r.quantities.CORTE_BARBA)} />
            <Row sub label="Barba y cejas" value={String(r.quantities.BARBA_CEJAS)} />
            <Row sub label="Visitas de socios" value={String(r.quantities.MEMBERSHIP)} />
            <Row kind="sec" label="Ingresos" value="" />
            <Row sub label="Cortes" value={r.income.byType.CORTE} />
            <Row sub label="Corte y barba" value={r.income.byType.CORTE_BARBA} />
            <Row sub label="Barba y cejas" value={r.income.byType.BARBA_CEJAS} />
            <Row sub label="Membresías (visitas × precio)" value={r.income.memberships} />
            <Row sub label="Bebidas" value={r.income.drinks} />
            <Row sub label="Ceras, polvo y aceite" value={r.income.products} />
            {r.income.extra.map((e) => <Row key={e.concept} sub label={e.concept} value={e.amount} />)}
            <Row kind="tot" label="Total ingresos" value={r.income.total} />
            <Row kind="sec" label="Mano de obra" value="" />
            {r.labor.byBarber.map((b) => <Row key={b.id} sub label={b.name} value={b.labor} />)}
            <Row kind="tot" label="Total mano de obra" value={r.labor.total} />
            <Row kind="tot" label="Libre (ingresos − mano de obra)" value={r.free} />
            <Row kind="sec" label="Costos" value="" />
            <Row sub label="Bebidas" value={r.costs.drinks + r.costs.memberDrinks} />
            <Row sub label="Ceras, polvo y aceite" value={r.costs.products} />
            <Row kind="tot" label="Margen bruto" value={r.grossMargin} />
            <Row kind="sec" label="Gastos" value="" />
            <Row sub label="Gastos variables" value={r.expenses.variable} />
            <Row sub label="Gastos de estructura" value={r.expenses.structure} />
            <Row sub label="Inversiones" value={r.expenses.investment} />
            <Row kind="tot" label="Total gastos" value={r.expenses.total} />
            <Row kind="fin" label="Resultado final" value={signed(r.result)} />
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>
          Las compras de mercadería ({formatARS(r.expenses.replenishment)}) no restan acá: su costo ya está en "Costos" por lo consumido. Las membresías se cuentan por visita (devengado).
        </p>
      </div>

      <h2>Comparativo de los últimos 6 meses</h2>
      <div className="card">
        <h3 style={{ margin: "0 0 8px", fontSize: ".95rem" }}>Ingresos por mes</h3>
        <HBars ariaLabel="Ingresos por mes, últimos 6 meses" items={series.map((s) => ({ label: short(s.month), value: s.income }))} />
        <h3 style={{ margin: "16px 0 8px", fontSize: ".95rem" }}>Resultado por mes</h3>
        <DivergingBars ariaLabel="Resultado por mes, últimos 6 meses" items={series.map((s) => ({ label: short(s.month), value: s.result }))} />
        <details style={{ marginTop: 10 }}>
          <summary className="muted">Ver como tabla</summary>
          <table className="mini">
            <thead><tr><th>Mes</th><th>Ingresos</th><th>Mano de obra</th><th>Resultado</th></tr></thead>
            <tbody>{series.map((s) => <tr key={s.month}><td>{short(s.month)}</td><td>{formatARS(s.income)}</td><td>{formatARS(s.labor)}</td><td>{signed(s.result)}</td></tr>)}</tbody>
          </table>
        </details>
      </div>

      <h2>Ranking de barberos</h2>
      <div className="card">
        <HBars ariaLabel="Generado por barbero en el mes" items={r.labor.byBarber.map((b) => ({ label: b.name, value: b.gross, hint: `${b.services} servicios` }))} />
        <details open style={{ marginTop: 10 }}>
          <summary className="muted">Detalle</summary>
          <table className="mini">
            <thead><tr><th>Barbero</th><th>Servicios</th><th>Socios</th><th>Cobra</th><th>Al local</th></tr></thead>
            <tbody>{r.labor.byBarber.map((b) => <tr key={b.id}><td>{b.name}</td><td>{b.services}</td><td>{b.memberships}</td><td>{formatARS(b.labor)}</td><td>{formatARS(b.forLocal)}</td></tr>)}</tbody>
          </table>
        </details>
      </div>

      <h2>Días fuertes y flojos</h2>
      <div className="card">
        <h3 style={{ margin: "0 0 8px", fontSize: ".95rem" }}>Ingreso promedio por día de la semana (últimos 3 meses)</h3>
        <HBars ariaLabel="Ingreso promedio por día de la semana" items={weekdays.map((w) => ({ label: w.label.slice(0, 3), value: w.avgIncome, hint: `${w.days} días con ventas · ${w.avgServices} servicios` }))} />
        {maxDow === 0 && <p className="muted">Todavía no hay días con ventas para comparar.</p>}
        <div className="grid two" style={{ marginTop: 12 }}>
          <div>
            <div className="muted">Mejores días del mes</div>
            <ul className="list">{r.bestDays.map((d) => <li key={d.date}><span>{formatDate(d.date)}</span><span className="num">{formatARS(d.income)}</span></li>)}{r.bestDays.length === 0 && <li className="muted">Sin ventas.</li>}</ul>
          </div>
          <div>
            <div className="muted">Días más flojos</div>
            <ul className="list">{r.worstDays.map((d) => <li key={d.date}><span>{formatDate(d.date)}</span><span className="num">{formatARS(d.income)}</span></li>)}{r.worstDays.length === 0 && <li className="muted">—</li>}</ul>
          </div>
        </div>
      </div>

      <h2>Descuadres de caja</h2>
      <div className="card">
        {r.gaps.length === 0 ? (
          <span className="chip ok">Sin descuadres este mes ✓</span>
        ) : (
          <>
            <div className="row spread"><span>{r.gaps.length} día{r.gaps.length === 1 ? "" : "s"} con diferencia</span><span className={`num ${r.gapsTotal < 0 ? "errc" : ""}`}>{signed(r.gapsTotal)}</span></div>
            <ul className="list">{r.gaps.map((g) => <li key={g.date}><span>{formatDate(g.date)}{g.note ? <span className="muted"> · {g.note}</span> : null}</span><span className={`num ${g.difference < 0 ? "errc" : ""}`}>{g.difference < 0 ? "▼ " : "▲ "}{signed(g.difference)}</span></li>)}</ul>
          </>
        )}
        <p className="muted" style={{ marginBottom: 0 }}>La caja se cierra una vez por día para todo el local; el historial es por día.</p>
      </div>
    </Shell>
  );
}
