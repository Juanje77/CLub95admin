"use client";
import Link from "next/link";
import { useState } from "react";
import { saveFundEntry, voidFundEntryAction } from "../app/actions";
import { KIND_LABEL, type Fund } from "../domain/memberfunds";
import { formatARS, formatDate, monthLabel } from "../domain/money";
import type { MemberFunds } from "../services/memberfunds";
import { ViewSwitch } from "./SociosGrid";
import { useAction } from "./useAction";

const num = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
const signed = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""} ${formatARS(Math.abs(n))}`;
const FUND_NAME: Record<string, string> = { EFECTIVO: "Efectivo a rendir", BEBIDA: "Cuenta de bebida", GANANCIA: "Ganancia" };

interface Props {
  data: MemberFunds;
  today: string;
  prevMonth: string;
  nextMonth: string;
}

function EntryForm({ fund, kind, label, today, hint }: { fund: Fund; kind: string; label: string; today: string; hint: string }) {
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { pending, run, toast } = useAction();
  return (
    <details>
      <summary><b>{label}</b></summary>
      <form onSubmit={(e) => { e.preventDefault(); run(() => saveFundEntry({ fund, kind, amount: num(amount), date, note }), () => { setAmount(""); setNote(""); }); }}>
        <label className="field"><span>Fecha</span><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>Monto ($)</span><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="field"><span>{hint}</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn primary" type="submit" disabled={pending || num(amount) <= 0}>{label}</button>
      </form>
      {toast}
    </details>
  );
}

function AdjustForm({ fund, today }: { fund: Fund; today: string }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { pending, run, toast } = useAction();
  return (
    <details>
      <summary className="muted">Ajuste manual (saldo inicial o corrección)</summary>
      <form onSubmit={(e) => { e.preventDefault(); run(() => saveFundEntry({ fund, kind: "AJUSTE", amount: Number(amount.replace(/[^\d-]/g, "")), date: today, note }), () => { setAmount(""); setNote(""); }); }}>
        <label className="field"><span>Monto ($; con − para restar)</span><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="field"><span>Motivo (obligatorio)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn" type="submit" disabled={pending || !amount || !note.trim()}>Guardar ajuste</button>
      </form>
      {toast}
    </details>
  );
}

export default function SociosCajas({ data, today, prevMonth, nextMonth }: Props) {
  const { balances: b, parts: p, current: c } = data;
  const { pending, run, toast } = useAction();
  const lucio = data.profitBarbers.join(", ");
  return (
    <>
      <div className="monthnav">
        <Link className="btn" href={`/socios?mes=${prevMonth}&vista=cajas`} aria-label="Mes anterior">←</Link>
        <h1 style={{ textTransform: "capitalize" }}>Socios · {monthLabel(data.month)}</h1>
        <Link className="btn" href={`/socios?mes=${nextMonth}&vista=cajas`} aria-label="Mes siguiente">→</Link>
      </div>
      <ViewSwitch month={data.month} current="cajas" />
      <p className="muted" style={{ margin: "4px 0 8px" }}>Los socios se llevan aparte del día a día: acá se junta lo que se cobra, la bebida y la ganancia. Los saldos se acumulan desde el primer dato.</p>

      <section className="card" aria-label="Efectivo a rendir">
        <div className="muted">Efectivo a rendir</div>
        <div className={`diff ${b.efectivo < 0 ? "errc" : ""}`} style={{ fontSize: "1.8rem" }}>{formatARS(b.efectivo)}</div>
        <ul className="list">
          <li><span>Efectivo cobrado a socios</span><span className="num">{formatARS(p.cashCollected)}</span></li>
          <li><span>− Cortes de Ale (lo que se queda)</span><span className="num">{formatARS(p.aleCuts)}</span></li>
          <li><span>± Rendiciones y ajustes</span><span className="num">{signed(p.efectivoEntries)}</span></li>
        </ul>
        {b.efectivo < 0 && <p className="muted">Negativo: Ale se quedó con más de lo que cobró en efectivo (el resto lo cobró por transferencia).</p>}
        <p className="muted" style={{ margin: "4px 0" }}>Este mes: cobrado en efectivo {formatARS(c.cash)} · cortes de Ale {formatARS(c.aleCuts)}.</p>
        <EntryForm fund="EFECTIVO" kind="RENDICION" label="Registrar una rendición" today={today} hint="A quién se le rindió (opcional)" />
        <AdjustForm fund="EFECTIVO" today={today} />
      </section>

      <section className="card" aria-label="Cuenta de bebida" style={{ marginTop: 12 }}>
        <div className="muted">Cuenta de bebida</div>
        <div className="diff" style={{ fontSize: "1.8rem" }}>{formatARS(b.bebida)}</div>
        <ul className="list">
          <li><span>Bebida de todas las sesiones</span><span className="num">{formatARS(p.drink)}</span></li>
          <li><span>± Compras y ajustes</span><span className="num">{signed(p.bebidaEntries)}</span></li>
        </ul>
        {data.drinkByBarber.length > 0 && (
          <>
            <p className="muted" style={{ margin: "6px 0 2px" }}>Este mes ({formatARS(c.drink)}):</p>
            <ul className="list">
              {data.drinkByBarber.map((d) => <li key={d.barberId || "x"}><span>{d.name} · {d.sessions === 1 ? "1 sesión" : `${d.sessions} sesiones`}</span><span className="num">{formatARS(d.amount)}</span></li>)}
            </ul>
          </>
        )}
        <EntryForm fund="BEBIDA" kind="GASTO" label="Registrar una compra de bebida" today={today} hint="Detalle (opcional)" />
        <AdjustForm fund="BEBIDA" today={today} />
      </section>

      <section className="card" aria-label="Ganancia de Lucio" style={{ marginTop: 12 }}>
        <div className="muted">Ganancia de {lucio}</div>
        <div className="diff" style={{ fontSize: "1.8rem" }}>{formatARS(b.ganancia)}</div>
        <ul className="list">
          <li><span>Ganancia de sus sesiones (sin bebida)</span><span className="num">{formatARS(p.profit)}</span></li>
          <li><span>± Retiros y ajustes</span><span className="num">{signed(p.gananciaEntries)}</span></li>
        </ul>
        <p className="muted" style={{ margin: "4px 0" }}>Este mes: {formatARS(c.profit)}.</p>
        <EntryForm fund="GANANCIA" kind="RETIRO" label="Registrar un retiro de ganancia" today={today} hint="Detalle (opcional)" />
        <AdjustForm fund="GANANCIA" today={today} />
      </section>

      <h2>Mes a mes</h2>
      <div className="gridwrap" style={{ maxHeight: "none" }}>
        <table className="grid cc">
          <thead><tr><th className="sticky label">Mes</th><th>Ses.</th><th>Efectivo</th><th>Cortes de Ale</th><th>Bebida</th><th>Ganancia</th></tr></thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month}>
                <th className="sticky label" style={{ textTransform: "capitalize" }}>{monthLabel(m.month)}</th>
                <td>{m.sessions || ""}</td>
                <td>{m.cash ? m.cash.toLocaleString("es-AR") : ""}</td>
                <td>{m.aleCuts ? m.aleCuts.toLocaleString("es-AR") : ""}</td>
                <td>{m.drink ? m.drink.toLocaleString("es-AR") : ""}</td>
                <td>{m.profit ? m.profit.toLocaleString("es-AR") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Movimientos registrados</h2>
      <ul className="list card" style={{ padding: "4px 14px" }}>
        {data.entries.map((e) => (
          <li key={e.id}>
            <span>{FUND_NAME[e.fund] ?? e.fund} · {KIND_LABEL[e.kind] ?? e.kind} <span className="muted">· {formatDate(e.date)}{e.note ? ` · ${e.note}` : ""}</span></span>
            <span className="num">
              {signed(e.amount)}{" "}
              <button className="btn danger" style={{ minHeight: 30, padding: "0 8px" }} disabled={pending} aria-label="Anular movimiento" onClick={() => { const reason = prompt("Motivo para anular este movimiento:"); if (reason) run(() => voidFundEntryAction({ id: e.id, reason })); }}>✕</button>
            </span>
          </li>
        ))}
        {data.entries.length === 0 && <li className="muted">Todavía no hay rendiciones, compras ni retiros.</li>}
      </ul>
      {toast}
    </>
  );
}
