"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { editExpense, removeExpense, removeExtraIncome, removeRecurring, saveConcept, saveExpense, saveExtraIncome, saveRecurring, toggleConcept } from "../app/actions";
import { formatARS, formatDate, monthLabel } from "../domain/money";
import { compressToJpeg } from "../lib/image";
import type { Category, ExpenseListRow, ExpenseSummary, RecurringRow } from "../services/expenses";
import { HBars } from "./Charts";
import { useAction } from "./useAction";

const num = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
const CAT_LABEL: Record<Category, string> = { VARIABLE: "Gastos variables", ESTRUCTURA: "Gastos de estructura", INVERSION: "Inversiones", REPOSICION: "Reposición" };
const CAT_ORDER: Category[] = ["ESTRUCTURA", "VARIABLE", "INVERSION", "REPOSICION"];

export interface ConceptView { id: string; name: string; category: Category; active: boolean }
export interface ExtraView { id: string; date: string; concept: string; amount: number; note: string | null }

interface Props {
  month: string;
  prevMonth: string;
  nextMonth: string;
  today: string;
  conceptFilter: string;
  concepts: ConceptView[];
  rows: ExpenseListRow[];
  summary: ExpenseSummary;
  recurring: RecurringRow[];
  extra: ExtraView[];
  /** Conceptos más usados (ids), para los botones de carga rápida. */
  topConcepts: string[];
  prevTotal: number;
}

function ConceptSelect({ concepts, value, onChange }: { concepts: ConceptView[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Elegí un concepto…</option>
      {CAT_ORDER.map((cat) => (
        <optgroup key={cat} label={CAT_LABEL[cat]}>
          {concepts.filter((c) => c.active && c.category === cat).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function NewExpenseForm({ concepts, topConcepts, today, preset }: { concepts: ConceptView[]; topConcepts: string[]; today: string; preset: { conceptId: string; amount: string; n: number } }) {
  const [date, setDate] = useState(today);
  const [conceptId, setConceptId] = useState(preset.conceptId);
  const [amount, setAmount] = useState(preset.amount);
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { pending, run, toast } = useAction();
  const [lastPreset, setLastPreset] = useState(preset.n);
  if (preset.n !== lastPreset) {
    setLastPreset(preset.n);
    setConceptId(preset.conceptId);
    setAmount(preset.amount);
  }
  const quick = topConcepts.map((id) => concepts.find((c) => c.id === id && c.active)).filter((c): c is ConceptView => !!c);
  const selected = concepts.find((c) => c.id === conceptId);
  return (
    <form
      id="nuevo-gasto"
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveExpense({ date, conceptId, amount: num(amount), description, receiptData: photo }), () => { setConceptId(""); setAmount(""); setDescription(""); setPhoto(null); setDate(today); if (fileRef.current) fileRef.current.value = ""; });
      }}
    >
      <div className="field"><span>1. ¿En qué fue?</span></div>
      {quick.length > 0 && (
        <div className="quick" role="group" aria-label="Conceptos frecuentes">
          {quick.map((c) => (
            <button key={c.id} type="button" className={`pill ${c.id === conceptId ? "on" : ""}`} aria-pressed={c.id === conceptId} onClick={() => setConceptId(c.id)}>{c.name}</button>
          ))}
        </div>
      )}
      <label className="field"><span>{quick.length > 0 ? "Otro concepto" : "Concepto"}</span><ConceptSelect concepts={concepts} value={quick.some((c) => c.id === conceptId) ? "" : conceptId} onChange={setConceptId} /></label>
      <label className="field"><span>2. Monto ($)</span><input inputMode="numeric" className="bigmoney" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></label>
      <button className="big gold" type="submit" disabled={pending || !conceptId || num(amount) <= 0}>
        {selected && num(amount) > 0 ? `Guardar ${selected.name} · ${formatARS(num(amount))}` : "Guardar gasto"}
      </button>
      <details className="more">
        <summary className="muted">Más datos: fecha, nota o foto del comprobante</summary>
        <label className="field"><span>Fecha (hoy por defecto)</span><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>Descripción (opcional)</span><input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="field">
          <span>Foto del comprobante (opcional)</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setPhotoError(null);
              if (!f) return setPhoto(null);
              try {
                setPhoto(await compressToJpeg(f));
              } catch (err) {
                setPhoto(null);
                setPhotoError(err instanceof Error ? err.message : "No se pudo procesar la foto.");
              }
            }}
          />
        </label>
        {photo && <img src={photo} alt="Vista previa del comprobante" style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 8, marginBottom: 8 }} />}
        {photoError && <div className="alert ERROR">{photoError}</div>}
      </details>
      {toast}
    </form>
  );
}

