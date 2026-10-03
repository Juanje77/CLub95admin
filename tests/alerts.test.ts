import { describe, expect, it } from "vitest";
import { alertsFor, computeCloseAlerts, minutesBA, type DayState } from "../src/domain/alerts";

// 2026-10-03 es sábado. 20:45 en Buenos Aires = 23:45 UTC.
const SAT_EVENING = new Date("2026-10-03T23:45:00Z");
const SAT_AFTERNOON = new Date("2026-10-03T18:00:00Z"); // 15:00 BA

const closed = (date: string, over: Partial<NonNullable<DayState["close"]>> = {}): DayState => ({
  date,
  salesCount: 10,
  unpaidSales: 0,
  close: { status: "CLOSED", difference: 0, note: null, changeLeft: 8000, declaredCash: 10000, declaredTransfers: 190000, closedOn: date, reopened: false, ...over },
});
const open = (date: string, over: Partial<DayState> = {}): DayState => ({ date, salesCount: 10, unpaidSales: 0, close: null, ...over });
const codes = (a: { code: string }[]) => a.map((x) => x.code);

describe("hora de Buenos Aires", () => {
  it("convierte UTC a minutos locales", () => {
    expect(minutesBA(SAT_EVENING)).toBe(20 * 60 + 45);
    expect(minutesBA(SAT_AFTERNOON)).toBe(15 * 60);
  });
});

