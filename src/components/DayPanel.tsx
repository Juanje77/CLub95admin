"use client";
import { useState } from "react";
import { closeDayAction, markDayAsClosed } from "../app/actions";
import { formatARS, formatDate } from "../domain/money";
import type { GridDayCol, MonthGrid } from "../services/grid";
import ReopenForm from "./ReopenForm";
import { useAction } from "./useAction";

const WEEKDAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export default function DayPanel({ day, grid, viewer, barberName }: { day: GridDayCol; grid: MonthGrid; viewer: { id: string; isAdmin: boolean }; barberName: (id: string) => string }) {
  const [note, setNote] = useState("");
  const { pending, run, toast } = useAction();
  const r = day.result;
  const wdName = WEEKDAY[new Date(`${day.date}T12:00:00Z`).getUTCDay()];
  const isFuture = day.date > grid.today;
  const canClose = !day.closed && !isFuture && (viewer.isAdmin || day.date === grid.today);
  const hasActivity = r.income > 0 || Object.keys(day.memberships).length > 0;
  const needsNote = day.difference !== null && day.difference !== 0;
  const noMoney = day.difference === null;

  return (
    <section className="card" style={{ marginTop: 14 }} aria-label="Día seleccionado">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{wdName} {formatDate(day.date)}</h2>
        <span className={`chip ${day.closed ? "ok" : "warn"}`}>{day.closed ? "Cerrado ✓" : isFuture ? "Futuro" : "Abierto"}</span>
      </div>

      {day.error && <div className="alert ERROR">{day.error}</div>}

      <div className="kv">
        <span>Total ingresos</span><b className="num">{formatARS(r.income)}</b>
        <span>Mano de obra</span><b className="num">{formatARS(r.labor)}</b>
        <span>Dinero que debe haber</span><b className="num">{formatARS(r.expectedNet)}</b>
        <span>Ganancia del día</span><b className="num okc">{formatARS(r.profit.total)}</b>
        <span>Ingresado</span><b className="num">{formatARS(day.totalDeclared)}</b>
        <span>Diferencia de caja</span>
        <b className={`num ${day.difference === null ? "" : day.difference === 0 ? "okc" : "errc"}`}>{day.difference === null ? "sin cargar" : formatARS(day.difference)}</b>
      </div>

      {r.barbers.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="muted">Detalle por barbero y ganancia</summary>
          <ul className="list">
            {r.barbers.map((b) => (
              <li key={b.userId}>
                <span>{barberName(b.userId)}: {b.services} servicio{b.services === 1 ? "" : "s"}{b.memberships ? ` + ${b.memberships} socio${b.memberships === 1 ? "" : "s"}` : ""}</span>
                <span className="num">cobra {formatARS(b.labor)}</span>
              </li>
            ))}
            <li><span>Parte del local en servicios</span><span className="num">{formatARS(r.profit.servicesCut)}</span></li>
            <li><span>Margen de bebidas (incluidas y sueltas)</span><span className="num">{formatARS(r.profit.drinksIncludedMargin + r.profit.drinksLooseMargin)}</span></li>
            <li><span>Margen de ceras, polvo y aceite</span><span className="num">{formatARS(r.profit.productsMargin)}</span></li>
          </ul>
        </details>
      )}

      {day.closed && day.note && <p className="muted">Nota: {day.note}</p>}

      {canClose && (
        <div style={{ marginTop: 12 }}>
          {noMoney && hasActivity && <div className="alert WARN">Cargá el dinero ingresado (efectivo, Brubank, MP…) en la grilla antes de cerrar.</div>}
          {needsNote && (
            <label className="field">
              <span>Nota obligatoria: ¿por qué {day.difference! < 0 ? "faltan" : "sobran"} {formatARS(Math.abs(day.difference!))}?</span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: un cliente transfiere mañana" />
            </label>
          )}
          <button className="big gold" disabled={pending || (needsNote && !note.trim())} onClick={() => run(() => closeDayAction({ date: day.date, note }), () => setNote(""))}>
            Cerrar el día
            <small>Después de cerrar no se puede editar</small>
          </button>
        </div>
      )}

      {day.closed && viewer.isAdmin && (
        <div style={{ marginTop: 12 }}>
          <ReopenForm date={day.date} />
        </div>
      )}

      {viewer.isAdmin && !day.closed && !isFuture && !hasActivity && day.difference === null && (
        <div style={{ marginTop: 12 }}>
          <button className="btn" disabled={pending} onClick={() => run(() => markDayAsClosed({ date: day.date, reason: "No abrió" }))}>
            No abrimos este día
          </button>
        </div>
      )}
      {toast}
    </section>
  );
}
