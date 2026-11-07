"use client";
import { useState } from "react";
import { reopenCaja } from "../app/actions";
import { useAction } from "./useAction";

export default function ReopenForm({ date }: { date: string }) {
  const [reason, setReason] = useState("");
  const { pending, run, toast } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => reopenCaja({ date, reason }));
      }}
    >
      <label className="field">
        <span>Motivo de la reapertura (queda registrado)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: faltó cargar un corte" />
      </label>
      <button className="btn danger" type="submit" disabled={pending || !reason.trim()}>
        Reabrir caja
      </button>
      {toast}
    </form>
  );
}
