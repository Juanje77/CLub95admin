import Link from "next/link";
import Shell from "../../components/Shell";
import { formatARS, monthLabel, shiftMonth, todayBA } from "../../domain/money";
import { requireAdmin } from "../../lib/auth";
import { db } from "../../lib/db";
import { getBankAccounts } from "../../services/bankaccounts";

export const dynamic = "force-dynamic";

const signed = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""} ${formatARS(Math.abs(n))}`;

export default async function CuentasPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const today = todayBA();
  const month = sp.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : today.slice(0, 7);
  const data = await getBankAccounts(db, month);
  return (
    <Shell user={user}>
      <div className="monthnav">
        <Link className="btn" href={`/cuentas?mes=${shiftMonth(month, -1)}`} aria-label="Mes anterior">←</Link>
        <h1 style={{ textTransform: "capitalize" }}>Cuentas · {monthLabel(month)}</h1>
        <Link className="btn" href={`/cuentas?mes=${shiftMonth(month, 1)}`} aria-label="Mes siguiente">→</Link>
      </div>
      <p className="muted" style={{ margin: "4px 0 8px" }}>
        Por dónde entra la plata. “Debería entrar” es lo que entraría si nada se hubiera pagado en efectivo; “Ingresó” es lo que se cargó como dinero ingresado en esa cuenta
        en la planilla. La diferencia es lo que se pagó en efectivo o todavía no se cargó.
      </p>

      {data.accounts.map((a) => (
        <section key={a.key} className="card" aria-label={`Cuenta de ${a.who}`} style={{ marginTop: 12 }}>
          <div className="muted">Cuenta de {a.who} · {a.name}</div>
          <div className="diff" style={{ fontSize: "1.8rem" }}>{formatARS(a.declared)}</div>
          <div className="muted">ingresó este mes</div>

          <h3 style={{ margin: "12px 0 4px" }}>Debería entrar</h3>
          <ul className="list">
            {a.expected.map((l) => <li key={l.label}><span>{l.label}</span><span className="num">{formatARS(l.amount)}</span></li>)}
            <li><b>Total</b><b className="num">{formatARS(a.expectedTotal)}</b></li>
            <li>
              <span>Diferencia con lo ingresado <span className="muted">(efectivo o sin cargar)</span></span>
              <span className={`num ${a.gap < 0 ? "errc" : "okc"}`}>{a.gap === 0 ? "✓" : signed(a.gap)}</span>
            </li>
          </ul>

          {a.payouts.length > 0 && (
            <>
              <h3 style={{ margin: "12px 0 4px" }}>Sale de esta cuenta</h3>
              <ul className="list">
                {a.payouts.map((l) => <li key={l.label}><span>{l.label}</span><span className="num">− {formatARS(l.amount)}</span></li>)}
                <li><b>Queda en la cuenta</b><b className={`num ${a.remaining < 0 ? "errc" : ""}`}>{formatARS(a.remaining)}</b></li>
              </ul>
              {a.remaining < 0 && <p className="muted">Negativo: lo ingresado en esta cuenta no alcanza para pagar esa parte; el resto se paga en efectivo.</p>}
            </>
          )}
        </section>
      ))}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row spread"><span>Efectivo ingresado en el mes</span><b className="num">{formatARS(data.cashDeclared)}</b></div>
        <div className="row spread" style={{ marginTop: 6 }}><span>Gastos pagados en efectivo</span><b className="num">− {formatARS(data.cashExpenses)}</b></div>
        <p className="muted" style={{ margin: "6px 0 0" }}>Los cobros de socios en efectivo y las cuentas de bebida, ganancia y efectivo a rendir están en <Link href="/socios?vista=cajas">Socios → Efectivo y cuentas</Link>.</p>
      </div>
    </Shell>
  );
}
