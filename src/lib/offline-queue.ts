/**
 * Cola de cambios sin enviar. Cada celda de la planilla guarda un VALOR ABSOLUTO ("hoy hubo 3 cortes"), por eso reenviar es seguro:
 * repetir el mismo cambio nunca duplica nada, y si se editó dos veces la misma celda solo importa la última (se reemplaza por clave).
 */
export type OfflineAction = "saveServiceCount" | "saveMembershipCount" | "saveProductCount" | "saveDeclared" | "saveChange" | "toggleAttendance";

export interface QueueItem {
  /** Identifica la celda (día + fila): un cambio nuevo en la misma celda reemplaza al anterior. */
  key: string;
  action: OfflineAction;
  payload: Record<string, unknown>;
  /** Valor para mostrar mientras está pendiente. */
  value: number;
  at: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Un cambio pendiente más viejo que esto se descarta: reenviarlo podría pisar lo que otra persona cargó después. */
export const MAX_AGE_MS = 12 * 3600 * 1000;

export class OfflineQueue {
  constructor(
    private storage: StorageLike,
    private storageKey = "club95.queue.v1",
  ) {}

  /** Todo lo guardado y bien formado, sin filtrar por antigüedad (quitar un cambio no debe perder otros por el reloj). */
  private all(): QueueItem[] {
    try {
      const raw = this.storage.getItem(this.storageKey);
      const arr = raw ? (JSON.parse(raw) as QueueItem[]) : [];
      return arr.filter((i) => i && typeof i.key === "string" && typeof i.action === "string" && typeof i.at === "number");
    } catch {
      return [];
    }
  }

  /** Pendientes vigentes (los de más de 12 horas ya no se reenvían). */
  list(now = Date.now()): QueueItem[] {
    return this.all().filter((i) => now - i.at <= MAX_AGE_MS);
  }

  private write(items: QueueItem[]) {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(items));
    } catch {
      /* sin almacenamiento disponible (modo privado): la cola queda solo en memoria de la pestaña */
    }
  }

  enqueue(item: QueueItem) {
    this.write([...this.all().filter((i) => i.key !== item.key && item.at - i.at <= MAX_AGE_MS), item]);
  }

  /** Saca el cambio solo si no hubo una edición más nueva de la misma celda mientras se enviaba. */
  remove(key: string, at: number) {
    this.write(this.all().filter((i) => !(i.key === key && i.at === at)));
  }

  size(now = Date.now()): number {
    return this.list(now).length;
  }
}

/** ¿El error es de conexión (no hubo respuesta del servidor)? */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true; // fetch sin red: "Failed to fetch" / "Load failed" / "NetworkError…"
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /failed to fetch|load failed|network ?error|network request failed|fetch failed|timeout/i.test(msg);
}

export type SendResult = { ok: true } | { ok: false; error: string };

export interface FlushResult {
  sent: number;
  /** Cambios que el servidor rechazó (día cerrado, permisos…): se sacan de la cola y se avisa. */
  rejected: { item: QueueItem; error: string }[];
  /** Se cortó por falta de conexión: lo que queda sigue pendiente. */
  offline: boolean;
}

/** Envía los cambios en orden. Corta al primer error de conexión; los rechazos del servidor se descartan y se informan. */
export async function flushQueue(queue: OfflineQueue, send: (item: QueueItem) => Promise<SendResult>, now = Date.now()): Promise<FlushResult> {
  const out: FlushResult = { sent: 0, rejected: [], offline: false };
  for (const item of queue.list(now)) {
    try {
      const r = await send(item);
      queue.remove(item.key, item.at);
      if (r.ok) out.sent++;
      else out.rejected.push({ item, error: r.error });
    } catch (e) {
      if (isNetworkError(e)) {
        out.offline = true;
        break;
      }
      queue.remove(item.key, item.at);
      out.rejected.push({ item, error: "Ocurrió un error al enviar el cambio." });
    }
  }
  return out;
}