function ExpenseRowView({ r, concepts, today }: { r: ExpenseListRow; concepts: ConceptView[]; today: string }) {
  const [date, setDate] = useState(r.date);
  const [conceptId, setConceptId] = useState(r.conceptId);
  const [amount, setAmount] = useState(String(r.amount));
  const [description, setDescription] = useState(r.description ?? "");
  const { pending, run, toast } = useAction();
  return (
    <li style={{ display: "block" }}>
      <div className="row spread">
        <span>
          <b>{r.concept}</b> <span className="muted">· {formatDate(r.date)}{r.description ? ` · ${r.description}` : ""}</span>
          {r.hasReceipt && <> <a href={`/api/comprobante/${r.id}`} target="_blank" rel="noreferrer" aria-label="Ver comprobante">📎</a></>}
        </span>
        <span className="num">{formatARS(r.amount)}</span>
      </div>
      <details>
        <summary className="muted">Editar o borrar</summary>
        <form onSubmit={(e) => { e.preventDefault(); run(() => editExpense({ id: r.id, date, conceptId, amount: num(amount), description })); }}>
          <label className="field"><span>Fecha</span><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>Concepto</span><ConceptSelect concepts={concepts} value={conceptId} onChange={setConceptId} /></label>
          <label className="field"><span>Monto ($)</span><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="field"><span>Descripción</span><input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <div className="row">
            <button className="btn primary" type="submit" disabled={pending || num(amount) <= 0}>Guardar cambios</button>
            <button className="btn danger" type="button" disabled={pending} onClick={() => { if (confirm("¿Borrar este gasto? Queda registrado quién lo borró.")) run(() => removeExpense({ id: r.id })); }}>Borrar</button>
          </div>
        </form>
        {toast}
      </details>
    </li>
  );
}

