"use client";
import Link from "next/link";
import { useState } from "react";
import { saveBarberPayment, voidBarberPaymentAction } from "../app/actions";
import { formatARS, formatDate, monthLabel } from "../domain/money";
import type { BarberPayable, BarberPayables } from "../services/barberpay";
import { useAction } from "./useAction";

const num = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

function PayForm({ b, today }: { b: BarberPayable; today: string }) {
  const [amount, setAmount] = useState(b.toPay > 0 ? String(b.toPay) : "");
  const [method, setMethod] = useState("BANCO");
  const [back, setBack] = useState(false);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const { pending, run, toast } = useAction();
  return (
    <details open={b.toPay > 0 && !b.selfPaid}>
      <summary><b>Registrar un pago o devolución de {b.name}</b></summary>
      <div className="seg" role="group" aria-label="Tipo de movimiento" style={{ margin: "8px 0" }}>
        <button type="button" aria-pressed={!back} onClick={() => setBack(false)}>Le pagué / adelanto</button>
        <button type="button" aria-pressed={back} onClick={() => setBack(true)}>Me devolvió</button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); run(() => saveBarberPayment({ userId: b.userId, date, amount: num(amount), method, note, direction: back ? "DEL_BARBERO" : "A_BARBERO" }), () => { setAmount(""); setNote(""); }); }}>
        <label className="field"><span>Monto ($)</span><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={b.toPay > 0 ? String(b.toPay) : "0"} /></label>
        <div className="seg" role="group" aria-label="Medio de pago" style={{ marginBottom: 8 }}>
          <button type="button" aria-pressed={method === "BANCO"} onClick={() => setMethod("BANCO")}>Transferencia</button>
          <button type="button" aria-pressed={method === "EFECTIVO"} onClick={() => setMethod("EFECTIVO")}>Efectivo</button>
        </div>
        <details>
          <summary className="muted">Otra fecha o nota</summary>
          <label className="field"><span>Fecha</span><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>Nota (opcional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: desde la cuenta de Ale" /></label>
        </details>
        <button className="btn primary" type="submit" disabled={pending || num(amount) <= 0}>{back ? "Registrar devolución" : "Registrar pago"}</button>
      </form>
      {toast}
    </details>
  );
}

const cell = (n: number) => (n === 0 ? <span className="muted">–</span> : formatARS(n));

