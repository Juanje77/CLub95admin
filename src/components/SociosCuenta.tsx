"use client";
import Link from "next/link";
import { useState } from "react";
import { saveMemberSessions } from "../app/actions";
import type { StatementRow } from "../domain/members";
import { formatARS, formatDate, monthLabel } from "../domain/money";
import type { MembersMonth } from "../services/members";
import { MemberPanel, NewMemberForm, PLAN_LABEL, STATUS_CHIP, STATUS_LABEL, TYPE_LABEL, ViewSwitch, type LedgerView, type PriceTable } from "./SociosGrid";
import { useAction } from "./useAction";

const n = (v: number) => (v ? v.toLocaleString("es-AR") : "");

interface Props {
  data: MembersMonth;
  today: string;
  prevMonth: string;
  nextMonth: string;
  barbers: { id: string; name: string }[];
  selectedId: string | null;
  ledger: LedgerView[];
  statement: StatementRow[];
  prices: PriceTable;
}

/** Celda de sesiones: se escribe el número y se guarda al salir del campo. Vacío = volver a contar las asistencias tildadas. */
function SessionsInput({ memberId, month, value, manual, name }: { memberId: string; month: string; value: number; manual: boolean; name: string }) {
  const [text, setText] = useState(value ? String(value) : "");
  const [shown, setShown] = useState(value);
  const { run, toast } = useAction();
  if (shown !== value) {
    setShown(value);
    setText(value ? String(value) : "");
  }
  const commit = () => {
    const t = text.trim();
    const sessions = t === "" ? null : Number(t);
    if (sessions !== null && !Number.isInteger(sessions)) return setText(value ? String(value) : "");
    if ((sessions ?? 0) === value && (sessions !== null) === manual) return;
    if (sessions === null && !manual) return;
    run(() => saveMemberSessions({ memberId, month, sessions }));
  };
  return (
    <>
      <input
        className="cell"
        inputMode="numeric"
        size={1}
        value={text}
        aria-label={`Sesiones de ${name}`}
        title={manual ? "Cargadas a mano. Borrá el número para volver a contar las asistencias." : "Se cuentan de la asistencia tildada. Escribí un número para fijarlas."}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      {toast}
    </>
  );
}

