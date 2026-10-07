"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { editMember, saveMember, saveMemberAdjustment, saveMemberPayment, saveMemberPrice, voidMemberEntry } from "../app/actions";
import { formatARS, formatDate, monthLabel, shiftMonth } from "../domain/money";
import type { StatementRow } from "../domain/members";
import type { MemberRow, MembersMonth } from "../services/members";
import { useAction } from "./useAction";
import { useOfflineSave } from "./useOfflineSave";

const WD = ["D", "L", "M", "M", "J", "V", "S"];
const wd = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const num = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
export const TYPE_LABEL: Record<string, string> = { CORTE: "Corte", CORTE_BARBA: "Corte y barba" };
export const PLAN_LABEL: Record<string, string> = { BLACK: "Black", GOLD: "Gold" };
export type PriceTable = Record<string, Record<string, number>>;
export const STATUS_LABEL: Record<string, string> = { PAGO: "Pagó", PARCIAL: "Parcial", INPAGO: "Impago", SIN_MOVIMIENTO: "—" };
export const STATUS_CHIP: Record<string, string> = { PAGO: "ok", PARCIAL: "warn", INPAGO: "err", SIN_MOVIMIENTO: "" };

export interface LedgerView { id: string; date: string; kind: string; debit: number; credit: number; method: string | null; note: string | null }
export interface PlanillaDiff { text: string }

interface Props {
  data: MembersMonth;
  days: string[];
  today: string;
  prevMonth: string;
  nextMonth: string;
  isAdmin: boolean;
  barbers: { id: string; name: string }[];
  selectedId: string | null;
  ledger: LedgerView[];
  diffs: PlanillaDiff[];
  statement: StatementRow[];
  prices: PriceTable;
}

function AttendanceCell({ m, date, editable, on, pending, onToggle }: { m: MemberRow; date: string; editable: boolean; on: boolean; pending: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`att ${on ? "on" : ""} ${pending ? "pending" : ""}`}
      data-att={`${m.name}|${date}`}
      disabled={!editable}
      aria-pressed={on}
      aria-label={`Asistencia de ${m.name} el ${Number(date.slice(8))}`}
      onClick={onToggle}
    >
      {on ? "✓" : ""}
    </button>
  );
}

