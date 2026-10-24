"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { copyMonthSessions, saveMemberPayment, saveMemberSessions } from "../app/actions";
import type { StatementRow } from "../domain/members";
import { formatARS, formatDate, monthLabel } from "../domain/money";
import type { MemberRow, MembersMonth } from "../services/members";
import { MemberDrawer, MemberPanel, NewMemberForm, PLAN_LABEL, STATUS_CHIP, STATUS_LABEL, TYPE_LABEL, ViewSwitch, type LedgerView, type PriceTable } from "./SociosGrid";
import { useAction } from "./useAction";

const n = (v: number) => (v ? v.toLocaleString("es-AR") : "");
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const num = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
type Filter = "todos" | "cobrar" | "deben";

/** Cobro rápido: solo monto y medio. La fecha es hoy y el mes se imputa solo (el más viejo que debe). Lo demás está en la ficha. */
function QuickPay({ m, today, pay, onClose, onFicha }: { m: MemberRow; today: string; pay: ReturnType<typeof useAction>; onClose: () => void; onFicha: () => void }) {
  const owed = m.balance > 0 ? m.balance : Math.max(m.charged - m.paid, 0);
  const [amount, setAmount] = useState(owed ? String(owed) : "");
  const [method, setMethod] = useState("BANCO");
  const { pending, run } = pay;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="drawer-back sheet" role="dialog" aria-modal="true" aria-label={`Cobrar a ${m.name}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        className="drawer"
        onSubmit={(e) => { e.preventDefault(); run(() => saveMemberPayment({ memberId: m.id, date: today, amount: num(amount), method, note: "" }), onClose); }}
      >
        <div className="row spread"><h2 style={{ margin: 0 }}>{m.name}</h2><button className="btn" type="button" onClick={onClose} aria-label="Cerrar">✕</button></div>
        <p className="muted" style={{ margin: "4px 0 10px" }}>{m.balance > 0 ? `Debe ${formatARS(m.balance)}` : m.balance < 0 ? `Tiene ${formatARS(-m.balance)} a favor` : "Está al día"} · {m.visits} sesiones este mes</p>
        <label className="field"><span>Monto ($)</span><input inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <div className="seg" role="group" aria-label="Medio de pago" style={{ marginBottom: 10 }}>
          <button type="button" aria-pressed={method === "BANCO"} onClick={() => setMethod("BANCO")}>Transferencia</button>
          <button type="button" aria-pressed={method === "EFECTIVO"} onClick={() => setMethod("EFECTIVO")}>Efectivo</button>
        </div>
        <button className="big gold" type="submit" disabled={pending || num(amount) <= 0}>Cobrar {num(amount) > 0 ? formatARS(num(amount)) : ""}</button>
        <p style={{ margin: "10px 0 0" }}><button type="button" className="linklike" onClick={onFicha}>Otra fecha, mes o nota, y ver su cuenta →</button></p>
      </form>
    </div>
  );
}

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
  const debtors = data.members.filter((m) => m.balance > 0).sort((a, b) => b.balance - a.balance);
  const unpaidThisMonth = data.members.filter((m) => m.status === "INPAGO" || m.status === "PARCIAL").length;
  const link = (id: string) => `/socios?mes=${data.month}&socio=${id}`;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [paying, setPaying] = useState<string | null>(null);
  const copy = useAction();
  const pay = useAction(); // el cartel de "Cobro registrado" vive acá para que no se pierda cuando se cierra la hoja de cobro
  const toCollect = data.members.filter((m) => m.status === "PENDIENTE" || m.status === "INPAGO" || m.status === "PARCIAL");
  const noSessions = data.members.filter((m) => m.active && m.visits === 0).length;
  const shown = data.members.filter((m) => (!q.trim() || norm(m.name).includes(norm(q.trim()))) && (filter === "todos" || (filter === "cobrar" && toCollect.includes(m)) || (filter === "deben" && m.balance > 0)));
  const shownGroups = [...new Set(shown.map((m) => m.barberName))];
  const payingMember = data.members.find((m) => m.id === paying) ?? null;

  return (
    <>
      <div className="monthnav">
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

      <div className="toolbar">
        <input type="search" className="search" placeholder="Buscar socio…" aria-label="Buscar socio" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips" role="group" aria-label="Filtrar socios">
          <button type="button" className={`pill ${filter === "todos" ? "on" : ""}`} aria-pressed={filter === "todos"} onClick={() => setFilter("todos")}>Todos {data.members.length}</button>
          <button type="button" className={`pill ${filter === "cobrar" ? "on" : ""}`} aria-pressed={filter === "cobrar"} onClick={() => setFilter("cobrar")}>Falta cobrar {toCollect.length}</button>
          <button type="button" className={`pill ${filter === "deben" ? "on" : ""}`} aria-pressed={filter === "deben"} onClick={() => setFilter("deben")}>Deben {debtors.length}</button>
        </div>
        {noSessions > 0 && (
          <button type="button" className="btn" style={{ minHeight: 42 }} disabled={copy.pending} onClick={() => copy.run(() => copyMonthSessions({ month: data.month }))}>
            Cargar sesiones como el mes anterior ({noSessions})
          </button>
        )}
      </div>
      {copy.toast}
      {pay.toast}

      <div className="gridwrap" role="region" aria-label="Cuenta mensual de socios" tabIndex={0}>
        <table className="grid cuenta">
          <thead>
            <tr>
              <th className="sticky label">Socio</th>
              <th className="hm">Plan</th>
              <th>Ses.</th>
              <th className="hm">Precio</th>
              <th className="hm">Total</th>
              <th>Cobrado</th>
              <th className="hm">Dif.</th>
              <th className="hm-estado">Estado</th>
              <th className="hm">Último pago</th>
              <th>Saldo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shownGroups.map((g) => (
              <GroupRows key={g} title={g}>
                {shown.filter((m) => m.barberName === g).map((m) => (
                  <tr key={m.id} className={m.active ? "" : "inactive"}>
                    <th className="sticky label">
                      <Link href={link(m.id)} scroll={false} style={{ textDecoration: "none" }}><b>{m.name}</b></Link>
                      <span className="sub">{PLAN_LABEL[m.plan] ?? m.plan} · {TYPE_LABEL[m.serviceType]}{m.active ? "" : " · baja"}</span>
                    </th>
                    <td className="hm txt">{PLAN_LABEL[m.plan] ?? m.plan} · {TYPE_LABEL[m.serviceType]}</td>
                    <td style={{ padding: 0 }}><SessionsInput memberId={m.id} month={data.month} value={m.visits} manual={m.manual} name={m.name} /></td>
                    <td className="hm">{n(m.price)}</td>
                    <td className="hm">{n(m.charged)}</td>
                    <td>{n(m.paid)}</td>
                    <td className={`hm ${m.diff < 0 ? "errc" : m.diff > 0 ? "okc" : ""}`}>{n(m.diff)}</td>
                    <td className="hm-estado" style={{ textAlign: "center" }}>{m.status === "SIN_MOVIMIENTO" ? "" : <span className={`chip ${STATUS_CHIP[m.status]}`}>{STATUS_LABEL[m.status]}</span>}</td>
                    <td className="hm">{m.lastPayDate ? formatDate(m.lastPayDate).slice(0, 5) : ""}</td>
                    <td className={m.balance > 0 ? "errc" : m.balance < 0 ? "okc" : ""}>{m.balance ? m.balance.toLocaleString("es-AR") : "✓"}</td>
                    <td style={{ textAlign: "center", padding: "0 6px" }}><button type="button" className="cobrar" aria-label={`Cobrar a ${m.name}`} onClick={() => setPaying(m.id)}>Cobrar</button></td>
                  </tr>
                ))}
              </GroupRows>
            ))}
            {data.members.length === 0 && <tr><td colSpan={11} style={{ textAlign: "left", padding: 12 }} className="muted">Todavía no hay socios cargados.</td></tr>}
            {data.members.length > 0 && shown.length === 0 && <tr><td colSpan={11} style={{ textAlign: "left", padding: 12 }} className="muted">Ningún socio coincide con ese filtro.</td></tr>}
            {data.members.length > 0 && (
              <tr className="tone-strong">
                <th className="sticky label">Totales del mes</th>
                <td className="hm" />
                <td>{t.visits}</td>
                <td className="hm" />
                <td className="hm">{n(t.charged)}</td>
                <td>{n(t.paid)}</td>
                <td className={`hm ${t.paid - t.charged < 0 ? "errc" : ""}`}>{n(t.paid - t.charged)}</td>
                <td className="hm-estado" />
                <td className="hm" />
                <td className={t.debt > 0 ? "errc" : ""}>{n(t.debt)}</td>
                <td />
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

      {payingMember && (
        <QuickPay m={payingMember} today={today} pay={pay} onClose={() => setPaying(null)} onFicha={() => { setPaying(null); router.push(link(payingMember.id), { scroll: false }); }} />
      )}
      {selected && (
        <MemberDrawer closeHref={`/socios?mes=${data.month}`}>
          <MemberPanel key={selected.id} m={selected} ledger={ledger} statement={statement} barbers={barbers} today={today} />
        </MemberDrawer>
      )}
      <NewMemberForm barbers={barbers} prices={prices} />
      <p style={{ marginTop: 12 }}><Link href="/socios/importar">Cargar los socios desde la planilla de Excel →</Link></p>
    </>
  );
}

function GroupRows({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="section"><th className="sticky label">{title}</th><td colSpan={10} /></tr>
      {children}
    </>
  );
}
