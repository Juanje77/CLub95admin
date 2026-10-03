"use client";
import { useState } from "react";
import { addMembership, addProduct, addService, undoLast } from "../app/actions";
import { formatARS } from "../domain/money";
import { SERVICE_LABEL, type ServiceType } from "../domain/types";
import { useAction } from "./useAction";

const METHODS = [
  { id: "TRANSFERENCIA", label: "Transferencia" },
  { id: "EFECTIVO", label: "Efectivo" },
  { id: "MP", label: "Mercado Pago" },
] as const;

interface Props {
  date: string;
  barberId: string;
  closed: boolean;
  tariffs: { serviceType: ServiceType; price: number }[];
  products: { id: string; name: string; kind: string; price: number; stock: number; minStock: number }[];
  isAdmin: boolean;
}

export default function CajaPanel({ date, barberId, closed, tariffs, products, isAdmin }: Props) {
  // Casi todos los pagos son por transferencia: es el medio por defecto.
  const [method, setMethod] = useState<string>("TRANSFERENCIA");
  const [showProducts, setShowProducts] = useState(false);
  const { pending, run, toast } = useAction();

  if (closed) {
    return (
      <div className="card">
        La caja de este día está <b>cerrada</b>. {isAdmin ? "Podés reabrirla desde Cierre." : "Si falta cargar algo, pedile al admin que la reabra."}
      </div>
    );
  }

  return (
    <>
      <h2>Medio de pago</h2>
      <div className="seg" role="group" aria-label="Medio de pago">
        {METHODS.map((m) => (
          <button key={m.id} type="button" aria-pressed={method === m.id} onClick={() => setMethod(m.id)}>
            {m.label}
          </button>
        ))}
      </div>

      <h2>Servicio</h2>
      <div className="grid">
        {tariffs.map((t) => (
          <button key={t.serviceType} className="big" disabled={pending || t.price === 0} onClick={() => run(() => addService({ date, userId: barberId, serviceType: t.serviceType, paymentMethod: method }))}>
            {SERVICE_LABEL[t.serviceType]}
            <small>{formatARS(t.price)} · {METHODS.find((m) => m.id === method)?.label}</small>
          </button>
        ))}
        <button className="big alt" disabled={pending} onClick={() => run(() => addMembership({ date, userId: barberId }))}>
          Socio (membresía)
          <small>No se cobra en caja · suma una asistencia</small>
        </button>
      </div>

      <h2>Bebidas y productos</h2>
      <button className="btn" type="button" onClick={() => setShowProducts((v) => !v)} aria-expanded={showProducts}>
        {showProducts ? "Ocultar" : "Vender bebida, cera, polvo o aceite"}
      </button>
      {showProducts && (
        <div className="grid two" style={{ marginTop: 10 }}>
          {products.map((p) => (
            <button key={p.id} className="big alt" disabled={pending} onClick={() => run(() => addProduct({ date, userId: barberId, productId: p.id, quantity: 1, paymentMethod: method }))}>
              {p.name}
              <small>
                {formatARS(p.price)} · stock {p.stock}
                {p.minStock > 0 && p.stock <= p.minStock ? " ⚠" : ""}
              </small>
            </button>
          ))}
          {products.length === 0 && <p className="muted">Todavía no hay productos con precio cargado.</p>}
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn danger" disabled={pending} onClick={() => run(() => undoLast({ date, userId: isAdmin ? barberId : undefined }))}>
          Deshacer la última
        </button>
      </div>
      {toast}
    </>
  );
}
