import Link from "next/link";
import CajaPanel from "../components/CajaPanel";
import Shell, { loadAlerts } from "../components/Shell";
import { dayLabel } from "../domain/alerts";
import { formatARS, formatDate, todayBA } from "../domain/money";
import { requireUser } from "../lib/auth";
import { getDayView } from "../lib/day-view";
import { isAdmin } from "../services/common";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<string, string> = { TRANSFERENCIA: "Transf.", EFECTIVO: "Efectivo", MP: "MP", MEMBRESIA: "Socio" };

export default async function Home({ searchParams }: { searchParams: Promise<{ fecha?: string; b?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayBA();
  const admin = isAdmin(user);
  // Solo el admin/dueño puede mirar o cargar otro día.
  const date = admin && sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) && sp.fecha <= today ? sp.fecha : today;
  const view = await getDayView(date, user, sp.b);
  const alerts = await loadAlerts(user);
  const f = view.figures;

  return (
    <Shell user={user} alertCount={alerts.length}>
      <div className="row spread">
        <div>
          <h1>{date === today ? "Hoy" : "Caja del"} · {dayLabel(date)}</h1>
          <div className="muted">{formatDate(date)}</div>
        </div>
        <span className={`chip ${view.closed ? "ok" : "warn"}`}>{view.closed ? "Caja cerrada ✓" : "Caja abierta"}</span>
      </div>

      {admin && (
        <form className="row" style={{ marginTop: 10 }} method="get">
          <input type="date" name="fecha" defaultValue={date} max={today} aria-label="Día" style={{ flex: 1 }} />
          <input type="hidden" name="b" value={view.barberId} />
          <button className="btn" type="submit">Ver día</button>
        </form>
      )}

      {alerts.slice(0, 3).map((a) => (
        <div key={a.key} className={`alert ${a.severity}`}>{a.message}</div>
      ))}
      {alerts.length > 3 && <Link href="/alertas" className="muted">Ver las {alerts.length} alertas →</Link>}

      {admin && (
        <>
          <h2>Cargando para</h2>
          <div className="row">
            {view.barbers.map((b) => (
              <Link key={b.id} href={`/?fecha=${date}&b=${b.id}`} className="chip" style={b.id === view.barberId ? { background: "var(--brand)", color: "var(--bg)" } : undefined}>
                {b.name}
              </Link>
            ))}
          </div>
        </>
      )}

      <CajaPanel date={date} barberId={view.barberId} closed={view.closed} tariffs={view.tariffs} products={view.products} isAdmin={admin} />

      <h2>Resumen del día</h2>
      <div className="card">
        <div className="row spread"><span>Cobrado hasta ahora</span><span className="num">{formatARS(f.expectedIncome)}</span></div>
        <div className="row spread muted"><span>en efectivo</span><span className="num">{f.expectedCash === null ? "—" : formatARS(f.expectedCash)}</span></div>
        <div className="row spread muted"><span>por transferencia / MP</span><span className="num">{f.expectedTransfers === null ? "—" : formatARS(f.expectedTransfers)}</span></div>
        <hr style={{ border: 0, borderTop: "1px solid var(--line)" }} />
        {view.perBarber.filter((b) => b.services + b.memberships > 0).map((b) => (
          <div key={b.id} className="row spread">
            <span>{b.name}: {b.services} servicio{b.services === 1 ? "" : "s"}{b.memberships ? ` + ${b.memberships} socio${b.memberships === 1 ? "" : "s"}` : ""}</span>
            <span className="num">{formatARS(b.gross)}</span>
          </div>
        ))}
        {view.perBarber.every((b) => b.services + b.memberships === 0) && <span className="muted">Todavía no hay ventas cargadas.</span>}
      </div>

      {view.sales.length > 0 && (
        <>
          <h2>Ventas cargadas</h2>
          <ul className="list card" style={{ padding: "4px 14px" }}>
            {[...view.sales].reverse().map((s) => (
              <li key={s.id}>
                <span>
                  {s.label}
                  <span className="muted"> · {s.barber} · {s.time} · {METHOD_LABEL[s.method ?? ""] ?? "sin medio"}</span>
                </span>
                <span className="num">{s.kind === "MEMBERSHIP" ? "—" : formatARS(s.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {!view.closed && (
        <p style={{ marginTop: 20 }}>
          <Link className="btn primary" href={`/cierre?fecha=${date}`} style={{ display: "block", textAlign: "center", textDecoration: "none", lineHeight: "24px" }}>
            Ir a cerrar la caja
          </Link>
        </p>
      )}
    </Shell>
  );
}
