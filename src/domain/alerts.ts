import { boxBalance, daysBetween, lastRendicionDate, type BoxEntry } from "./cashbox";
import { formatARS, formatDate, todayBA } from "./money";
import type { Role } from "./types";

export type AlertSeverity = "INFO" | "WARN" | "ERROR";

export type AlertCode =
  | "CIERRE_PENDIENTE_HOY"
  | "CIERRE_ATRASADO"
  | "DIA_SIN_MOVIMIENTO"
  | "VENTAS_SIN_MEDIO_DE_PAGO"
  | "CIERRE_REABIERTO"
  | "CIERRE_CON_DESCUADRE"
  | "DESCUADRE_SIN_NOTA"
  | "CIERRE_TARDIO"
  | "CAMBIO_INSUFICIENTE"
  | "EFECTIVO_ALTO"
  | "CAJA_EFECTIVO_NEGATIVA"
  | "EFECTIVO_ACUMULADO_ALTO"
  | "RENDICION_ATRASADA"
  | "RENDICION_CON_DIFERENCIA"
  | "RETIRO_EFECTIVO_EXCEDE"
  | "STOCK_BAJO"
  | "LIQUIDACION_PENDIENTE";

export interface CloseAlert {
  /** Clave estable: la misma situación genera siempre la misma clave (no se duplican alertas). */
  key: string;
  code: AlertCode;
  severity: AlertSeverity;
  audience: Role[];
  date?: string;
  message: string;
}

export interface AlertSettings {
  /** Hora (Buenos Aires, HH:MM) a partir de la cual se avisa que falta cerrar el día. */
  closeReminderTime: string;
  /** Días en que el local abre siempre (0 = domingo … 6 = sábado). Sin cierre en uno de estos = alerta. */
  requiredDays: number[];
  /** A partir de qué diferencia (en $) el descuadre pasa de aviso a error. */
  descuadreErrorThreshold: number;
  /** Cambio mínimo que debe quedar en la caja. */
  minChange: number;
  /** Saldo de efectivo acumulado a partir del cual hay que rendir. */
  boxMaxBalance: number;
  /** Días máximos sin rendir efectivo al dueño. */
  boxMaxDays: number;
  /** Proporción de efectivo (sobre lo cobrado) que se considera inusual, dado que casi todo se paga por transferencia. */
  cashShareWarn: number;
  /** Cobrado mínimo del día para evaluar la proporción de efectivo. */
  cashShareMinTotal: number;
  /** Día del mes desde el cual la liquidación pendiente del mes anterior pasa de aviso a error. */
  settlementErrorDay: number;
  /** Primer día que se controla (fecha de arranque del sistema). Los días anteriores no generan alertas. */
  startDate: string | null;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  closeReminderTime: "20:30",
  requiredDays: [2, 3, 4, 5, 6], // martes a sábado; lunes a veces, domingo nunca
  descuadreErrorThreshold: 5000,
  minChange: 5000,
  boxMaxBalance: 200000,
  boxMaxDays: 7,
  cashShareWarn: 0.5,
  cashShareMinTotal: 50000,
  settlementErrorDay: 10,
  startDate: null,
};

export interface DayState {
  date: string;
  /** Efectivo retirado por barberos por encima de lo que el banco no cubrió ese día. */
  withdrawalExcess?: { name: string; amount: number; cashAllowed: number; cashWithdrawn: number }[];
  salesCount: number;
  /** Ventas sin medio de pago. */
  unpaidSales: number;
  close: {
    status: "OPEN" | "CLOSED";
    difference: number;
    note: string | null;
    changeLeft: number;
    declaredCash: number;
    declaredTransfers: number;
    /** Fecha (Buenos Aires) en que se cerró. */
    closedOn: string | null;
    reopened: boolean;
  } | null;
}

export interface RendicionState extends BoxEntry {
  id: string;
}

export interface SettlementState {
  period: string; // YYYY-MM
  userId: string;
  name: string;
  status: "DRAFT" | "CONFIRMED" | null; // null = todavía no se generó
}