describe("alertas de cierre diario", () => {
  it("sin alertas cuando todo está cerrado y cuadra", () => {
    const a = computeCloseAlerts({ now: SAT_EVENING, days: [closed("2026-10-02"), closed("2026-10-03")], closedDays: [], box: [], settlements: [] });
    expect(a).toEqual([]);
  });

  it("hoy sin cerrar: avisa recién pasada la hora configurada", () => {
    const before = computeCloseAlerts({ now: SAT_AFTERNOON, days: [open("2026-10-03")], closedDays: [], box: [], settlements: [] });
    expect(before).toEqual([]);
    const after = computeCloseAlerts({ now: SAT_EVENING, days: [open("2026-10-03")], closedDays: [], box: [], settlements: [] });
    expect(codes(after)).toEqual(["CIERRE_PENDIENTE_HOY"]);
    expect(after[0]!.audience).toEqual(["BARBERO", "ADMIN"]);
  });

  it("la hora de aviso es configurable", () => {
    const a = computeCloseAlerts({ now: SAT_AFTERNOON, days: [open("2026-10-03")], closedDays: [], box: [], settlements: [], settings: { closeReminderTime: "14:00" } });
    expect(codes(a)).toEqual(["CIERRE_PENDIENTE_HOY"]);
  });

  it("día anterior sin cerrar es error y escala al dueño a los 2 días", () => {
    const a = computeCloseAlerts({ now: SAT_EVENING, days: [open("2026-10-02"), open("2026-10-01")], closedDays: [], box: [], settlements: [] });
    const byDate = Object.fromEntries(a.map((x) => [x.date, x]));
    expect(byDate["2026-10-02"]!.severity).toBe("ERROR");
    expect(byDate["2026-10-02"]!.audience).toEqual(["BARBERO", "ADMIN"]);
    expect(byDate["2026-10-01"]!.audience).toContain("DUENO");
    expect(byDate["2026-10-01"]!.message).toContain("hace 2 días");
  });

  it("día de apertura obligatoria sin ventas ni cierre: pregunta si abrieron", () => {
    const a = computeCloseAlerts({ now: SAT_EVENING, days: [open("2026-10-01", { salesCount: 0 })], closedDays: [], box: [], settlements: [] });
    expect(codes(a)).toEqual(["DIA_SIN_MOVIMIENTO"]); // jueves
  });

  it("lunes y domingo sin movimiento no alertan; marcar el día como cerrado lo silencia", () => {
    const none = computeCloseAlerts({ now: SAT_EVENING, days: [open("2026-09-28", { salesCount: 0 }), open("2026-09-27", { salesCount: 0 })], closedDays: [], box: [], settlements: [] });
    expect(none).toEqual([]);
    const silenced = computeCloseAlerts({ now: SAT_EVENING, days: [open("2026-10-01", { salesCount: 0 })], closedDays: ["2026-10-01"], box: [], settlements: [] });
    expect(silenced).toEqual([]);
  });

  it("los días anteriores a la fecha de arranque no alertan", () => {
    const days = [open("2026-09-29", { salesCount: 0 }), open("2026-09-30", { salesCount: 0 }), open("2026-10-01", { salesCount: 0 })];
    const a = computeCloseAlerts({ now: SAT_EVENING, days, closedDays: [], box: [], settlements: [], settings: { startDate: "2026-10-01" } });
    expect(a.map((x) => x.date)).toEqual(["2026-10-01"]);
  });

  it("un lunes con ventas y sin cierre sí alerta", () => {
    const a = computeCloseAlerts({ now: SAT_EVENING, days: [open("2026-09-28")], closedDays: [], box: [], settlements: [] });
    expect(codes(a)).toEqual(["CIERRE_ATRASADO"]);
  });

  it("ventas sin medio de pago", () => {
    const a = computeCloseAlerts({ now: SAT_AFTERNOON, days: [open("2026-10-03", { unpaidSales: 3 })], closedDays: [], box: [], settlements: [] });
    expect(codes(a)).toEqual(["VENTAS_SIN_MEDIO_DE_PAGO"]);
  });

  it("caja reabierta sin volver a cerrar", () => {
    const d = open("2026-10-02", { close: { status: "OPEN", difference: 0, note: null, changeLeft: 0, declaredCash: 0, declaredTransfers: 0, closedOn: null, reopened: true } });
    const a = computeCloseAlerts({ now: SAT_EVENING, days: [d], closedDays: [], box: [], settlements: [] });
    expect(codes(a)).toContain("CIERRE_REABIERTO");
  });

  it("descuadre: aviso chico, error grande, y error extra si falta la nota", () => {
    const small = computeCloseAlerts({ now: SAT_EVENING, days: [closed("2026-10-02", { difference: -2000, note: "Falta una propina" })], closedDays: [], box: [], settlements: [] });
    expect(small.map((x) => [x.code, x.severity])).toEqual([["CIERRE_CON_DESCUADRE", "WARN"]]);
    const big = computeCloseAlerts({ now: SAT_EVENING, days: [closed("2026-10-02", { difference: -91800 })], closedDays: [], box: [], settlements: [] });
    expect(big.map((x) => [x.code, x.severity])).toEqual([
      ["CIERRE_CON_DESCUADRE", "ERROR"],
      ["DESCUADRE_SIN_NOTA", "ERROR"],
    ]);
    expect(big[0]!.message).toContain("faltante de $ 91.800");
  });

  it("sobrante también se informa", () => {
    const a = computeCloseAlerts({ now: SAT_EVENING, days: [closed("2026-10-02", { difference: 2050, note: "x" })], closedDays: [], box: [], settlements: [] });
    expect(a[0]!.message).toContain("sobrante de $ 2.050");
  });

  it("cierre tardío es informativo", () => {
    const a = computeCamp(closed("2026-10-01", { closedOn: "2026-10-03" }));
    expect(a.map((x) => [x.code, x.severity])).toEqual([["CIERRE_TARDIO", "INFO"]]);
  });

  it("poco cambio solo se avisa en el último cierre", () => {
    const a = computeCloseAlerts({ now: SAT_EVENING, days: [closed("2026-10-01", { changeLeft: 100 }), closed("2026-10-02", { changeLeft: 100 })], closedDays: [], box: [], settlements: [] });
    expect(a.map((x) => x.date)).toEqual(["2026-10-02"]);
    expect(codes(a)).toEqual(["CAMBIO_INSUFICIENTE"]);
  });

  it("mucho efectivo, dado que casi todo es transferencia", () => {
    const a = computeCloseAlerts({ now: SAT_EVENING, days: [closed("2026-10-02", { declaredCash: 120000, declaredTransfers: 80000 })], closedDays: [], box: [], settlements: [] });
    expect(codes(a)).toEqual(["EFECTIVO_ALTO"]);
    const small = computeCloseAlerts({ now: SAT_EVENING, days: [closed("2026-10-02", { declaredCash: 20000, declaredTransfers: 10000 })], closedDays: [], box: [], settlements: [] });
    expect(small).toEqual([]); // cobrado menor al mínimo para evaluar
  });
});