export default function GastosClient(p: Props) {
  const router = useRouter();
  const [preset, setPreset] = useState({ conceptId: "", amount: "", n: 0 });
  const { pending, run, toast } = useAction();

  const [newConcept, setNewConcept] = useState("");
  const [newCategory, setNewCategory] = useState<Category>("VARIABLE");
  const [recConcept, setRecConcept] = useState("");
  const [recDay, setRecDay] = useState("5");
  const [recAmount, setRecAmount] = useState("");
  const [exDate, setExDate] = useState(p.today);
  const [exConcept, setExConcept] = useState("Publicidad");
  const [exAmount, setExAmount] = useState("");

  const dueCount = p.recurring.filter((r) => r.due).length;
  const totalExtra = p.extra.reduce((a, e) => a + e.amount, 0);

  return (
    <>
      <div className="row spread" style={{ margin: "4px 0 8px" }}>
        <Link className="btn" href={`/gastos?mes=${p.prevMonth}`} aria-label="Mes anterior">←</Link>
        <h1 style={{ textTransform: "capitalize" }}>Gastos · {monthLabel(p.month)}</h1>
        <Link className="btn" href={`/gastos?mes=${p.nextMonth}`} aria-label="Mes siguiente">→</Link>
      </div>

      <h2>Cargar un gasto</h2>
      <NewExpenseForm concepts={p.concepts} topConcepts={p.topConcepts} today={p.today} preset={preset} />

      {p.recurring.length > 0 && (
        <>
          <h2>Gastos fijos del mes {dueCount > 0 && <span className="chip err">{dueCount} pendiente{dueCount === 1 ? "" : "s"}</span>}</h2>
          <ul className="list card" style={{ padding: "4px 14px" }}>
            {p.recurring.map((r) => (
              <li key={r.id}>
                <span>{r.concept} <span className="muted">· vence el {r.dayOfMonth}{r.amount ? ` · ${formatARS(r.amount)}` : ""}</span></span>
                {r.done ? (
                  <span className="chip ok">Cargado ✓</span>
                ) : (
                  <button className={`btn ${r.due ? "primary" : ""}`} onClick={() => { setPreset({ conceptId: r.conceptId, amount: r.amount ? String(r.amount) : "", n: preset.n + 1 }); document.getElementById("nuevo-gasto")?.scrollIntoView({ behavior: "smooth" }); }}>
                    {r.due ? "Cargar ⚠" : "Cargar"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Resumen del mes</h2>
      <div className="card">
        <div className="muted">Total del mes</div>
        <div className="diff" style={{ fontSize: "1.8rem" }}>{formatARS(p.summary.total)}</div>
        <div className="muted">
          {p.prevTotal > 0
            ? `${p.summary.total >= p.prevTotal ? "+" : "−"}${formatARS(Math.abs(p.summary.total - p.prevTotal))} contra ${monthLabel(p.prevMonth)} (${formatARS(p.prevTotal)})`
            : `Sin gastos cargados en ${monthLabel(p.prevMonth)}`}
        </div>
        <h3 style={{ margin: "12px 0 6px" }}>Por categoría</h3>
        <HBars ariaLabel="Gastos del mes por categoría" items={CAT_ORDER.map((c) => ({ label: CAT_LABEL[c], value: p.summary.byCategory[c] }))} />
        {p.summary.byConcept.length > 0 && (
          <>
            <h3 style={{ margin: "12px 0 6px" }}>Por concepto</h3>
            <HBars ariaLabel="Gastos del mes por concepto" items={p.summary.byConcept.map((c) => ({ label: c.concept, value: c.total, hint: `${c.count} carga${c.count === 1 ? "" : "s"}` }))} />
          </>
        )}
        <p className="muted" style={{ margin: "10px 0 0" }}>Estos gastos ya se descuentan en el resultado del <Link href={`/panel?mes=${p.month}`}>panel del dueño</Link> (la reposición de mercadería se muestra aparte).</p>
      </div>

      <h2>Gastos cargados</h2>
      <label className="field">
        <span>Filtrar por concepto</span>
        <select value={p.conceptFilter} onChange={(e) => router.push(`/gastos?mes=${p.month}${e.target.value ? `&concepto=${e.target.value}` : ""}`)}>
          <option value="">Todos</option>
          {p.concepts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <ul className="list card" style={{ padding: "4px 14px" }}>
        {p.rows.map((r) => <ExpenseRowView key={r.id} r={r} concepts={p.concepts} today={p.today} />)}
        {p.rows.length === 0 && <li className="muted">No hay gastos cargados {p.conceptFilter ? "de ese concepto " : ""}este mes.</li>}
      </ul>

      <h2>Otros ingresos (publicidad, alquiler de yerba…)</h2>
      <div className="card">
        <div className="row spread"><span>Total del mes</span><span className="num">{formatARS(totalExtra)}</span></div>
        <ul className="list">
          {p.extra.map((e) => (
            <li key={e.id}>
              <span>{e.concept} <span className="muted">· {formatDate(e.date)}{e.note ? ` · ${e.note}` : ""}</span></span>
              <span className="num">{formatARS(e.amount)} <button className="btn danger" style={{ minHeight: 32, padding: "2px 10px" }} aria-label="Borrar ingreso" onClick={() => { if (confirm("¿Borrar este ingreso?")) run(() => removeExtraIncome({ id: e.id })); }}>✕</button></span>
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); run(() => saveExtraIncome({ date: exDate, concept: exConcept, amount: num(exAmount), note: "" }), () => setExAmount("")); }}>
          <label className="field"><span>Fecha</span><input type="date" value={exDate} max={p.today} onChange={(e) => setExDate(e.target.value)} /></label>
          <label className="field"><span>Concepto</span><input list="extra-concepts" value={exConcept} onChange={(e) => setExConcept(e.target.value)} /></label>
          <datalist id="extra-concepts"><option value="Publicidad" /><option value="Alquiler de yerba" /></datalist>
          <label className="field"><span>Monto ($)</span><input inputMode="numeric" value={exAmount} onChange={(e) => setExAmount(e.target.value)} /></label>
          <button className="btn primary" type="submit" disabled={pending || num(exAmount) <= 0 || !exConcept.trim()}>Agregar ingreso</button>
        </form>
      </div>

      <h2>Conceptos y gastos fijos</h2>
      <details className="card">
        <summary><b>Conceptos de gasto</b> <span className="muted">(la lista cerrada que se elige al cargar)</span></summary>
        <ul className="list">
          {p.concepts.map((c) => (
            <li key={c.id}>
              <span>{c.name} <span className="muted">· {CAT_LABEL[c.category]}</span></span>
              <button className="btn" style={{ minHeight: 32, padding: "2px 10px" }} disabled={pending} onClick={() => run(() => toggleConcept({ id: c.id, active: !c.active }))}>{c.active ? "Dar de baja" : "Reactivar"}</button>
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); run(() => saveConcept({ name: newConcept, category: newCategory }), () => setNewConcept("")); }}>
          <label className="field"><span>Concepto nuevo</span><input value={newConcept} onChange={(e) => setNewConcept(e.target.value)} /></label>
          <label className="field"><span>Categoría</span><select value={newCategory} onChange={(e) => setNewCategory(e.target.value as Category)}>{CAT_ORDER.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</select></label>
          <button className="btn primary" type="submit" disabled={pending || !newConcept.trim()}>Crear concepto</button>
        </form>
      </details>
      <details className="card" style={{ marginTop: 10 }}>
        <summary><b>Gastos fijos recurrentes</b> <span className="muted">(alquiler, luz, internet…: avisan si no se cargan)</span></summary>
        <ul className="list">
          {p.recurring.map((r) => (
            <li key={r.id}>
              <span>{r.concept} <span className="muted">· día {r.dayOfMonth}{r.amount ? ` · ${formatARS(r.amount)}` : ""}</span></span>
              <button className="btn danger" style={{ minHeight: 32, padding: "2px 10px" }} disabled={pending} onClick={() => { if (confirm("¿Sacar este gasto fijo?")) run(() => removeRecurring({ id: r.id })); }}>Sacar</button>
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); run(() => saveRecurring({ conceptId: recConcept, dayOfMonth: num(recDay), amount: recAmount ? num(recAmount) : null, description: "" }), () => setRecAmount("")); }}>
          <label className="field"><span>Concepto</span><ConceptSelect concepts={p.concepts} value={recConcept} onChange={setRecConcept} /></label>
          <label className="field"><span>Día del mes en que vence (1 a 28)</span><input inputMode="numeric" value={recDay} onChange={(e) => setRecDay(e.target.value)} /></label>
          <label className="field"><span>Monto habitual (opcional)</span><input inputMode="numeric" value={recAmount} onChange={(e) => setRecAmount(e.target.value)} /></label>
          <button className="btn primary" type="submit" disabled={pending || !recConcept}>Agregar gasto fijo</button>
        </form>
      </details>
      {toast}
    </>
  );
}