export interface AlertInput {
  now: Date;
  /** Días a evaluar (típicamente los últimos 14 días hasta hoy). */
  days: DayState[];
  /** Fechas marcadas como "no abrió". */
  closedDays: string[];
  /** Filas vigentes de la caja de efectivo. */
  box: (BoxEntry & { id?: string })[];
  settlements: SettlementState[];
  /** Productos activos con stock en el mínimo o por debajo (se calcula en el servicio). */
  lowStock?: { name: string; stock: number; minStock: number }[];
  settings?: Partial<AlertSettings>;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function dayLabel(date: string): string {
  return `${WEEKDAYS[weekdayOf(date)]} ${formatDate(date).slice(0, 5)}`;
}

/** Minutos desde medianoche, hora de Buenos Aires. */
export function minutesBA(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const SEV_ORDER: Record<AlertSeverity, number> = { ERROR: 0, WARN: 1, INFO: 2 };

/**
 * Todas las alertas que hacen falta para que la caja se cierre todos los días.
 * Es una función pura: el estado entra por parámetro y se puede probar sin base de datos.
 */
export function computeCloseAlerts(input: AlertInput): CloseAlert[] {
  const s: AlertSettings = { ...DEFAULT_ALERT_SETTINGS, ...input.settings };
  const today = todayBA(input.now);
  const nowMin = minutesBA(input.now);
  const closedDays = new Set(input.closedDays);
  const out: CloseAlert[] = [];
  const add = (a: CloseAlert) => out.push(a);

  const days = [...input.days].filter((d) => d.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const lastClosedDate = [...days].reverse().find((d) => d.close?.status === "CLOSED")?.date;

  for (const d of days) {
    if (closedDays.has(d.date)) continue;
    if (s.startDate && d.date < s.startDate) continue;
    const hasSales = d.salesCount > 0;
    const closed = d.close?.status === "CLOSED";
    const label = dayLabel(d.date);

    for (const w of d.withdrawalExcess ?? []) {
      add({
        key: `RETIRO_EFECTIVO_EXCEDE:${d.date}:${w.name}`, code: "RETIRO_EFECTIVO_EXCEDE", severity: "WARN", audience: ["ADMIN", "DUENO"], date: d.date,
        message: `${label}: ${w.name} retiró ${formatARS(w.cashWithdrawn)} en efectivo y el banco cubría su parte (podía retirar ${formatARS(w.cashAllowed)}): ${formatARS(w.amount)} fuera de la regla.`,
      });
    }

    if (hasSales && d.unpaidSales > 0 && !closed) {
      add({
        key: `VENTAS_SIN_MEDIO_DE_PAGO:${d.date}`, code: "VENTAS_SIN_MEDIO_DE_PAGO", severity: "WARN", audience: ["BARBERO", "ADMIN"], date: d.date,
        message: `${label}: ${d.unpaidSales} venta(s) sin medio de pago. Sin eso no se puede cerrar la caja.`,
      });
    }

    if (!closed) {
      if (d.close?.reopened) {
        add({
          key: `CIERRE_REABIERTO:${d.date}`, code: "CIERRE_REABIERTO", severity: "WARN", audience: ["BARBERO", "ADMIN", "DUENO"], date: d.date,
          message: `${label}: la caja fue reabierta y todavía no se volvió a cerrar.`,
        });
      }
      if (d.date === today) {
        if (hasSales && nowMin >= parseHHMM(s.closeReminderTime)) {
          add({
            key: `CIERRE_PENDIENTE_HOY:${d.date}`, code: "CIERRE_PENDIENTE_HOY", severity: "WARN", audience: ["BARBERO", "ADMIN"], date: d.date,
            message: `Falta cerrar la caja de hoy (${label}). Declará efectivo, transferencias y cambio dejado.`,
          });
        }
        continue;
      }
      const late = daysBetween(d.date, today);
      const audience: Role[] = late >= 2 ? ["BARBERO", "ADMIN", "DUENO"] : ["BARBERO", "ADMIN"];
      if (hasSales) {
        add({
          key: `CIERRE_ATRASADO:${d.date}`, code: "CIERRE_ATRASADO", severity: "ERROR", audience, date: d.date,
          message: `${label}: la caja quedó sin cerrar hace ${late} día${late === 1 ? "" : "s"}. Hay que cerrarla (un barbero necesita permiso del admin para cerrar días pasados).`,
        });
      } else if (s.requiredDays.includes(weekdayOf(d.date)) && !d.close) {
        add({
          key: `DIA_SIN_MOVIMIENTO:${d.date}`, code: "DIA_SIN_MOVIMIENTO", severity: "WARN", audience: late >= 2 ? ["ADMIN", "DUENO"] : ["ADMIN"], date: d.date,
          message: `${label}: no hay ventas ni cierre. Si abrieron, cargá las ventas y cerrá la caja; si no abrieron, marcá el día como cerrado.`,
        });
      }
      continue;
    }

    // --- Día cerrado ---
    const c = d.close!;
    if (c.difference !== 0) {
      const big = Math.abs(c.difference) >= s.descuadreErrorThreshold;
      add({
        key: `CIERRE_CON_DESCUADRE:${d.date}`, code: "CIERRE_CON_DESCUADRE", severity: big ? "ERROR" : "WARN", audience: ["ADMIN", "DUENO"], date: d.date,
        message: `${label}: la caja cerró con ${c.difference < 0 ? "faltante" : "sobrante"} de ${formatARS(Math.abs(c.difference))}.${c.note ? ` Nota: ${c.note}` : ""}`,
      });
      if (!(c.note ?? "").trim()) {
        add({
          key: `DESCUADRE_SIN_NOTA:${d.date}`, code: "DESCUADRE_SIN_NOTA", severity: "ERROR", audience: ["ADMIN", "DUENO"], date: d.date,
          message: `${label}: hay diferencia de caja y no se dejó nota explicando el motivo.`,
        });
      }
    }
    if (c.closedOn && c.closedOn > d.date) {
      add({
        key: `CIERRE_TARDIO:${d.date}`, code: "CIERRE_TARDIO", severity: "INFO", audience: ["ADMIN", "DUENO"], date: d.date,
        message: `${label}: se cerró recién el ${formatDate(c.closedOn)}.`,
      });
    }
    if (d.date === lastClosedDate && c.changeLeft < s.minChange) {
      add({
        key: `CAMBIO_INSUFICIENTE:${d.date}`, code: "CAMBIO_INSUFICIENTE", severity: "WARN", audience: ["BARBERO", "ADMIN"], date: d.date,
        message: `${label}: quedó poco cambio en la caja (${formatARS(c.changeLeft)}; mínimo ${formatARS(s.minChange)}).`,
      });
    }
    const collected = c.declaredCash + c.declaredTransfers;
    if (collected >= s.cashShareMinTotal && c.declaredCash / collected >= s.cashShareWarn) {
      add({
        key: `EFECTIVO_ALTO:${d.date}`, code: "EFECTIVO_ALTO", severity: "INFO", audience: ["ADMIN"], date: d.date,
        message: `${label}: el ${Math.round((c.declaredCash / collected) * 100)}% de lo cobrado fue en efectivo (${formatARS(c.declaredCash)}); casi todo se paga por transferencia, conviene revisar que no falte cargar alguna.`,
      });
    }
  }

  // --- Fila de efectivo acumulado ---
  const balance = boxBalance(input.box);
  if (input.box.length > 0) {
    if (balance < 0) {
      add({
        key: "CAJA_EFECTIVO_NEGATIVA", code: "CAJA_EFECTIVO_NEGATIVA", severity: "ERROR", audience: ["ADMIN", "DUENO"],
        message: `El efectivo acumulado dio negativo (${formatARS(balance)}): se retiró o rindió más de lo que entró. Revisá retiros y rendiciones.`,
      });
    }
    if (balance >= s.boxMaxBalance) {
      add({
        key: "EFECTIVO_ACUMULADO_ALTO", code: "EFECTIVO_ACUMULADO_ALTO", severity: "WARN", audience: ["ADMIN", "DUENO"],
        message: `Hay ${formatARS(balance)} de efectivo acumulado (límite ${formatARS(s.boxMaxBalance)}): conviene rendirlo.`,
      });
    }
    const since = lastRendicionDate(input.box) ?? [...input.box].map((e) => e.date).sort()[0]!;
    const sinceDays = daysBetween(since, today);
    if (balance > 0 && sinceDays >= s.boxMaxDays) {
      add({
        key: "RENDICION_ATRASADA", code: "RENDICION_ATRASADA", severity: "WARN", audience: ["ADMIN", "DUENO"],
        message: `Hace ${sinceDays} días que no se rinde el efectivo (acumulado ${formatARS(balance)}).`,
      });
    }
    for (const e of input.box) {
      if (e.kind === "RENDICION" && e.expectedAmount != null && e.expectedAmount !== -e.amount && daysBetween(e.date, today) <= 30) {
        const diff = -e.amount - e.expectedAmount;
        add({
          key: `RENDICION_CON_DIFERENCIA:${e.date}:${e.id ?? e.amount}`, code: "RENDICION_CON_DIFERENCIA", severity: "ERROR", audience: ["ADMIN", "DUENO"], date: e.date,
          message: `Rendición del ${formatDate(e.date)}: se entregaron ${formatARS(-e.amount)} y debía haber ${formatARS(e.expectedAmount)} (${diff < 0 ? "faltan" : "sobran"} ${formatARS(Math.abs(diff))}).`,
        });
      }
    }
  }

  // --- Stock ---
  for (const p of input.lowStock ?? []) {
    add({
      key: `STOCK_BAJO:${p.name}`, code: "STOCK_BAJO", severity: "WARN", audience: ["ADMIN", "DUENO"],
      message: `${p.name}: quedan ${p.stock} (mínimo ${p.minStock}). Hay que reponer.`,
    });
  }

  // --- Compensación de fin de mes ---
  const currentPeriod = today.slice(0, 7);
  const dayOfMonth = Number(today.slice(8, 10));
  for (const st of input.settlements) {
    if (st.period >= currentPeriod || st.status === "CONFIRMED") continue;
    add({
      key: `LIQUIDACION_PENDIENTE:${st.period}:${st.userId}`, code: "LIQUIDACION_PENDIENTE",
      severity: dayOfMonth >= s.settlementErrorDay ? "ERROR" : "WARN", audience: ["ADMIN", "DUENO"],
      message: `Falta confirmar la compensación de ${st.period} de ${st.name} (membresías contra lo que ya cobró).`,
    });
  }

  return out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.date ?? "").localeCompare(b.date ?? "") || a.key.localeCompare(b.key));
}

export function alertsFor(alerts: CloseAlert[], role: Role): CloseAlert[] {
  return alerts.filter((a) => a.audience.includes(role));
}