export function MemberPanel({ m, ledger, statement, barbers, today }: { m: MemberRow; ledger: LedgerView[]; statement: StatementRow[]; barbers: { id: string; name: string }[]; today: string }) {
  const { pending, run, toast } = useAction();
  const [payDate, setPayDate] = useState(today);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("BANCO");
  const [payNote, setPayNote] = useState("");
  const [payPeriod, setPayPeriod] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [priceFrom, setPriceFrom] = useState(today);
  const [price, setPrice] = useState(String(m.price));
  const [name, setName] = useState(m.name);
  const [userId, setUserId] = useState(m.userId ?? "");
  const [type, setType] = useState(m.serviceType);
  const [plan, setPlan] = useState(m.plan);
  const [phone, setPhone] = useState(m.phone ?? "");
  const payMonth = payDate.slice(0, 7);
  return (
    <section className="card" aria-label={`Cuenta de ${m.name}`}>
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{m.name}</h2>
        <span className={`chip ${m.balance > 0 ? "err" : "ok"}`}>{m.balance > 0 ? `Debe ${formatARS(m.balance)}` : m.balance < 0 ? `A favor ${formatARS(-m.balance)}` : "Al día"}</span>
      </div>
      <div className="muted">{PLAN_LABEL[m.plan] ?? m.plan} · {TYPE_LABEL[m.serviceType]} · {formatARS(m.price)} por sesión · atiende {m.barberName}{m.phone ? ` · ${m.phone}` : ""}</div>
      <div className="kv">
        <span>Sesiones del mes</span><b className="num">{m.visits}</b>
        <span>A cobrar del mes</span><b className="num">{formatARS(m.charged)}</b>
        <span>Cobrado para este mes</span><b className="num">{formatARS(m.paid)}</b>
        <span>Debía de meses anteriores</span><b className="num">{formatARS(m.carried)}</b>
        <span>Le corresponde al barbero</span><b className="num">{formatARS(m.barberShare)}</b>
        <span>Queda para el local</span><b className="num">{formatARS(m.localShare)}</b>
      </div>

      <h2>Cuenta corriente mes a mes</h2>
      <div className="gridwrap" style={{ maxHeight: "none" }}>
        <table className="grid cc">
          <thead><tr><th className="sticky label">Mes</th><th>Ses.</th><th>Total</th><th>Cobrado</th><th>Dif.</th><th>Saldo</th><th>Estado</th></tr></thead>
          <tbody>
            {[...statement].reverse().map((r) => (
              <tr key={r.month}>
                <th className="sticky label" style={{ textTransform: "capitalize" }}>{monthLabel(r.month)}</th>
                <td>{r.sessions || ""}</td>
                <td>{r.due ? r.due.toLocaleString("es-AR") : ""}</td>
                <td>{r.paid ? r.paid.toLocaleString("es-AR") : ""}</td>
                <td className={r.diff < 0 ? "errc" : r.diff > 0 ? "okc" : ""}>{r.diff ? r.diff.toLocaleString("es-AR") : ""}</td>
                <td className={r.balance > 0 ? "errc" : r.balance < 0 ? "okc" : ""}>{r.balance.toLocaleString("es-AR")}</td>
                <td style={{ textAlign: "center" }}><span className={`chip ${STATUS_CHIP[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
              </tr>
            ))}
            {statement.length === 0 && <tr><td colSpan={7} style={{ textAlign: "left", padding: 10 }} className="muted">Todavía no tiene sesiones ni cobros.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: "6px 0" }}>El saldo arrastra lo que no pagó de un mes al siguiente. Si no indicás a qué mes corresponde, un cobro cubre el mes más viejo que debe.</p>

      <h2>Movimientos</h2>
      <ul className="list">
        {ledger.map((l) => (
          <li key={l.id}>
            <span>
              {l.kind === "PAGO" ? "Cobro" : "Ajuste"} <span className="muted">· {formatDate(l.date)}{l.method ? ` · ${l.method === "EFECTIVO" ? "efectivo" : "banco/MP"}` : ""}{l.note ? ` · ${l.note}` : ""}</span>
            </span>
            <span className="num">
              {l.credit > 0 ? `− ${formatARS(l.credit)}` : `+ ${formatARS(l.debit)}`}{" "}
              <button className="btn danger" style={{ minHeight: 30, padding: "0 8px" }} aria-label="Anular movimiento" onClick={() => { const reason = prompt("Motivo para anular este movimiento:"); if (reason) run(() => voidMemberEntry({ id: l.id, reason })); }}>✕</button>
            </span>
          </li>
        ))}
        {ledger.length === 0 && <li className="muted">Sin cobros ni ajustes.</li>}
      </ul>

      <details open>
        <summary><b>Registrar un cobro</b></summary>
        <form onSubmit={(e) => { e.preventDefault(); run(() => saveMemberPayment({ memberId: m.id, date: payDate, amount: num(payAmount), method: payMethod, period: payPeriod || undefined, note: payNote }), () => { setPayAmount(""); setPayNote(""); setPayPeriod(""); }); }}>
          <label className="field"><span>Fecha</span><input type="date" value={payDate} max={today} onChange={(e) => setPayDate(e.target.value)} /></label>
          <label className="field"><span>Monto ($)</span><input inputMode="numeric" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></label>
          <label className="field"><span>Medio</span><select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}><option value="BANCO">Transferencia / Mercado Pago</option><option value="EFECTIVO">Efectivo</option></select></label>
          <label className="field">
            <span>Corresponde a</span>
            <select value={payPeriod} onChange={(e) => setPayPeriod(e.target.value)}>
              <option value="">Automático (el mes más viejo que debe)</option>
              <option value={shiftMonth(payMonth, -1)}>Mes anterior · {monthLabel(shiftMonth(payMonth, -1))}</option>
              <option value={payMonth}>Mes actual · {monthLabel(payMonth)}</option>
              <option value={shiftMonth(payMonth, 1)}>Mes siguiente · {monthLabel(shiftMonth(payMonth, 1))}</option>
            </select>
          </label>
          <label className="field"><span>Nota (opcional)</span><input value={payNote} onChange={(e) => setPayNote(e.target.value)} /></label>
          <button className="btn primary" type="submit" disabled={pending || num(payAmount) <= 0}>Registrar cobro</button>
        </form>
      </details>
      <details>
        <summary><b>Ajuste manual</b> <span className="muted">(+ suma deuda, − la baja)</span></summary>
        <form onSubmit={(e) => { e.preventDefault(); run(() => saveMemberAdjustment({ memberId: m.id, date: today, amount: Number(adjAmount.replace(/[^\d-]/g, "")), reason: adjReason }), () => { setAdjAmount(""); setAdjReason(""); }); }}>
          <label className="field"><span>Monto ($; con − para descontar)</span><input inputMode="numeric" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} /></label>
          <label className="field"><span>Motivo (obligatorio)</span><input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} /></label>
          <button className="btn primary" type="submit" disabled={pending || !adjAmount || !adjReason.trim()}>Guardar ajuste</button>
        </form>
      </details>
      <details>
        <summary><b>Precio y datos del socio</b></summary>
        <form onSubmit={(e) => { e.preventDefault(); run(() => saveMemberPrice({ memberId: m.id, validFrom: priceFrom, price: num(price) })); }}>
          <div className="row"><label className="field" style={{ flex: 1 }}><span>Precio por sesión ($)</span><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></label><label className="field" style={{ flex: 1 }}><span>Rige desde</span><input type="date" value={priceFrom} onChange={(e) => setPriceFrom(e.target.value)} /></label></div>
          <button className="btn" type="submit" disabled={pending || num(price) <= 0}>Guardar precio</button>
        </form>
        <form style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); run(() => editMember({ id: m.id, name, plan, userId: userId || null, serviceType: type, phone, active: m.active })); }}>
          <label className="field"><span>Nombre</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Barbero asignado</span><select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Sin asignar</option>{barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="field"><span>Plan</span><select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="BLACK">Black</option><option value="GOLD">Gold</option></select></label>
          <label className="field"><span>Tipo</span><select value={type} onChange={(e) => setType(e.target.value)}><option value="CORTE">Corte</option><option value="CORTE_BARBA">Corte y barba</option></select></label>
          <label className="field"><span>Teléfono</span><input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <div className="row">
            <button className="btn" type="submit" disabled={pending || !name.trim()}>Guardar datos</button>
            <button className="btn danger" type="button" disabled={pending} onClick={() => run(() => editMember({ id: m.id, name: m.name, plan: m.plan, userId: m.userId, serviceType: m.serviceType, phone: m.phone ?? "", active: !m.active }))}>{m.active ? "Dar de baja" : "Reactivar"}</button>
          </div>
        </form>
      </details>
      {toast}
    </section>
  );
}

export function NewMemberForm({ barbers, prices }: { barbers: { id: string; name: string }[]; prices: PriceTable }) {
  const [name, setName] = useState("");
  const [plan, setPlan] = useState("BLACK");
  const [type, setType] = useState("CORTE");
  const [userId, setUserId] = useState("");
  const [price, setPrice] = useState("");
  const [phone, setPhone] = useState("");
  const { pending, run, toast } = useAction();
  return (
    <details className="card" style={{ marginTop: 14 }}>
      <summary><b>+ Agregar un socio</b></summary>
      <form onSubmit={(e) => { e.preventDefault(); run(() => saveMember({ name, plan, serviceType: type, userId: userId || null, price: price ? num(price) : null, phone, note: "" }), () => { setName(""); setPrice(""); setPhone(""); }); }}>
        <label className="field"><span>Nombre</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Plan</span><select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="BLACK">Black</option><option value="GOLD">Gold</option></select></label>
        <label className="field"><span>Tipo</span><select value={type} onChange={(e) => setType(e.target.value)}><option value="CORTE">Corte ({formatARS(prices[plan]?.CORTE ?? 0)} por sesión)</option><option value="CORTE_BARBA">Corte y barba ({formatARS(prices[plan]?.CORTE_BARBA ?? 0)} por sesión)</option></select></label>
        <label className="field"><span>Barbero asignado</span><select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Sin asignar</option>{barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="field"><span>Precio por sesión (vacío = el del plan)</span><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label className="field"><span>Teléfono (opcional)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <button className="btn primary" type="submit" disabled={pending || !name.trim()}>Agregar socio</button>
      </form>
      {toast}
    </details>
  );
}

export default function SociosGrid({ data, days, today, prevMonth, nextMonth, isAdmin, barbers, selectedId, ledger, diffs, statement, prices }: Props) {
  const offline = useOfflineSave();
  const todayRef = useRef<HTMLTableCellElement | null>(null);
  useEffect(() => { todayRef.current?.scrollIntoView({ inline: "center", block: "nearest" }); }, [data.month]);
  const groups = [...new Set(data.members.map((m) => m.barberName))];
  const selected = data.members.find((m) => m.id === selectedId) ?? null;
  const t = data.totals;
  const colSpan = days.length + (isAdmin ? 5 : 2);

  return (
    <>
      <div className="monthnav">
        <Link className="btn" href={`/socios?mes=${prevMonth}&vista=asistencia`} aria-label="Mes anterior">←</Link>
        <h1 style={{ textTransform: "capitalize" }}>Socios · {monthLabel(data.month)}</h1>
        <Link className="btn" href={`/socios?mes=${nextMonth}&vista=asistencia`} aria-label="Mes siguiente">→</Link>
      </div>

      {isAdmin && <ViewSwitch month={data.month} current="asistencia" />}
      {isAdmin && (
        <div className="stats">
          <div className="card"><div className="muted">Socios activos</div><div className="num big2">{t.active}</div></div>
          <div className="card"><div className="muted">A cobrar del mes</div><div className="num big2">{formatARS(t.charged)}</div></div>
          <div className="card"><div className="muted">Deuda total</div><div className={`num big2 ${t.debt > 0 ? "errc" : "okc"}`}>{formatARS(t.debt)}</div></div>
        </div>
      )}
      <p className="muted" style={{ margin: "6px 0" }}>
        Tocá el día para marcar que el socio vino{isAdmin ? "; tocá el nombre para ver su cuenta, cobrar o ajustar" : " (solo hoy)"}.
      </p>

      <div className="gridwrap" role="region" aria-label="Asistencia de socios" tabIndex={0}>
        <table className="grid">
          <thead>
            <tr>
              <th className="sticky label">Socio</th>
              {days.map((d) => (
                <th key={d} ref={d === today ? todayRef : undefined} className={`day ${d === today ? "today" : ""} ${d > today ? "future" : ""}`}>
                  <span className="dn">{Number(d.slice(8))}</span>
                  <span className="wd" style={{ display: "block" }}>{WD[wd(d)]}</span>
                </th>
              ))}
              <th className="total">Visitas</th>
              {isAdmin && <><th className="total">A cobrar</th><th className="total">Cobrado</th><th className="total">Saldo</th></>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FragmentGroup key={g} title={g} colSpan={colSpan}>
                {data.members.filter((m) => m.barberName === g).map((m) => (
                  <tr key={m.id} className={m.active ? "" : "inactive"}>
                    <th className="sticky label">
                      {isAdmin ? <Link href={`/socios?mes=${data.month}&vista=asistencia&socio=${m.id}`} scroll={false} style={{ textDecoration: "none" }}><b>{m.name}</b></Link> : <b>{m.name}</b>}
                      <div className="muted" style={{ fontSize: ".66rem" }}>{TYPE_LABEL[m.serviceType]}{m.active ? "" : " · baja"}</div>
                    </th>
                    {days.map((d) => (
                      <td key={d} className={d === today ? "today" : ""} style={{ padding: 0, textAlign: "center" }}>
                        {(() => {
                          const key = `att:${m.id}:${d}`;
                          const queued = offline.pendingValue(key);
                          const on = queued !== undefined ? queued === 1 : m.attended.includes(d);
                          return (
                            <AttendanceCell
                              m={m}
                              date={d}
                              on={on}
                              pending={queued !== undefined}
                              editable={m.active && d <= today && (isAdmin || d === today)}
                              onToggle={() => void offline.save({ key, action: "toggleAttendance", payload: { memberId: m.id, date: d, present: !on }, value: on ? 0 : 1 })}
                            />
                          );
                        })()}
                      </td>
                    ))}
                    <td className="total">{m.visits || ""}</td>
                    {isAdmin && (
                      <>
                        <td className="total">{m.charged ? m.charged.toLocaleString("es-AR") : ""}</td>
                        <td className="total">{m.paid ? m.paid.toLocaleString("es-AR") : ""}</td>
                        <td className={`total ${m.balance > 0 ? "errc" : m.balance < 0 ? "okc" : ""}`}>{m.balance ? m.balance.toLocaleString("es-AR") : "✓"}</td>
                      </>
                    )}
                  </tr>
                ))}
              </FragmentGroup>
            ))}
            {data.members.length === 0 && (
              <tr><td colSpan={colSpan} style={{ textAlign: "left", padding: 12 }} className="muted">Todavía no hay socios cargados.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {diffs.length > 0 && isAdmin && (
        <details className="card" style={{ marginTop: 10 }}>
          <summary><b>Diferencias con la planilla ({diffs.length})</b> <span className="muted">· la asistencia no coincide con los socios cargados</span></summary>
          <ul className="list">{diffs.map((d, i) => <li key={i}>{d.text}</li>)}</ul>
        </details>
      )}

      {offline.banner}
      {isAdmin && selected && (
        <MemberDrawer closeHref={`/socios?mes=${data.month}&vista=asistencia`}>
          <MemberPanel key={selected.id} m={selected} ledger={ledger} statement={statement} barbers={barbers} today={today} />
        </MemberDrawer>
      )}
      {isAdmin && <NewMemberForm barbers={barbers} prices={prices} />}
    </>
  );
}

/** Ficha del socio abierta encima de la tabla; se cierra con la cruz, tocando afuera o con Escape. */
export function MemberDrawer({ closeHref, children }: { closeHref: string; children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") router.push(closeHref, { scroll: false }); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [closeHref, router]);
  return (
    <div className="drawer-back" role="dialog" aria-modal="true" aria-label="Ficha del socio" onClick={(e) => { if (e.target === e.currentTarget) router.push(closeHref, { scroll: false }); }}>
      <div className="drawer">
        <div className="drawer-top"><Link className="btn" href={closeHref} scroll={false} aria-label="Cerrar la ficha">Cerrar ✕</Link></div>
        {children}
      </div>
    </div>
  );
}

export function ViewSwitch({ month, current }: { month: string; current: "cuenta" | "asistencia" }) {
  return (
    <nav className="seg" aria-label="Vista de socios" style={{ margin: "6px 0" }}>
      <Link href={`/socios?mes=${month}`} aria-current={current === "cuenta" ? "page" : undefined} style={{ textAlign: "center", padding: "14px 8px", fontWeight: 600, textDecoration: "none", color: current === "cuenta" ? "var(--bg)" : "var(--ink)", background: current === "cuenta" ? "var(--brand)" : "transparent" }}>Cuenta mensual</Link>
      <Link href={`/socios?mes=${month}&vista=asistencia`} aria-current={current === "asistencia" ? "page" : undefined} style={{ textAlign: "center", padding: "14px 8px", fontWeight: 600, textDecoration: "none", color: current === "asistencia" ? "var(--bg)" : "var(--ink)", background: current === "asistencia" ? "var(--brand)" : "transparent" }}>Asistencia por día</Link>
    </nav>
  );
}

function FragmentGroup({ title, colSpan, children }: { title: string; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="section"><th className="sticky label">{title}</th><td colSpan={colSpan - 1} /></tr>
      {children}
    </>
  );
}
