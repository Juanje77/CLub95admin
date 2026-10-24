import Link from "next/link";
import { Mayor } from "../../components/BarberosPagos";
import { DivergingBars, HBars } from "../../components/Charts";
import PanelTabs from "../../components/PanelTabs";
import PrintButton from "../../components/PrintButton";
import Shell from "../../components/Shell";
import { formatARS, formatDate, monthLabel, shiftMonth, todayBA } from "../../domain/money";
import { requireAdmin } from "../../lib/auth";
import { db } from "../../lib/db";
import { getBankAccounts } from "../../services/bankaccounts";
import { getBarberPayables } from "../../services/barberpay";
import { getBoxBalance } from "../../services/closing";
import { CATEGORY_LABEL, listExpenses, recurringStatus } from "../../services/expenses";
import { getMemberFunds } from "../../services/memberfunds";
import { getMembersMonth } from "../../services/members";
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
  const [{ report: r, series, weekdays }, funds, banks, socios, exp, fixed, box, payables] = await Promise.all([
    getPanel(db, month),
    getMemberFunds(db, month),
    getBankAccounts(db, month),
    getMembersMonth(db, month),
    listExpenses(db, { month }),
    recurringStatus(db, month),
    getBoxBalance(db),
    getBarberPayables(db, month),
  ]);
  const prev = series[series.length - 2];
  const cur = series[series.length - 1]!;
  const pct = (a: number, b: number) => (b > 0 ? `${a >= b ? "↑" : "↓"} ${Math.abs(Math.round(((a - b) / b) * 100))}% vs ${monthLabel(prev!.month).split(" ")[0]}` : "sin mes anterior para comparar");
  const maxDow = Math.max(...weekdays.map((w) => w.avgIncome));

  const debtors = socios.members.filter((m) => m.balance > 0).sort((a, b) => b.balance - a.balance);
  const dueFixed = fixed.filter((f) => f.due);
  const pendingMembers = socios.members.filter((m) => m.status === "INPAGO" || m.status === "PARCIAL").length;

  // Lo que hay que mirar primero, con enlace directo a donde se ve el detalle.
  const attention: { tone: "err" | "warn" | "ok"; text: string; value?: string; href: string }[] = [];
  if (r.gaps.length > 0) attention.push({ tone: "err", text: `${r.gaps.length} día${r.gaps.length === 1 ? "" : "s"} con descuadre de caja`, value: signed(r.gapsTotal), href: "#caja" });
  if (dueFixed.length > 0) attention.push({ tone: "warn", text: `Gastos fijos sin cargar: ${dueFixed.map((f) => f.concept).join(", ")}`, href: `/gastos?mes=${month}` });
  if (debtors.length > 0) attention.push({ tone: "warn", text: `${debtors.length} socio${debtors.length === 1 ? "" : "s"} con deuda`, value: formatARS(socios.totals.debt), href: "#socios" });
  if (payables.totalToPay > 0) attention.push({ tone: "warn", text: "A pagar a los barberos", value: formatARS(payables.totalToPay), href: `/barberos?mes=${month}` });
  if (funds.balances.efectivo > 0) attention.push({ tone: "warn", text: "Efectivo de socios a rendir", value: formatARS(funds.balances.efectivo), href: "#caja" });
  if (r.result < 0) attention.push({ tone: "err", text: "El mes viene en pérdida", value: signed(r.result), href: "#resumen" });
  if (attention.length === 0) attention.push({ tone: "ok", text: "Todo en orden: sin descuadres, gastos fijos al día y sin deudas de socios", href: "#resumen" });

  const resumen = (
    <>
      <div className="kpis">
        <div className="card"><div className="muted">Ingresos</div><div className="num big2">{formatARS(r.income.total)}</div><div className="delta">{pct(cur.income, prev?.income ?? 0)}</div></div>
        <div className="card"><div className="muted">Mano de obra</div><div className="num big2">{formatARS(r.labor.total)}</div><div className="delta">{r.income.total > 0 ? `${Math.round((r.labor.total / r.income.total) * 100)}% de los ingresos` : "—"}</div></div>
        <div className="card"><div className="muted">Margen bruto</div><div className="num big2">{formatARS(r.grossMargin)}</div><div className="delta">{r.income.total > 0 ? `${Math.round((r.grossMargin / r.income.total) * 100)}% de los ingresos` : "—"}</div></div>
        <div className="card"><div className="muted">Resultado final</div><div className={`num big2 ${r.result >= 0 ? "okc" : "errc"}`}>{r.result >= 0 ? "▲ " : "▼ "}{signed(r.result)}</div><div className="delta">{r.result >= 0 ? "ganancia del mes" : "pérdida del mes"}</div></div>
      </div>

      <h2>A mirar</h2>
      <div className="attn" role="list">
        {attention.map((a) => (
          <a key={a.text} role="listitem" className={a.tone} href={a.href}>
            <span>{a.text}</span>
            {a.value && <b className="num">{a.value}</b>}
          </a>
        ))}
      </div>

      <h2>Resultado del mes</h2>
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
    </>
  );

  const caja = (
    <>
      <h2>Cuentas bancarias <Link className="sec-link noprint" href={`/cuentas?mes=${month}`}>ver detalle →</Link></h2>
      <div className="card" style={{ padding: "4px 14px" }}>
        <table className="mini">
          <thead><tr><th>Cuenta</th><th>Debería entrar</th><th>Ingresó</th><th>Sale</th><th>Queda</th></tr></thead>
          <tbody>
            {banks.accounts.map((a) => (
              <tr key={a.key}>
                <td><b>{a.who}</b><div className="muted" style={{ fontSize: ".7rem" }}>{a.name}</div></td>
                <td>{formatARS(a.expectedTotal)}</td>
                <td>{formatARS(a.declared)}</td>
                <td>{a.payoutsTotal ? formatARS(a.payoutsTotal) : "—"}</td>
                <td className={a.remaining < 0 ? "errc" : ""}>{formatARS(a.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ margin: "6px 0" }}>“Ingresó” es el dinero ingresado de cada día en esa cuenta; la diferencia con lo que debería entrar es lo que se pagó en efectivo o falta cargar.</p>
      </div>

      <h2>A pagar a los barberos <Link className="sec-link noprint" href={`/barberos?mes=${month}`}>ver detalle y registrar pagos →</Link></h2>
      <div className="card" style={{ padding: "4px 14px" }}>
        <ul className="list">
          {payables.barbers.map((b) => (
            <li key={b.userId}>
              <span>{b.name} <span className="muted">· le corresponde {formatARS(b.entitled)}{b.selfPaid ? " · retira de su cuenta" : ""}</span></span>
              {b.selfPaid ? <span className="muted">—</span> : <b className={`num ${b.toPay > 0 ? "errc" : ""}`}>{b.toPay < 0 ? `−${formatARS(-b.toPay)}` : formatARS(b.toPay)}</b>}
            </li>
          ))}
          <li><b>Total a pagar</b><b className="num">{formatARS(payables.totalToPay)}</b></li>
        </ul>
      </div>

      <h2>Efectivo <Link className="sec-link noprint" href="/efectivo">ver detalle →</Link></h2>
      <div className="kpis">
        <div className="card"><div className="muted">Efectivo acumulado en la caja</div><div className="num big2">{formatARS(box)}</div><div className="delta">fila de efectivo del local</div></div>
        <div className="card"><div className="muted">Efectivo ingresado en el mes</div><div className="num big2">{formatARS(banks.cashDeclared)}</div><div className="delta">cierres de caja</div></div>
      </div>

      <h2>Cuentas de socios <Link className="sec-link noprint" href={`/socios?mes=${month}&vista=cajas`}>ver detalle →</Link></h2>
      <div className="kpis">
        <div className="card"><div className="muted">Efectivo a rendir</div><div className={`num big2 ${funds.balances.efectivo < 0 ? "errc" : ""}`}>{formatARS(funds.balances.efectivo)}</div><div className="delta">cobrado − cortes de Ale</div></div>
        <div className="card"><div className="muted">Cuenta de bebida</div><div className="num big2">{formatARS(funds.balances.bebida)}</div><div className="delta">+ {formatARS(funds.current.drink)} este mes</div></div>
        <div className="card"><div className="muted">Ganancia de {funds.profitBarbers.join(", ")}</div><div className="num big2">{formatARS(funds.balances.ganancia)}</div><div className="delta">+ {formatARS(funds.current.profit)} este mes</div></div>
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
    </>
  );

  const sociosTab = (
    <>
      <h2>Socios <Link className="sec-link noprint" href={`/socios?mes=${month}`}>ver la planilla →</Link></h2>
      <div className="kpis">
        <div className="card"><div className="muted">Socios activos</div><div className="num big2">{socios.totals.active}</div><div className="delta">{socios.totals.visits} sesiones este mes</div></div>
        <div className="card"><div className="muted">A cobrar del mes</div><div className="num big2">{formatARS(socios.totals.charged)}</div></div>
        <div className="card"><div className="muted">Cobrado del mes</div><div className="num big2">{formatARS(socios.totals.paid)}</div><div className="delta">{socios.totals.charged > 0 ? `${Math.round((socios.totals.paid / socios.totals.charged) * 100)}% de lo a cobrar` : "—"}</div></div>
        <div className="card"><div className="muted">Deuda total</div><div className={`num big2 ${socios.totals.debt > 0 ? "errc" : "okc"}`}>{formatARS(socios.totals.debt)}</div><div className="delta">{pendingMembers} sin pagar o parcial este mes</div></div>
      </div>
      <h2>Quién debe</h2>
      <div className="card" style={{ padding: "4px 14px" }}>
        <ul className="list">
          {debtors.slice(0, 10).map((m) => (
            <li key={m.id}>
              <span><Link href={`/socios?mes=${month}&socio=${m.id}`}><b>{m.name}</b></Link> <span className="muted">· {m.barberName}{m.oldestUnpaid ? ` · desde ${monthLabel(m.oldestUnpaid)}` : ""}</span></span>
              <span className="num errc">{formatARS(m.balance)}</span>
            </li>
          ))}
          {debtors.length === 0 && <li className="muted">Nadie debe nada ✓</li>}
          {debtors.length > 10 && <li className="muted">y {debtors.length - 10} más…</li>}
        </ul>
      </div>
      <h2>Sesiones por barbero</h2>
      <div className="card">
        <HBars ariaLabel="Sesiones de socios por barbero este mes" format={(n) => `${n}`} items={Object.entries(socios.members.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.barberName]: (acc[m.barberName] ?? 0) + m.visits }), {})).map(([label, value]) => ({ label, value }))} />
      </div>
    </>
  );

  const gastosTab = (
    <>
      <h2>Gastos del mes <Link className="sec-link noprint" href={`/gastos?mes=${month}`}>cargar o ver →</Link></h2>
      <div className="kpis">
        <div className="card"><div className="muted">Total de gastos</div><div className="num big2">{formatARS(exp.summary.total)}</div><div className="delta">incluye reposición de mercadería</div></div>
        <div className="card"><div className="muted">Resta del resultado</div><div className="num big2">{formatARS(r.expenses.total)}</div><div className="delta">sin la reposición</div></div>
      </div>
      <h2>Por categoría</h2>
      <div className="card">
        <HBars ariaLabel="Gastos del mes por categoría" items={(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((c) => ({ label: CATEGORY_LABEL[c], value: exp.summary.byCategory[c] }))} />
      </div>
      <h2>Con qué se pagó</h2>
      <div className="card">
        {exp.summary.byAccount.length === 0 ? <p className="muted" style={{ margin: 0 }}>Todavía no hay gastos cargados este mes.</p> : <HBars ariaLabel="Gastos del mes según con qué se pagaron" items={exp.summary.byAccount.map((a) => ({ label: a.label, value: a.total }))} />}
      </div>
      <h2>Por concepto</h2>
      <div className="card">
        {exp.summary.byConcept.length === 0 ? <p className="muted" style={{ margin: 0 }}>Todavía no hay gastos cargados este mes.</p> : <HBars ariaLabel="Gastos del mes por concepto" items={exp.summary.byConcept.slice(0, 10).map((c) => ({ label: c.concept, value: c.total, hint: `${c.count} carga${c.count === 1 ? "" : "s"}` }))} />}
      </div>
      <h2>Gastos fijos</h2>
      <div className="card" style={{ padding: "4px 14px" }}>
        <ul className="list">
          {fixed.map((f) => (
            <li key={f.id}>
              <span>{f.concept} <span className="muted">· vence el {f.dayOfMonth}{f.amount ? ` · ${formatARS(f.amount)}` : ""}</span></span>
              <span className={`chip ${f.done ? "ok" : f.due ? "err" : ""}`}>{f.done ? "Cargado ✓" : f.due ? "Pendiente ⚠" : "Por vencer"}</span>
            </li>
          ))}
          {fixed.length === 0 && <li className="muted">No hay gastos fijos configurados.</li>}
        </ul>
      </div>
    </>
  );

  const barberos = (
    <>
      {payables.barbers.filter((b) => !b.selfPaid && (b.ledger.length > 0 || b.carried !== 0)).map((b) => (
        <section key={b.userId} className="card" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0 }}>Cuenta corriente de {b.name} <Link className="sec-link noprint" href={`/barberos?mes=${month}`}>registrar pagos →</Link></h2>
          <Mayor b={b} />
        </section>
      ))}
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
    </>
  );

  const tendencia = (
    <>
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
    </>
  );

  return (
    <Shell user={user} wide>
      <div className="monthnav">
        <Link className="btn noprint" href={`/panel?mes=${shiftMonth(month, -1)}`} aria-label="Mes anterior">←</Link>
        <h1 style={{ textTransform: "capitalize" }}>Panel · {monthLabel(month)}</h1>
        <Link className="btn noprint" href={`/panel?mes=${shiftMonth(month, 1)}`} aria-label="Mes siguiente">→</Link>
      </div>
      <div className="row noprint" style={{ marginBottom: 6 }}>
        <a className="btn" href={`/api/export?tipo=panel&mes=${month}`} download>Excel del panel</a>
        <a className="btn" href={`/api/export?tipo=planilla&mes=${month}`} download>Planilla en Excel</a>
        <PrintButton />
      </div>
      <PanelTabs
        tabs={[
          { id: "resumen", label: "Resumen", badge: attention[0]?.tone === "ok" ? undefined : String(attention.length), content: resumen },
          { id: "caja", label: "Caja y cuentas", badge: r.gaps.length ? String(r.gaps.length) : undefined, content: caja },
          { id: "socios", label: "Socios", badge: debtors.length ? String(debtors.length) : undefined, content: sociosTab },
          { id: "gastos", label: "Gastos", badge: dueFixed.length ? String(dueFixed.length) : undefined, content: gastosTab },
          { id: "barberos", label: "Barberos", content: barberos },
          { id: "tendencia", label: "Tendencia", content: tendencia },
        ]}
      />
    </Shell>
  );
}
