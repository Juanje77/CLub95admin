import { describe, expect, it } from "vitest";
import { flushQueue, isNetworkError, MAX_AGE_MS, OfflineQueue, type QueueItem, type StorageLike } from "../src/lib/offline-queue";

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}
const item = (key: string, value: number, at: number, action: QueueItem["action"] = "saveServiceCount"): QueueItem => ({ key, action, payload: { v: value }, value, at });
const T0 = 1_000_000;

describe("cola de cambios sin enviar", () => {
  it("guarda y devuelve en orden", () => {
    const q = new OfflineQueue(new MemStorage());
    q.enqueue(item("a", 1, T0));
    q.enqueue(item("b", 2, T0 + 1));
    expect(q.list(T0 + 2).map((i) => i.key)).toEqual(["a", "b"]);
    expect(q.size(T0 + 2)).toBe(2);
  });

  it("editar dos veces la misma celda deja solo el último valor", () => {
    const q = new OfflineQueue(new MemStorage());
    q.enqueue(item("celda", 3, T0));
    q.enqueue(item("celda", 5, T0 + 10));
    const l = q.list(T0 + 20);
    expect(l).toHaveLength(1);
    expect(l[0]!.value).toBe(5);
  });

  it("sobrevive a recargar la página (usa el mismo almacenamiento)", () => {
    const st = new MemStorage();
    new OfflineQueue(st).enqueue(item("a", 1, T0));
    expect(new OfflineQueue(st).list(T0 + 1)).toHaveLength(1);
  });

  it("descarta lo que tiene más de 12 horas y tolera datos rotos", () => {
    const st = new MemStorage();
    const q = new OfflineQueue(st);
    q.enqueue(item("viejo", 1, T0));
    expect(q.list(T0 + MAX_AGE_MS + 1)).toEqual([]);
    st.setItem("club95.queue.v1", "{no es json");
    expect(q.list(T0)).toEqual([]);
    st.setItem("club95.queue.v1", JSON.stringify([{ nada: true }, null]));
    expect(q.list(T0)).toEqual([]);
  });

  it("quitar un cambio no borra una edición más nueva de la misma celda", () => {
    const q = new OfflineQueue(new MemStorage());
    q.enqueue(item("c", 1, T0));
    q.enqueue(item("c", 2, T0 + 5)); // se editó de nuevo mientras se enviaba el primero
    q.remove("c", T0);
    expect(q.list(T0 + 6).map((i) => i.value)).toEqual([2]);
    q.remove("c", T0 + 5);
    expect(q.list(T0 + 6)).toEqual([]);
  });
});

describe("errores de conexión", () => {
  it("reconoce los de red y no los del servidor", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("Load failed"))).toBe(true);
    expect(isNetworkError(new Error("NetworkError when attempting to fetch resource"))).toBe(true);
    expect(isNetworkError(new Error("Unexpected token <"))).toBe(false);
    expect(isNetworkError("boom")).toBe(false);
  });
});

describe("enviar al volver la señal", () => {
  const fill = () => {
    const q = new OfflineQueue(new MemStorage());
    q.enqueue(item("a", 1, T0));
    q.enqueue(item("b", 2, T0 + 1));
    q.enqueue(item("c", 3, T0 + 2));
    return q;
  };

  it("manda todo en orden y vacía la cola", async () => {
    const q = fill();
    const sent: string[] = [];
    const r = await flushQueue(q, async (i) => { sent.push(i.key); return { ok: true }; }, T0 + 10);
    expect(sent).toEqual(["a", "b", "c"]);
    expect(r).toEqual({ sent: 3, rejected: [], offline: false });
    expect(q.list(T0 + 10)).toEqual([]);
  });

  it("si se corta la conexión a mitad, lo que falta queda pendiente", async () => {
    const q = fill();
    const r = await flushQueue(q, async (i) => { if (i.key === "b") throw new TypeError("Failed to fetch"); return { ok: true }; }, T0 + 10);
    expect(r).toMatchObject({ sent: 1, offline: true });
    expect(q.list(T0 + 10).map((i) => i.key)).toEqual(["b", "c"]);
  });

  it("lo que el servidor rechaza (día cerrado, permisos) se informa y sale de la cola", async () => {
    const q = fill();
    const r = await flushQueue(q, async (i) => (i.key === "b" ? { ok: false, error: "La caja de ese día ya está cerrada." } : { ok: true }), T0 + 10);
    expect(r.sent).toBe(2);
    expect(r.rejected.map((x) => [x.item.key, x.error])).toEqual([["b", "La caja de ese día ya está cerrada."]]);
    expect(q.list(T0 + 10)).toEqual([]);
  });

  it("repetir el envío es seguro: el mismo valor absoluto no se duplica", async () => {
    const q = new OfflineQueue(new MemStorage());
    q.enqueue(item("cortes", 3, T0));
    let total = 0;
    const setTo = async (i: QueueItem) => { total = i.value; return { ok: true } as const; };
    await flushQueue(q, setTo, T0 + 1);
    q.enqueue(item("cortes", 3, T0 + 2)); // se reenvía el mismo cambio
    await flushQueue(q, setTo, T0 + 3);
    expect(total).toBe(3);
  });
});
