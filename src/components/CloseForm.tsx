"use client";
import { useMemo, useState } from "react";
import { closeCaja } from "../app/actions";
import { validateClose } from "../domain/closing";
import { formatARS } from "../domain/money";
import { useAction } from "./useAction";

interface Props {
  date: string;
  expectedIncome: number;
  expectedCash: number | null;
  expectedTransfers: number | null;
  unpaidSales: number;
  accounts: { key: string; name: string }[];
  defaultChange: number;
}

const num = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

export default function CloseForm({ date, expectedIncome, expectedCash, expectedTransfers, unpaidSales, accounts, defaultChange }: Props) {
  const [cash, setCash] = useState("");
  const [acc, setAcc] = useState<Record<string, string>>({});
  const [change, setChange] = useState(String(defaultChange || ""));
  const [note, setNote] = useState("");
  const { pending, run, toast } = useAction();

  const transfers = Object.values(acc).reduce((a, v) => a + num(v), 0);
  const check = useMemo(
    () => validateClose({ expectedIncome, expectedCash, expectedTransfers, declaredCash: num(cash), declaredTransfers: transfers, changeLeft: num(change), note, unpaidSales }),
    [expectedIncome, expectedCash, expectedTransfers, cash, transfers, change, note, unpaidSales],
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => closeCaja({ date, cash: num(cash), accounts: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, num(v)])), changeLeft: num(change), note }));
      }}
    >
      <label className="field">
        <span>Efectivo que contaste (de las ventas de hoy)</span>
        <input inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
      </label>
      {accounts.map((a) => (
        <label className="field" key={a.key}>
          <span>Transferencias a {a.name}</span>
          <input inputMode="numeric" value={acc[a.key] ?? ""} onChange={(e) => setAcc((s) => ({ ...s, [a.key]: e.target.value }))} placeholder="0" />
        </label>
      ))}
      <label className="field">
        <span>Cambio que dejás en la caja (no cuenta como ingreso)</span>
        <input inputMode="numeric" value={change} onChange={(e) => setChange(e.target.value)} placeholder="0" />
      </label>

      <div className="card" style={{ margin: "12px 0" }}>
        <div className="row spread">
          <span>Cobrado</span>
          <span className="num">{formatARS(check.declaredTotal)}</span>
        </div>
        <div className="row spread">
          <span>Debería haber</span>
          <span className="num">{formatARS(expectedIncome)}</span>
        </div>
        <div className="row spread" style={{ marginTop: 6 }}>
          <span>Diferencia</span>
          <span className={`diff ${check.difference === 0 ? "ok" : "err"}`}>{check.difference > 0 ? "+" : ""}{formatARS(check.difference)}</span>
        </div>
        {check.cashDifference !== null && check.cashDifference !== 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Efectivo: {check.cashDifference > 0 ? "sobran" : "faltan"} {formatARS(Math.abs(check.cashDifference))} · Transferencias: {check.transfersDifference! > 0 ? "sobran" : "faltan"} {formatARS(Math.abs(check.transfersDifference ?? 0))}
          </p>
        )}
      </div>

      {check.needsNote && (
        <label className="field">
          <span>Nota obligatoria: ¿por qué hay diferencia?</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: un cliente transfirió mañana" />
        </label>
      )}
      {check.errors.filter((e) => e.code !== "NOTA_OBLIGATORIA").map((e) => (
        <div key={e.code} className="alert ERROR">{e.message}</div>
      ))}
      <button className="big gold" type="submit" disabled={pending || !check.ok}>
        Cerrar caja del día
        <small>Después de cerrar no se puede editar</small>
      </button>
      {toast}
    </form>
  );
}
