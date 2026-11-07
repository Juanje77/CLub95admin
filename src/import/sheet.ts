import ExcelJS from "exceljs";

/** Valor "calculado" de una celda (resultado de la fórmula si la hay). */
export function cellValue(cell: ExcelJS.Cell): string | number | boolean | Date | null {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if ("result" in o) return (o.result as never) ?? null;
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
    return null;
  }
  return v as string | number | boolean | Date;
}

export function num(ws: ExcelJS.Worksheet, row: number, col: number): number {
  const v = cellValue(ws.getCell(row, col));
  return typeof v === "number" ? v : 0;
}

export function str(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v = cellValue(ws.getCell(row, col));
  return v === null ? "" : String(v).trim();
}

export function isoDate(d: Date): string {
  // Las fechas de Excel vienen a medianoche UTC.
  return d.toISOString().slice(0, 10);
}

export async function openWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

export function colLetter(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