export default function SociosCuenta({ data, today, prevMonth, nextMonth, barbers, selectedId, ledger, statement, prices }: Props) {
  const t = data.totals;
  const selected = data.members.find((m) => m.id === selectedId) ?? null;
  const groups = [...new Set(data.members.map((m) => m.barberName))];
  const debtors = data.members.filter((m) => m.balance > 0).sort((a, b) => b.balance - a.balance);
  const unpaidThisMonth = data.members.filter((m) => m.status === "INPAGO" || m.status === "PARCIAL").length;
  const link = (id: string) => `/socios?mes=${data.month}&socio=${id}`;

  return (
    <>
      <div className="row spread" style={{ margin: "4px 0 8px" }}>
        <Link className="btn" href={`/socios?mes=${prevMonth}`} aria-label="Mes anterior">←</Link>
        <h1 style={{ textTransform: "capitalize" }}>Socios · {monthLabel(data.month)}</h1>
        <Link className="btn" href={`/socios?mes=${nextMonth}`} aria-label="Mes siguiente">→</Link>
      </div>
      <ViewSwitch month={data.month} current="cuenta" />

      <div className="stats">
        <div className="card"><div className="muted">A cobrar del mes</div><div className="num big2">{formatARS(t.charged)}</div></div>
        <div className="card"><div className="muted">Cobrado del mes</div><div className="num big2">{formatARS(t.paid)}</div></div>
        <div className="card"><div className="muted">Deuda total</div><div className={`num big2 ${t.debt > 0 ? "errc" : "okc"}`}>{formatARS(t.debt)}</div></div>
      </div>

      <div className="gridwrap" role="region" aria-label="Cuenta mensual de socios" tabIndex={0}>
        <table className="grid cuenta">
          <thead>
            <tr>
              <th className="sticky label">Socio</th>
              <th>Plan</th>
              <th>Ses.</th>
              <th>Precio</th>
              <th>Total</th>
              <th>Cobrado</th>
              <th>Dif.</th>
              <th>Estado</th>
              <th>Último pago</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g} title={g}>
                {data.members.filter((m) => m.barberName === g).map((m) => (
                  <tr key={m.id} className={m.active ? "" : "inactive"}>
                    <th className="sticky label">
                      <Link href={link(m.id)} scroll={false} style={{ textDecoration: "none" }}><b>{m.name}</b></Link>
                      {!m.active && <div className="muted" style={{ fontSize: ".66rem" }}>baja</div>}
                    </th>
                    <td style={{ textAlign: "left" }}>{PLAN_LABEL[m.plan] ?? m.plan} · {TYPE_LABEL[m.serviceType]}</td>
                    <td style={{ padding: 0 }}><SessionsInput memberId={m.id} month={data.month} value={m.visits} manual={m.manual} name={m.name} /></td>
                    <td>{n(m.price)}</td>
                    <td>{n(m.charged)}</td>
                    <td>{n(m.paid)}</td>
                    <td className={m.diff < 0 ? "errc" : m.diff > 0 ? "okc" : ""}>{n(m.diff)}</td>
                    <td style={{ textAlign: "center" }}>{m.status === "SIN_MOVIMIENTO" ? "" : <span className={`chip ${STATUS_CHIP[m.status]}`}>{STATUS_LABEL[m.status]}</span>}</td>
                    <td>{m.lastPayDate ? formatDate(m.lastPayDate).slice(0, 5) : ""}</td>
                    <td className={m.balance > 0 ? "errc" : m.balance < 0 ? "okc" : ""}>{m.balance ? m.balance.toLocaleString("es-AR") : "✓"}</td>
                  </tr>
                ))}
              </GroupRows>
            ))}
            {data.members.length === 0 && <tr><td colSpan={10} style={{ textAlign: "left", padding: 12 }} className="muted">Todavía no hay socios cargados.</td></tr>}
            {data.members.length > 0 && (
              <tr className="tone-strong">
                <th className="sticky label">Totales del mes</th>
                <td />
                <td>{t.visits}</td>
                <td />
                <td>{n(t.charged)}</td>
                <td>{n(t.paid)}</td>
                <td className={t.paid - t.charged < 0 ? "errc" : ""}>{n(t.paid - t.charged)}</td>
                <td />
                <td />
                <td className={t.debt > 0 ? "errc" : ""}>{n(t.debt)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: "6px 0" }}>
        Escribí las <b>sesiones</b> del mes (o dejá que se cuenten de la asistencia). Tocá el nombre para <b>cobrar</b>, ver su cuenta corriente o ajustar.
        {unpaidThisMonth > 0 && ` Este mes quedan ${unpaidThisMonth} socio${unpaidThisMonth === 1 ? "" : "s"} sin pagar o con pago parcial.`}
      </p>

      <h2>Cuenta corriente: quién debe</h2>
      <div className="card" style={{ padding: "4px 14px" }}>
        <ul className="list">
          {debtors.map((m) => (
            <li key={m.id}>
              <span>
                <Link href={link(m.id)} scroll={false}><b>{m.name}</b></Link>{" "}
                <span className="muted">· {m.barberName}{m.oldestUnpaid ? ` · debe desde ${monthLabel(m.oldestUnpaid)}` : ""}</span>
              </span>
              <span className="num errc">{formatARS(m.balance)}</span>
            </li>
          ))}
          {debtors.length === 0 && <li className="muted">Nadie debe nada. ✓</li>}
        </ul>
      </div>

      {selected && <MemberPanel key={selected.id} m={selected} ledger={ledger} statement={statement} barbers={barbers} today={today} />}
      <NewMemberForm barbers={barbers} prices={prices} />
    </>
  );
}

function GroupRows({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="section"><th className="sticky label">{title}</th><td colSpan={9} /></tr>
      {children}
    </>
  );
}
