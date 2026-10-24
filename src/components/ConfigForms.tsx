"use client";
import { useState } from "react";
import { adminAddPrice, adminAddRule, adminAddTariff, adminAdjustStock, adminCreateBarber, adminCreateProduct, adminProductSettings, adminResetPin, adminSetActive, changePin } from "../app/actions";
import { formatARS, formatDate } from "../domain/money";
import { SERVICE_LABEL, SERVICE_TYPES, type ServiceType } from "../domain/types";
import { useAction } from "./useAction";

const num = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;

export interface UserView {
  id: string;
  name: string;
  username: string;
  role: string;
  active: boolean;
  isBarber: boolean;
  isMe: boolean;
  rule: { commissionBp: number; drinkDeduction: number; drinkCost: number; validFrom: string } | null;
}
export interface ProductView {
  id: string;
  name: string;
  kind: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  active: boolean;
}
export interface TariffView {
  serviceType: ServiceType;
  price: number;
  validFrom: string;
  upcoming: { price: number; validFrom: string }[];
}

/** Un PIN nuevo se muestra una sola vez y queda en pantalla hasta que se cierra. */
function SecretBox({ title, pin, onClose }: { title: string; pin: string; onClose: () => void }) {
  return (
    <div className="alert WARN" role="alert">
      <b>{title}</b>
      <div className="diff" style={{ fontSize: "2rem", margin: "4px 0" }}>{pin}</div>
      <div>Anotalo y pasáselo en persona. <b>No se vuelve a mostrar.</b></div>
      <button className="btn" style={{ marginTop: 8 }} onClick={onClose}>Ya lo anoté</button>
    </div>
  );
}

export function PinForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const { pending, run, toast } = useAction();
  const mismatch = again !== "" && next !== again;
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => changePin({ current, next }), () => { setCurrent(""); setNext(""); setAgain(""); });
      }}
    >
      <label className="field"><span>PIN actual</span><input type="password" inputMode="numeric" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
      <label className="field"><span>PIN nuevo (4 a 8 números)</span><input type="password" inputMode="numeric" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label className="field"><span>Repetí el PIN nuevo</span><input type="password" inputMode="numeric" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
      {mismatch && <div className="alert ERROR">Los dos PIN nuevos no coinciden.</div>}
      <button className="big" type="submit" disabled={pending || !current || !next || next !== again}>Cambiar mi PIN</button>
      {toast}
    </form>
  );
}

function RuleForm({ user, onDone }: { user: UserView; onDone?: () => void }) {
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [pct, setPct] = useState(String((user.rule?.commissionBp ?? 6000) / 100));
  const [drink, setDrink] = useState(String(user.rule?.drinkDeduction ?? 3000));
  const [cost, setCost] = useState(String(user.rule?.drinkCost ?? user.rule?.drinkDeduction ?? 3000));
  const { pending, run, toast } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => adminAddRule({ userId: user.id, validFrom, commissionBp: Math.round(Number(pct.replace(",", ".")) * 100), drinkDeduction: num(drink), drinkCost: num(cost) }), onDone);
      }}
    >
      <label className="field"><span>Rige desde</span><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></label>
      <label className="field"><span>Comisión (%)</span><input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></label>
      <label className="field"><span>Bebida que se descuenta por servicio ($)</span><input inputMode="numeric" value={drink} onChange={(e) => setDrink(e.target.value)} /></label>
      <label className="field"><span>Costo de esa bebida ($)</span><input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      <button className="btn primary" type="submit" disabled={pending}>Guardar comisión</button>
      {toast}
    </form>
  );
}

