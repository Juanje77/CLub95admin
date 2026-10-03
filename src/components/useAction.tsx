"use client";
import { useEffect, useState, useTransition } from "react";
import type { ActionResult } from "../app/actions";

/** Ejecuta una acción del servidor mostrando el resultado en un cartel (verde ok / rojo error). */
export function useAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 2500 : 6000);
    return () => clearTimeout(t);
  }, [msg]);

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          setMsg(r.message ? { ok: true, text: r.message } : null);
          after?.();
        } else setMsg({ ok: false, text: r.error });
      } catch {
        setMsg({ ok: false, text: "No hay conexión con el servidor. Revisá la señal y reintentá: no se guardó nada." });
      }
    });

  const toast = msg ? (
    <div className={`toast ${msg.ok ? "ok" : "err"}`} role="status" aria-live="polite">
      {msg.text}
    </div>
  ) : null;
  return { pending, run, toast };
}
