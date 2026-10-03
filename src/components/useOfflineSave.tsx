"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveChange, saveDeclared, saveMembershipCount, saveProductCount, saveServiceCount, toggleAttendance, type ActionResult } from "../app/actions";
import { flushQueue, isNetworkError, OfflineQueue, type OfflineAction, type QueueItem } from "../lib/offline-queue";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SENDERS: Record<OfflineAction, (p: any) => Promise<ActionResult>> = {
  saveServiceCount,
  saveMembershipCount,
  saveProductCount,
  saveDeclared,
  saveChange,
  toggleAttendance,
};

/**
 * Guarda un cambio en el servidor; si no hay señal lo deja en el celular y lo manda solo cuando vuelve (o cada 10 segundos).
 * Los cambios son valores absolutos, así que reenviar nunca duplica. Un cambio que el servidor rechaza (día cerrado, permisos) se avisa.
 */
export function useOfflineSave() {
  const queue = useRef<OfflineQueue | null>(null);
  const flushing = useRef(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);

  const getQueue = () => (queue.current ??= new OfflineQueue(window.localStorage));
  const refresh = () => setItems(getQueue().list());

  const flush = useCallback(async () => {
    if (flushing.current || getQueue().list().length === 0) return;
    flushing.current = true;
    try {
      const r = await flushQueue(getQueue(), (i) => SENDERS[i.action](i.payload));
      if (r.rejected.length) setRejected((prev) => [...prev, ...r.rejected.map((x) => x.error)]);
    } finally {
      flushing.current = false;
      refresh();
    }
  }, []);

  useEffect(() => {
    refresh();
    flush();
    const onOnline = () => flush();
    window.addEventListener("online", onOnline);
    const t = setInterval(() => flush(), 10_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(t);
    };
  }, [flush]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const save = async (item: Omit<QueueItem, "at">) => {
    const full: QueueItem = { ...item, at: Date.now() };
    setError(null);
    // Sin señal, o con cambios esperando: se encola para conservar el orden.
    if (!navigator.onLine || getQueue().list().length > 0) {
      getQueue().enqueue(full);
      refresh();
      void flush();
      return;
    }
    setSaving((n) => n + 1);
    try {
      const r = await SENDERS[full.action](full.payload);
      if (!r.ok) setError(r.error);
    } catch (e) {
      if (isNetworkError(e) || !navigator.onLine) {
        getQueue().enqueue(full);
        refresh();
      } else setError("Ocurrió un error. Probá de nuevo.");
    } finally {
      setSaving((n) => n - 1);
    }
  };

  const pendingValue = (key: string): number | undefined => items.find((i) => i.key === key)?.value;

  const banner = (
    <>
      {items.length > 0 && (
        <div className="alert WARN" role="status" data-offline-banner>
          <b>{items.length} cambio{items.length === 1 ? "" : "s"} sin enviar.</b> Se mandan solos cuando vuelva la señal.{" "}
          <button className="btn" style={{ minHeight: 36, padding: "4px 12px" }} onClick={() => void flush()}>Reintentar ahora</button>
        </div>
      )}
      {rejected.map((msg, i) => (
        <div className="alert ERROR" role="alert" key={i}>
          No se pudo guardar un cambio: {msg}{" "}
          <button className="btn" style={{ minHeight: 36, padding: "4px 12px" }} onClick={() => setRejected((r) => r.filter((_, j) => j !== i))}>Entendido</button>
        </div>
      ))}
      {error && <div className="toast err" role="status" aria-live="polite">{error}</div>}
    </>
  );

  return { save, pendingValue, pending: items.length, saving, banner };
}