export function TeamSection({ users }: { users: UserView[] }) {
  const { pending, run, toast } = useAction();
  const [secret, setSecret] = useState<{ title: string; pin: string } | null>(null);
  return (
    <>
      {secret && <SecretBox title={secret.title} pin={secret.pin} onClose={() => setSecret(null)} />}
      <ul className="list card" style={{ padding: "4px 14px" }}>
        {users.map((u) => (
          <li key={u.id} style={{ display: "block" }}>
            <div className="row spread">
              <span>
                <b>{u.name}</b> <span className="muted">· {u.username} · {u.role === "DUENO" ? "dueño" : u.role === "ADMIN" ? "admin" : "barbero"}</span>
              </span>
              <span className={`chip ${u.active ? "ok" : "warn"}`}>{u.active ? "Activo" : "Inactivo"}</span>
            </div>
            {u.rule && (
              <div className="muted">Comisión {u.rule.commissionBp / 100}% · bebida {formatARS(u.rule.drinkDeduction)} (desde {formatDate(u.rule.validFrom)})</div>
            )}
            {!u.isMe && (
              <div className="row" style={{ marginTop: 6 }}>
                <button
                  className="btn"
                  disabled={pending}
                  onClick={() => { if (confirm(`¿Generar un PIN nuevo para ${u.name}? El anterior deja de funcionar.`)) run(() => adminResetPin({ userId: u.id }), (r) => { const d = r.data as { pin: string; name: string }; setSecret({ title: `Nuevo PIN de ${d.name}`, pin: d.pin }); }); }}
                >
                  Resetear PIN
                </button>
                <button className="btn" disabled={pending} onClick={() => run(() => adminSetActive({ userId: u.id, active: !u.active }))}>
                  {u.active ? "Desactivar" : "Activar"}
                </button>
              </div>
            )}
            {u.isBarber && (
              <details style={{ marginTop: 4 }}>
                <summary className="muted">Cambiar comisión</summary>
                <RuleForm user={u} />
              </details>
            )}
          </li>
        ))}
      </ul>
      <details className="card" style={{ marginTop: 10 }}>
        <summary><b>+ Agregar un barbero</b></summary>
        <NewBarberForm onCreated={(pin, name) => setSecret({ title: `PIN inicial de ${name}`, pin })} />
      </details>
      {toast}
    </>
  );
}

function NewBarberForm({ onCreated }: { onCreated: (pin: string, name: string) => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [pct, setPct] = useState("60");
  const [drink, setDrink] = useState("3000");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const { pending, run, toast } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => adminCreateBarber({ name, username, validFrom, commissionBp: Math.round(Number(pct.replace(",", ".")) * 100), drinkDeduction: num(drink), drinkCost: num(drink) }),
          (r) => { const d = r.data as { pin: string; name: string }; onCreated(d.pin, d.name); setName(""); setUsername(""); },
        );
      }}
    >
      <label className="field"><span>Nombre</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>Usuario para entrar (minúsculas, sin espacios)</span><input value={username} autoCapitalize="none" onChange={(e) => setUsername(e.target.value)} /></label>
      <label className="field"><span>Comisión (%)</span><input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></label>
      <label className="field"><span>Bebida que se descuenta por servicio ($)</span><input inputMode="numeric" value={drink} onChange={(e) => setDrink(e.target.value)} /></label>
      <label className="field"><span>Rige desde</span><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></label>
      <button className="btn primary" type="submit" disabled={pending || !name.trim() || !username.trim()}>Crear barbero</button>
      {toast}
    </form>
  );
}

export function TariffSection({ tariffs }: { tariffs: TariffView[] }) {
  const [serviceType, setServiceType] = useState<ServiceType>("CORTE");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [price, setPrice] = useState("");
  const { pending, run, toast } = useAction();
  return (
    <>
      <ul className="list card" style={{ padding: "4px 14px" }}>
        {SERVICE_TYPES.map((t) => {
          const row = tariffs.find((x) => x.serviceType === t);
          return (
            <li key={t}>
              <span>{SERVICE_LABEL[t]}{row?.upcoming.map((u) => <span key={u.validFrom} className="muted"> · desde {formatDate(u.validFrom)}: {formatARS(u.price)}</span>)}</span>
              <span className="num">{row ? formatARS(row.price) : "—"}</span>
            </li>
          );
        })}
      </ul>
      <details className="card" style={{ marginTop: 10 }}>
        <summary><b>Cambiar un precio</b></summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => adminAddTariff({ serviceType, validFrom, price: num(price) }), () => setPrice(""));
          }}
        >
          <label className="field"><span>Servicio</span><select value={serviceType} onChange={(e) => setServiceType(e.target.value as ServiceType)}>{SERVICE_TYPES.map((t) => <option key={t} value={t}>{SERVICE_LABEL[t]}</option>)}</select></label>
          <label className="field"><span>Rige desde (los días anteriores conservan el precio viejo)</span><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></label>
          <label className="field"><span>Precio nuevo ($)</span><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <button className="btn primary" type="submit" disabled={pending || num(price) <= 0}>Guardar precio</button>
        </form>
      </details>
      {toast}
    </>
  );
}

