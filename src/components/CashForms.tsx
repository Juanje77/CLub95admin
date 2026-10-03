"use client";
import { useState } from "react";
import { handOver, withdraw } from "../app/actions";
import { formatARS } from "../domain/money";
import { useAction } from "./useAction";

const num = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

interface Cov {
  userId: string;
  name: string;
  labor: number;
  bankCovered: number;
  allowed: number;
  withdrawn: number;
  remaining: number;
}

export function WithdrawForm({ barbers, fixedUserId, coverage }: { barbers: { id: string; name: string }[]; fixedUserId?: string; coverage: Cov[] }) {
  const [userId, setUserId] = useState(fixedUserId ?? barbers[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { pending, run, toast } = useAction();
  const cov = coverage.find((c) => c.userId === userId);
  const outOfRule = num(amount) > (cov?.remaining ?? 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => withdraw({ userId, amount: num(amount), note }), () => { setAmount(""); setNote(""); });
      }}
    >
      {!fixedUserId && (
        <label className="field">
          <span>Barbero</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
      )}
      <div className="card" style={{ marginBottom: 8 }}>
        <div className="row spread"><span>Le corresponde cobrar hoy</span><span className="num">{formatARS(cov?.labor ?? 0)}</span></div>
        <div className="row spread"><span>Ya cubierto por el banco</span><span className="num">{formatARS(cov?.bankCovered ?? 0)}</span></div>
        <div className="row spread"><b>Puede retirar en efectivo</b><span className="num">{formatARS(cov?.remaining ?? 0)}</span></div>
      </div>
      <label className="field">
        <span>Monto a retirar en efectivo</span>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </label>
      {outOfRule && num(amount) > 0 && (
        <label className="field">
          <span>El banco ya cubre lo que le toca: dejá el motivo del retiro</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      <button className="btn primary" type="submit" disabled={pending || num(amount) <= 0 || (outOfRule && !note.trim())}>
        Registrar retiro
      </button>
      {toast}
    </form>
  );
}

export function HandOverForm({ balance }: { balance: number }) {
  const [amount, setAmount] = useState(String(balance > 0 ? balance : ""));
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const { pending, run, toast } = useAction();
  const differs = num(amount) !== balance;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => handOver({ amount: num(amount), receivedBy: by, note }));
      }}
    >
      <label className="field">
        <span>Efectivo entregado (en caja hay {formatARS(balance)})</span>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="field">
        <span>Lo recibe</span>
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Nombre" />
      </label>
      {differs && num(amount) > 0 && (
        <label className="field">
          <span>No coincide con lo que debería haber: dejá una nota</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      <button className="btn primary" type="submit" disabled={pending || num(amount) <= 0 || !by.trim() || (differs && !note.trim())}>
        Registrar rendición
      </button>
      {toast}
    </form>
  );
}
