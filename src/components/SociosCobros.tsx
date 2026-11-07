"use client";
import Link from "next/link";
import { useState } from "react";
import { movePaymentsPeriod } from "../app/actions";
import { formatARS, formatDate, monthLabel, shiftMonth } from "../domain/money";
import type { MonthPayment } from "../services/members";
import { ViewSwitch } from "./SociosGrid";
import { useAction } from "./useAction";

/**
 * Todos los cobros de socios del mes (por fecha de cobro o por mes al que corresponden), para corregir de qué mes es cada uno.
 * Un cobro hecho antes del mes al que corresponde figura marcado: suele ser un mes mal asignado al cargarlo.
 */
export default function SociosCobros({ month, rows, prevMonth, nextMonth }: { month: string; rows: MonthPayment[]; prevMonth: string; nextMonth: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState(shiftMonth(month, -1));
  const { pending, run, toast } = useAction();
  const monthsOptions = [3, 2, 1, 0, -1].map((n) => shiftMonth(month, -n));
  // Cobrado en un mes anterior al mes al que se asignó: puede ser un adelanto o un mes mal cargado.
  const early = rows.filter((r) => r.date.slice(0, 7) < r.period);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <>
      <div className="monthnav">
        <Link className="btn" href={`/socios?mes=${prevMonth}&vista=cobros`} aria-label="Mes anterior">←</Link>
        <h1 style={{ textTransform: "capitalize" }}>Cobros · {monthLabel(month)}</h1>
        <Link className="btn" href={`/socios?mes=${nextMonth}&vista=cobros`} aria-label="Mes siguiente">→</Link>
      </div>
      <ViewSwitch month={month} current="cobros" />
      <p className="muted" style={{ margin: "6px 0" }}>
        Los cobros cargados en {monthLabel(month)} y los que corresponden a ese mes. En cada uno elegís <b>a qué mes de servicio corresponde</b>; la deuda de cada socio se recalcula sola.
      </p>
      <div className="stats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className="card"><div className="muted">Cobros</div><div className="num big2">{rows.length}</div></div>
        <div className="card"><div className="muted">Total</div><div className="num big2">{formatARS(total)}</div></div>
      </div>

      {early.length > 0 && (
        <div className="alert WARN" role="status">
          {early.length} cobro{early.length === 1 ? "" : "s"} se cobr{early.length === 1 ? "ó" : "aron"} <b>antes</b> del mes al que quedaron asignados. Si eran de un mes ya vencido, movelos.{" "}
          <button className="btn" style={{ minHeight: 44 }} onClick={() => setPicked(early.map((r) => r.id))}>Elegirlos</button>
        </div>
      )}

      <div className="card" style={{ padding: "4px 14px" }}>
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id}>
              <span>
                <input type="checkbox" aria-label={`Elegir el cobro de ${r.memberName} del ${formatDate(r.date)}`} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} style={{ marginRight: 8, width: 20, height: 20, verticalAlign: "middle" }} />
                <Link href={`/socios?mes=${month}&socio=${r.memberId}`}><b>{r.memberName}</b></Link>{" "}
                <span className="muted">· {formatDate(r.date)} · {r.method === "EFECTIVO" ? "efectivo" : "banco/MP"} · corresponde a <b>{monthLabel(r.period)}</b>{r.date.slice(0, 7) < r.period ? " ⚠" : ""}</span>
              </span>
              <span className="num">{formatARS(r.amount)}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="muted">No hay cobros de socios en este mes.</li>}
        </ul>
      </div>

      {picked.length > 0 && (
        <div className="selbar" role="region" aria-label="Cobros elegidos">
          <b>{picked.length} cobro{picked.length === 1 ? "" : "s"} elegido{picked.length === 1 ? "" : "s"}</b>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Mes al que corresponden" style={{ flex: 1, minWidth: 0 }}>
              {monthsOptions.map((mo) => <option key={mo} value={mo}>{monthLabel(mo)}</option>)}
            </select>
            <button type="button" className="btn primary" disabled={pending} onClick={() => run(() => movePaymentsPeriod({ ids: picked, period: target }), () => setPicked([]))}>Mover a ese mes</button>
          </div>
          <button type="button" className="btn" onClick={() => setPicked([])}>Cancelar</button>
        </div>
      )}
      {toast}
    </>
  );
}
