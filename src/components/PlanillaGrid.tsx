"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveChange, saveDeclared, saveMembershipCount, saveProductCount, saveServiceCount } from "../app/actions";
import { formatARS } from "../domain/money";
import { SERVICE_LABEL, SERVICE_TYPES } from "../domain/types";
import type { GridDayCol, MonthGrid } from "../services/grid";
import DayPanel from "./DayPanel";
import { useAction } from "./useAction";

const WD = ["D", "L", "M", "M", "J", "V", "S"];
const wd = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const dayNum = (date: string) => Number(date.slice(8, 10));
const fmt = (n: number) => (n === 0 ? "" : n.toLocaleString("es-AR"));

interface Viewer {
  id: string;
  isAdmin: boolean;
}

type RowDef =
  | { kind: "section"; key: string; label: string; hint?: string }
  | { kind: "input"; key: string; testId: string; label: string; get: (d: GridDayCol) => number; editable: (d: GridDayCol) => boolean; save: (d: GridDayCol, n: number) => ReturnType<typeof saveChange>; money?: boolean }
  | { kind: "calc"; key: string; label: string; get: (d: GridDayCol) => number | null; tone?: "strong" | "profit" | "diff"; sum?: boolean };

function NumberCell({ value, editable, onSave, money, cell }: { value: number; editable: boolean; onSave: (n: number) => void; money?: boolean; cell: string }) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => setText(value ? String(value) : ""), [value]);
  if (!editable) return <span className="cellro">{fmt(value)}</span>;
  return (
    <input
      className={`cell ${money ? "money" : ""}`}
      inputMode="numeric"
      size={1}
      data-cell={cell}
      aria-label="Cantidad"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={() => {
        const n = text === "" ? 0 : Number(text);
        if (n !== value) onSave(n);
      }}
    />
  );
}