describe("alertas de la fila de efectivo y la compensación", () => {
  const base = { now: SAT_EVENING, days: [] as DayState[], closedDays: [] as string[], settlements: [] };

  it("rendir cuando pasan 7 días", () => {
    const box = [{ date: "2026-09-26", kind: "CIERRE" as const, amount: 30000 }];
    expect(codes(computeCloseAlerts({ ...base, box }))).toEqual(["RENDICION_ATRASADA"]);
    const recent = [{ date: "2026-09-30", kind: "CIERRE" as const, amount: 30000 }];
    expect(computeCloseAlerts({ ...base, box: recent })).toEqual([]);
  });

  it("saldo alto", () => {
    const box = [{ date: "2026-10-02", kind: "CIERRE" as const, amount: 250000 }];
    expect(codes(computeCloseAlerts({ ...base, box }))).toEqual(["EFECTIVO_ACUMULADO_ALTO"]);
  });

  it("saldo negativo", () => {
    const box = [{ date: "2026-10-02", kind: "CIERRE" as const, amount: 10000 }, { date: "2026-10-03", kind: "RETIRO_BARBERO" as const, amount: -15000 }];
    expect(codes(computeCloseAlerts({ ...base, box }))).toContain("CAJA_EFECTIVO_NEGATIVA");
  });

  it("rendición con diferencia", () => {
    const box = [
      { id: "r1", date: "2026-10-02", kind: "CIERRE" as const, amount: 45000 },
      { id: "r2", date: "2026-10-03", kind: "RENDICION" as const, amount: -40000, expectedAmount: 45000 },
    ];
    const a = computeCloseAlerts({ ...base, box });
    expect(a.find((x) => x.code === "RENDICION_CON_DIFERENCIA")!.message).toContain("faltan $ 5.000");
  });

  it("una rendición completa no alerta", () => {
    const box = [
      { id: "r1", date: "2026-10-02", kind: "CIERRE" as const, amount: 45000 },
      { id: "r2", date: "2026-10-03", kind: "RENDICION" as const, amount: -45000, expectedAmount: 45000 },
    ];
    expect(computeCloseAlerts({ ...base, box })).toEqual([]);
  });

  it("compensación del mes anterior pendiente: aviso y error desde el día 10", () => {
    const settlements = [{ period: "2026-09", userId: "u1", name: "Lucio", status: "DRAFT" as const }];
    const early = computeCloseAlerts({ ...base, box: [], settlements });
    expect(early.map((x) => [x.code, x.severity])).toEqual([["LIQUIDACION_PENDIENTE", "WARN"]]);
    const late = computeCloseAlerts({ ...base, now: new Date("2026-10-12T15:00:00Z"), box: [], settlements });
    expect(late[0]!.severity).toBe("ERROR");
    const done = computeCloseAlerts({ ...base, box: [], settlements: [{ ...settlements[0]!, status: "CONFIRMED" }] });
    expect(done).toEqual([]);
    const currentMonth = computeCloseAlerts({ ...base, box: [], settlements: [{ ...settlements[0]!, period: "2026-10" }] });
    expect(currentMonth).toEqual([]);
  });

  it("alertsFor filtra por rol", () => {
    const box = [{ date: "2026-09-26", kind: "CIERRE" as const, amount: 30000 }];
    const a = computeCloseAlerts({ ...base, box, days: [open("2026-10-02")] });
    expect(codes(alertsFor(a, "BARBERO"))).toEqual(["CIERRE_ATRASADO"]);
    expect(codes(alertsFor(a, "DUENO"))).toEqual(["RENDICION_ATRASADA"]);
  });

  it("ordena primero los errores", () => {
    const a = computeCloseAlerts({ ...base, box: [{ date: "2026-09-26", kind: "CIERRE", amount: 30000 }], days: [open("2026-10-02")] });
    expect(a.map((x) => x.severity)).toEqual(["ERROR", "WARN"]);
  });
});

function computeCamp(d: DayState) {
  return computeCloseAlerts({ now: SAT_EVENING, days: [d], closedDays: [], box: [], settlements: [] });
}
