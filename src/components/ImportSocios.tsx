"use client";
import Link from "next/link";
import { useState } from "react";
import { importSocios, previewSocios } from "../app/actions";
import { formatARS, formatDate, monthLabel } from "../domain/money";
import type { ImportPlan } from "../import/socios";
import { useAction } from "./useAction";

interface Preview { sheets: { name: string; month: string }[]; plan: ImportPlan }

const PAY_TEXT: Record<string, string> = { NONE: "", NEW: "Se carga", DUPLICATE: "Ya estaba", DAY_CLOSED: "Día cerrado: no se carga" };

export default function ImportSocios() {
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<{ message: string; month: string } | null>(null);
  const { pending, run, toast } = useAction();

  const form = (name: string) => {
    const f = new FormData();
    if (file) f.set("file", file);
    f.set("sheet", name);
    return f;
  };
  const read = (name: string) => run(() => previewSocios(form(name)), (r) => { const d = r.data as Preview; setPreview(d); setSheet(d.plan.sheet); setDone(null); });
  const p = preview?.plan;

  return (
    <>
      <h1>Cargar socios desde Excel</h1>
      <p className="muted">
        Subí la planilla (<b>Club95_v3.xlsx</b>), elegí la hoja del mes y mirá qué se va a cargar <b>antes de guardar</b>. Se crean los socios que faltan, se fijan las sesiones del mes
        al que corresponde cada fila (columna MES QUE CORRESPONDE) y se registran los cobros. Si lo repetís, no duplica nada.
      </p>
      <div className="card">
        <label className="field">
          <span>Archivo de Excel</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setDone(null); }} />
        </label>
        <button className="btn primary" type="button" disabled={pending || !file} onClick={() => read("")}>Leer la planilla</button>
      </div>

      {preview && p && (
        <>
          <h2>Qué se va a cargar</h2>
          <div className="card">
            {preview.sheets.length > 1 && (
              <label className="field">
                <span>Hoja (mes en que se cobra)</span>
                <select value={sheet} onChange={(e) => { setSheet(e.target.value); read(e.target.value); }}>
                  {preview.sheets.map((s) => <option key={s.name} value={s.name}>{s.name.trim()}</option>)}
                </select>
              </label>
            )}
            <div className="kv">
              <span>Socios nuevos</span><b className="num">{p.totals.toCreate}</b>
              <span>Socios que ya existen</span><b className="num">{p.totals.existing}</b>
              <span>Sesiones</span><b className="num">{p.totals.sessions}</b>
              <span>Cobros a cargar</span><b className="num">{p.totals.payments} · {formatARS(p.totals.paymentsAmount)}</b>
            </div>
            <p className="muted" style={{ margin: "8px 0" }}>
              Solo se lee <b>esta hoja</b>: lo que se debía de meses anteriores no se carga si no está en ella. Los cobros se registran como transferencia / banco.
            </p>
            {p.skipped.length > 0 && (
              <div className="alert WARN" role="alert">
                <b>No se cargan ({p.skipped.length}):</b>
                <ul className="list">{p.skipped.map((s) => <li key={s.row}>Fila {s.row} · {s.name}: {s.reason}</li>)}</ul>
              </div>
            )}
          </div>

          <div className="gridwrap" style={{ marginTop: 10 }} role="region" aria-label="Filas a cargar" tabIndex={0}>
            <table className="grid cuenta">
              <thead><tr><th className="sticky label">Socio</th><th>Plan</th><th>Barbero</th><th>Ses.</th><th>Mes</th><th>Cobrado</th><th>Fecha</th><th>Cobro</th><th>Socio</th></tr></thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.row} title={r.warnings.join("\n")}>
                    <th className="sticky label"><b>{r.name}</b>{r.warnings.length > 0 && <span className="chip warn" style={{ marginLeft: 4 }}>!</span>}</th>
                    <td style={{ textAlign: "left" }}>{r.plan === "GOLD" ? "Gold" : "Black"} · {r.serviceType === "CORTE" ? "Corte" : "C+B"}</td>
                    <td style={{ textAlign: "left" }}>{r.barber || "—"}{!r.barberId && !r.exists ? " ⚠" : ""}</td>
                    <td>{r.sessions || ""}</td>
                    <td style={{ textTransform: "capitalize" }}>{monthLabel(r.serviceMonth).split(" ")[0]}</td>
                    <td>{r.paid ? r.paid.toLocaleString("es-AR") : ""}</td>
                    <td>{r.payDateUsed ? formatDate(r.payDateUsed).slice(0, 5) : ""}</td>
                    <td style={{ textAlign: "left" }}>{PAY_TEXT[r.payAction]}</td>
                    <td style={{ textAlign: "left" }}>{r.exists ? "Existe" : "Nuevo"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.rows.some((r) => r.warnings.length > 0) && (
            <details className="card" style={{ marginTop: 10 }}>
              <summary><b>Advertencias ({p.rows.reduce((n, r) => n + r.warnings.length, 0)})</b></summary>
              <ul className="list">{p.rows.flatMap((r) => r.warnings.map((w, i) => <li key={`${r.row}-${i}`}><b>{r.name}:</b> {w}</li>))}</ul>
            </details>
          )}

          <button
            className="big gold"
            style={{ marginTop: 12 }}
            type="button"
            disabled={pending || !!done}
            onClick={() => { if (confirm(`Se van a cargar ${p.totals.toCreate} socios nuevos y ${p.totals.payments} cobros. ¿Seguro?`)) run(() => importSocios(form(sheet)), (r) => setDone({ message: r.message ?? "Listo.", month: (r.data as { month: string }).month })); }}
          >
            Cargar {p.totals.toCreate} socios, sus sesiones y {p.totals.payments} cobros
          </button>
        </>
      )}
      {done && (
        <div className="card" role="status" style={{ marginTop: 12 }}>
          <b>{done.message}</b>
          <div style={{ marginTop: 8 }}><Link className="btn primary" href={`/socios?mes=${done.month}`}>Ver los socios</Link></div>
        </div>
      )}
      <p style={{ marginTop: 12 }}><Link href="/socios">← Volver a Socios</Link></p>
      {toast}
    </>
  );
}