function ProductRowView({ p }: { p: ProductView }) {
  const [mode, setMode] = useState<"SET" | "ADD">("SET");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState(String(p.price));
  const [cost, setCost] = useState(String(p.cost));
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [min, setMin] = useState(String(p.minStock));
  const { pending, run, toast } = useAction();
  const low = p.minStock > 0 && p.stock <= p.minStock;
  return (
    <li style={{ display: "block" }}>
      <div className="row spread">
        <span><b>{p.name}</b> <span className="muted">· {formatARS(p.price)} (costo {formatARS(p.cost)})</span></span>
        <span className={`chip ${low ? "err" : p.active ? "" : "warn"}`}>{p.active ? `stock ${p.stock}${low ? " ⚠" : ""}` : "inactivo"}</span>
      </div>
      <details>
        <summary className="muted">Stock, precio y mínimo</summary>
        <form onSubmit={(e) => { e.preventDefault(); run(() => adminAdjustStock({ productId: p.id, mode, quantity: mode === "ADD" ? Number(qty) : num(qty), reason }), () => { setQty(""); setReason(""); }); }}>
          <div className="row">
            <select value={mode} onChange={(e) => setMode(e.target.value as "SET" | "ADD")} style={{ flex: 1 }}>
              <option value="SET">Contar: hay exactamente…</option>
              <option value="ADD">Sumar (compra) o restar (−)…</option>
            </select>
            <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Cantidad" style={{ flex: 1 }} />
          </div>
          <label className="field"><span>Motivo (conteo inicial, compra, rotura…)</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button className="btn primary" type="submit" disabled={pending || qty === "" || !reason.trim()}>Ajustar stock</button>
        </form>
        <form style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); run(() => adminAddPrice({ productId: p.id, validFrom: from, price: num(price), cost: num(cost) })); }}>
          <div className="row"><label className="field" style={{ flex: 1 }}><span>Precio ($)</span><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></label><label className="field" style={{ flex: 1 }}><span>Costo ($)</span><input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} /></label></div>
          <label className="field"><span>Rige desde</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <button className="btn" type="submit" disabled={pending}>Guardar precio</button>
        </form>
        <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); run(() => adminProductSettings({ productId: p.id, minStock: num(min) })); }}>
          <label className="field" style={{ flex: 1, margin: 0 }}><span>Avisar cuando queden (mínimo)</span><input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} /></label>
          <button className="btn" type="submit" disabled={pending}>Guardar</button>
        </form>
        <button className="btn danger" style={{ marginTop: 12 }} disabled={pending} onClick={() => run(() => adminProductSettings({ productId: p.id, active: !p.active }))}>{p.active ? "Dar de baja el producto" : "Reactivar el producto"}</button>
      </details>
      {toast}
    </li>
  );
}

export function ProductSection({ products }: { products: ProductView[] }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("BEBIDA");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("0");
  const [min, setMin] = useState("0");
  const { pending, run, toast } = useAction();
  return (
    <>
      <ul className="list card" style={{ padding: "4px 14px" }}>
        {products.map((p) => <ProductRowView key={p.id} p={p} />)}
      </ul>
      <details className="card" style={{ marginTop: 10 }}>
        <summary><b>+ Agregar un producto</b></summary>
        <form onSubmit={(e) => { e.preventDefault(); run(() => adminCreateProduct({ name, kind, price: num(price), cost: num(cost), stock: num(stock), minStock: num(min), validFrom: new Date().toISOString().slice(0, 10) }), () => { setName(""); setPrice(""); setCost(""); }); }}>
          <label className="field"><span>Nombre</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Tipo</span><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="BEBIDA">Bebida</option><option value="CERA">Cera</option><option value="POLVO">Polvo</option><option value="ACEITE">Aceite</option></select></label>
          <div className="row"><label className="field" style={{ flex: 1 }}><span>Precio ($)</span><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></label><label className="field" style={{ flex: 1 }}><span>Costo ($)</span><input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} /></label></div>
          <div className="row"><label className="field" style={{ flex: 1 }}><span>Stock actual</span><input inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} /></label><label className="field" style={{ flex: 1 }}><span>Avisar en</span><input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} /></label></div>
          <button className="btn primary" type="submit" disabled={pending || !name.trim() || num(price) <= 0}>Crear producto</button>
        </form>
      </details>
      {toast}
    </>
  );
}