export default function PlanillaGrid({ grid, viewer, prevMonth, nextMonth, monthLabel }: { grid: MonthGrid; viewer: Viewer; prevMonth: string; nextMonth: string; monthLabel: string }) {
  const { pending, run, toast } = useAction();
  const [selected, setSelected] = useState<string>(() => (grid.days.some((d) => d.date === grid.today) ? grid.today : (grid.days[0]?.date ?? grid.today)));
  const todayRef = useRef<HTMLTableCellElement | null>(null);

  useEffect(() => {
    todayRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [grid.month]);

  const dayEditable = (d: GridDayCol) => !d.closed && d.date <= grid.today && (viewer.isAdmin || d.date === grid.today);
  const barberName = (id: string) => grid.barbers.find((b) => b.id === id)?.name ?? "";

  const rows = useMemo<RowDef[]>(() => {
    const out: RowDef[] = [];
    for (const b of grid.barbers) {
      const mine = (d: GridDayCol) => dayEditable(d) && (viewer.isAdmin || b.id === viewer.id);
      out.push({ kind: "section", key: `s-${b.id}`, label: b.name + (b.active ? "" : " (ya no está)") });
      for (const t of SERVICE_TYPES) {
        out.push({
          kind: "input",
          key: `${b.id}-${t}`,
          testId: `${b.name}|${t}`,
          label: SERVICE_LABEL[t],
          get: (d) => d.services[b.id]?.[t] ?? 0,
          editable: mine,
          save: (d, n) => saveServiceCount({ date: d.date, userId: b.id, serviceType: t, count: n }),
        });
      }
      out.push({ kind: "input", key: `${b.id}-socio`, testId: `${b.name}|SOCIO`, label: "Socios (membresía)", get: (d) => d.memberships[b.id] ?? 0, editable: mine, save: (d, n) => saveMembershipCount({ date: d.date, userId: b.id, count: n }) });
      out.push({ kind: "calc", key: `${b.id}-gen`, label: "Generado", get: (d) => d.result.barbers.find((x) => x.userId === b.id)?.gross ?? 0, sum: true });
      out.push({ kind: "calc", key: `${b.id}-mo`, label: "Mano de obra", get: (d) => d.result.barbers.find((x) => x.userId === b.id)?.labor ?? 0, sum: true });
    }
    const drinks = grid.products.filter((p) => p.kind === "BEBIDA");
    const others = grid.products.filter((p) => p.kind !== "BEBIDA");
    const prodRow = (p: MonthGrid["products"][number]): RowDef => ({
      kind: "input", key: `p-${p.id}`, testId: `P|${p.name}`, label: p.name, get: (d) => d.products[p.id] ?? 0, editable: dayEditable, save: (d, n) => saveProductCount({ date: d.date, productId: p.id, count: n }),
    });
    if (drinks.length) out.push({ kind: "section", key: "s-bebidas", label: "Bebidas (sin corte)", hint: "cantidad vendida" }, ...drinks.map(prodRow));
    if (others.length) out.push({ kind: "section", key: "s-prod", label: "Ceras, polvo y aceite", hint: "cantidad vendida" }, ...others.map(prodRow));

    out.push({ kind: "section", key: "s-control", label: "Control del día" });
    out.push({ kind: "calc", key: "c-serv", label: "Ingresos por servicios", get: (d) => d.result.servicesGross, sum: true });
    out.push({ kind: "calc", key: "c-extra", label: "Bebidas, ceras y otros", get: (d) => d.result.drinksRevenue + d.result.productsRevenue, sum: true });
    out.push({ kind: "calc", key: "c-ing", label: "TOTAL INGRESOS", get: (d) => d.result.income, tone: "strong", sum: true });
    out.push({ kind: "calc", key: "c-mo", label: "Mano de obra", get: (d) => d.result.labor, sum: true });
    out.push({ kind: "calc", key: "c-debe", label: "Dinero que debe haber", get: (d) => d.result.expectedNet, tone: "strong", sum: true });
    out.push({ kind: "calc", key: "c-costos", label: "Costos (bebidas, ceras)", get: (d) => d.result.costs.total, sum: true });
    out.push({ kind: "calc", key: "c-ganancia", label: "GANANCIA DEL DÍA", get: (d) => d.result.profit.total, tone: "profit", sum: true });

    out.push({ kind: "section", key: "s-caja", label: "Dinero ingresado", hint: "en pesos" });
    for (const a of grid.accounts) {
      out.push({ kind: "input", key: `a-${a.key}`, testId: `A|${a.name}`, label: a.name, money: true, get: (d) => d.declared[a.key] ?? 0, editable: dayEditable, save: (d, n) => saveDeclared({ date: d.date, account: a.key, amount: n }) });
    }
    out.push({ kind: "calc", key: "a-total", label: "Total ingresado", get: (d) => d.totalDeclared, sum: true });
    out.push({ kind: "input", key: "a-cambio", testId: "A|CAMBIO", label: "Cambio dejado", money: true, get: (d) => d.changeLeft, editable: dayEditable, save: (d, n) => saveChange({ date: d.date, amount: n }) });
    out.push({ kind: "calc", key: "a-dif", label: "Diferencia de caja", get: (d) => d.difference, tone: "diff", sum: true });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, viewer.id, viewer.isAdmin]);

  const totals = useMemo(() => {
    const t = { income: 0, labor: 0, profit: 0, gaps: 0 };
    for (const d of grid.days) {
      t.income += d.result.income;
      t.labor += d.result.labor;
      t.profit += d.result.profit.total;
      if (d.difference !== null && d.difference !== 0) t.gaps++;
    }
    return t;
  }, [grid.days]);

  const selectedDay = grid.days.find((d) => d.date === selected);

  return (
    <>
      <div className="row spread" style={{ margin: "4px 0 8px" }}>
        <Link className="btn" href={`/?mes=${prevMonth}`} aria-label="Mes anterior">←</Link>
        <h1 style={{ textTransform: "capitalize" }}>{monthLabel}</h1>
        <Link className="btn" href={`/?mes=${nextMonth}`} aria-label="Mes siguiente">→</Link>
      </div>

      <div className="stats">
        <div className="card"><div className="muted">Ingresos del mes</div><div className="num big2">{formatARS(totals.income)}</div></div>
        <div className="card"><div className="muted">Mano de obra</div><div className="num big2">{formatARS(totals.labor)}</div></div>
        <div className="card"><div className="muted">Ganancia del mes</div><div className="num big2 okc">{formatARS(totals.profit)}</div></div>
      </div>
      {totals.gaps > 0 && <div className="alert WARN">Hay {totals.gaps} día{totals.gaps === 1 ? "" : "s"} con diferencia de caja este mes.</div>}
      <p className="muted" style={{ margin: "6px 0" }}>
        Escribí la <b>cantidad</b> y tocá afuera (o Enter) para guardar. Tocá el número del día para cerrarlo.{pending ? " Guardando…" : ""}
      </p>

      <div className="gridwrap" role="region" aria-label="Planilla del mes" tabIndex={0}>
        <table className="grid">
          <thead>
            <tr>
              <th className="sticky label">Día</th>
              {grid.days.map((d) => (
                <th
                  key={d.date}
                  ref={d.date === grid.today ? todayRef : undefined}
                  className={`day ${d.date === grid.today ? "today" : ""} ${d.date === selected ? "sel" : ""} ${d.date > grid.today ? "future" : ""}`}
                >
                  <button type="button" onClick={() => setSelected(d.date)} aria-label={`Día ${dayNum(d.date)}`}>
                    <span className="dn">{dayNum(d.date)}</span>
                    <span className="wd">{WD[wd(d.date)]}{d.closed ? " 🔒" : ""}</span>
                  </button>
                </th>
              ))}
              <th className="total">Mes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              if (r.kind === "section") {
                return (
                  <tr key={r.key} className="section">
                    <th className="sticky label" colSpan={1}>{r.label}{r.hint ? <span className="hint"> · {r.hint}</span> : null}</th>
                    <td colSpan={grid.days.length + 1} />
                  </tr>
                );
              }
              let sum = 0;
              const cells = grid.days.map((d) => {
                const v = r.get(d);
                if (v !== null) sum += v;
                const cls = `${d.date === grid.today ? "today" : ""} ${d.date === selected ? "sel" : ""} ${d.closed ? "closed" : ""}`;
                if (r.kind === "input") {
                  return (
                    <td key={d.date} className={cls}>
                      <NumberCell cell={`${r.testId}|${d.date}`} value={v ?? 0} editable={r.editable(d)} money={r.money} onSave={(n) => run(() => r.save(d, n))} />
                    </td>
                  );
                }
                const tone = r.tone === "diff" ? (v === null ? "" : v === 0 ? "okc" : "errc") : "";
                return (
                  <td key={d.date} data-calc={`${r.key}|${d.date}`} className={`calc ${cls} ${tone}`}>
                    {v === null ? "" : r.tone === "diff" && v === 0 ? "✓" : fmt(v)}
                  </td>
                );
              });
              const isCalc = r.kind === "calc";
              return (
                <tr key={r.key} className={`${isCalc ? "calcrow" : ""} ${isCalc && r.tone ? `tone-${r.tone}` : ""}`}>
                  <th className="sticky label">{r.label}</th>
                  {cells}
                  <td className="total">{r.kind === "input" || (r.kind === "calc" && r.sum) ? fmt(sum) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedDay && <DayPanel day={selectedDay} grid={grid} viewer={viewer} barberName={barberName} />}
      {toast}
    </>
  );
}