/** Mayor contable del mes: una fila por día, saldo acumulado a la derecha. `Saldo` > 0 = el barbero le debe al local. */
export function Mayor({ b }: { b: BarberPayable }) {
  const sum = (f: (r: BarberPayable["ledger"][number]) => number) => b.ledger.reduce((a, r) => a + f(r), 0);
  const last = b.ledger.at(-1)?.debt ?? -b.carried;
  return (
    <details open style={{ marginTop: 8 }}>
      <summary><b>Cuenta corriente del mes</b> <span className="muted">(mayor, día por día)</span></summary>
      <div style={{ overflowX: "auto" }}>
        <table className="grid mayor" aria-label={`Mayor de ${b.name}`}>
          <thead>
            <tr>
              <th className="sticky">Fecha</th>
              <th>Cobró en su cuenta</th>
              <th>Debería cobrar</th>
              <th>Debería enviar (40 % + bebida)</th>
              <th>Recibió (retiros, adelantos, pagos)</th>
              <th>Envió al local</th>
              <th>Saldo acumulado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="sticky">Saldo anterior</td>
              <td colSpan={5} />
              <td><b>{formatARS(-b.carried)}</b></td>
            </tr>
            {b.ledger.map((r) => (
              <tr key={r.date}>
                <td className="sticky">{r.members ? "Socios (fin de mes)" : formatDate(r.date)}</td>
                <td>{cell(r.collected)}</td>
                <td>{cell(r.entitled)}</td>
                <td>{cell(r.shouldSend)}</td>
                <td>{cell(r.received)}</td>
                <td>{cell(r.sent)}</td>
                <td><b>{formatARS(r.debt)}</b></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky"><b>Total del mes</b></td>
              <td><b>{formatARS(sum((r) => r.collected))}</b></td>
              <td><b>{formatARS(sum((r) => r.entitled))}</b></td>
              <td><b>{formatARS(sum((r) => r.shouldSend))}</b></td>
              <td><b>{formatARS(sum((r) => r.received))}</b></td>
              <td><b>{formatARS(sum((r) => r.sent))}</b></td>
              <td><b>{formatARS(last)}</b></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted" style={{ margin: "6px 0 0" }}>
        Saldo acumulado = saldo anterior + lo que debería enviar + lo que recibió − lo que envió. Positivo: {b.name} le debe al local; negativo: el local le debe a {b.name}. Pasa solo al mes siguiente.
      </p>
    </details>
  );
}

export default function BarberosPagos({ data, today, prevMonth, nextMonth }: { data: BarberPayables; today: string; prevMonth: string; nextMonth: string }) {
  const { pending, run, toast } = useAction();
  return (
    <>
      <div className="monthnav">
        <Link className="btn" href={`/barberos?mes=${prevMonth}`} aria-label="Mes anterior">←</Link>
        <h1>A pagar · <span style={{ textTransform: "capitalize" }}>{monthLabel(data.month)}</span></h1>
        <Link className="btn" href={`/barberos?mes=${nextMonth}`} aria-label="Mes siguiente">→</Link>
      </div>

      <section className="card" aria-label="Total a pagar a los barberos">
        <div className="muted">Total a pagar a los barberos</div>
        <div className={`diff ${data.totalToPay > 0 ? "errc" : "okc"}`} style={{ fontSize: "2rem" }}>{formatARS(data.totalToPay)}</div>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Lo que les corresponde por los <b>cortes de la planilla</b> y por los <b>socios</b> (de lo que pagaron los socios se saca la bebida × los cortes del mes y a lo que queda, 60 % para el barbero),
          menos lo que ya cobraron. Incluye lo que quedó sin pagar de meses anteriores.
        </p>
      </section>

      <div className="cols" style={{ marginTop: 12 }}>
      {data.barbers.map((b) => (
        <section key={b.userId} className="card" aria-label={`Barbero ${b.name}`}>
          <div className="row spread">
            <h2 style={{ margin: 0 }}>{b.name}</h2>
            {b.selfPaid ? <span className="chip">Retira de su cuenta</span> : <span className={`chip ${b.toPay > 0 ? "err" : b.toPay < 0 ? "warn" : "ok"}`}>{b.toPay > 0 ? "Falta pagarle" : b.toPay < 0 ? "Cobró de más" : "Al día ✓"}</span>}
          </div>
          {!b.selfPaid && <div className={`diff ${b.toPay > 0 ? "errc" : ""}`} style={{ fontSize: "1.8rem" }}>{formatARS(Math.abs(b.toPay))}</div>}
          {!b.selfPaid && b.toPay < 0 && <p className="muted" style={{ margin: 0 }}>Cobró de más: te debe esta plata.</p>}

          <ul className="list">
            <li><span>Cortes de la planilla</span><span className="num">{formatARS(b.laborServices)}</span></li>
            <li><span>Socios <span className="muted">(de lo que pagaron)</span></span><span className="num">{formatARS(b.laborMembership)}</span></li>
            <li><b>Le corresponde</b><b className="num">{formatARS(b.entitled)}</b></li>
            {!b.selfPaid && (
              <>
                <li><span>− Efectivo que retiró</span><span className="num">{formatARS(b.cashTaken)}</span></li>
                <li><span>− Ingresado en su cuenta</span><span className="num">{formatARS(b.ownTransfers)}</span></li>
                <li><span>− Pagos registrados</span><span className="num">{formatARS(b.paid)}</span></li>
                {b.carried !== 0 && <li><span>{b.carried > 0 ? "+ Quedó de meses anteriores" : "− Cobró de más antes"}</span><span className="num">{formatARS(Math.abs(b.carried))}</span></li>}
                <li><b>{b.toPay >= 0 ? "Falta pagarle" : "Te debe"}</b><b className={`num ${b.toPay > 0 ? "errc" : ""}`}>{formatARS(Math.abs(b.toPay))}</b></li>
              </>
            )}
          </ul>
          {!b.selfPaid && (b.ledger.length > 0 || b.carried !== 0) && <Mayor b={b} />}
          {b.selfPaid ? <p className="muted" style={{ margin: 0 }}>{b.name} retira su parte de la cuenta donde entran los cortes, por eso no suma a lo que hay que pagar.</p> : <PayForm key={`${b.userId}-${b.toPay}`} b={b} today={today} />}
        </section>
      ))}
      </div>

      <h2>Pagos y devoluciones de este mes</h2>
      <ul className="list card" style={{ padding: "4px 14px" }}>
        {data.payments.map((p) => (
          <li key={p.id}>
            <span>{p.name} <span className="muted">· {formatDate(p.date)} · {p.method === "EFECTIVO" ? "efectivo" : "transferencia"}{p.note ? ` · ${p.note}` : ""}</span></span>
            <span className="num">
              {p.amount < 0 ? "Devolvió " : ""}{formatARS(Math.abs(p.amount))}{" "}
              <button className="btn danger" style={{ minHeight: 44, minWidth: 44, padding: "0 8px" }} disabled={pending} aria-label="Anular pago" onClick={() => { const reason = prompt("Motivo para anular este pago:"); if (reason) run(() => voidBarberPaymentAction({ id: p.id, reason })); }}>✕</button>
            </span>
          </li>
        ))}
        {data.payments.length === 0 && <li className="muted">Todavía no se registró ningún pago este mes.</li>}
      </ul>
      {toast}
    </>
  );
}
