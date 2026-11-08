/**
 * Exportação CSV no padrão do ERP: separador ";", BOM UTF-8 (abre direto no
 * Excel pt-BR com acentos), todas as células entre aspas e proteção contra
 * injeção de fórmula. Números são formatados no idioma informado (vírgula
 * decimal em pt-BR / es-ES), sem separador de milhar.
 */

export type CsvCell = string | number | boolean | null | undefined;

/** Prefixa com apóstrofo textos que o Excel interpretaria como fórmula. */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function formatCell(cell: CsvCell, numberFormat: Intl.NumberFormat | null): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return "";
    // Números não passam pela neutralização (um "-0,5" é número, não fórmula).
    return numberFormat ? numberFormat.format(cell) : String(cell);
  }
  return neutralizeFormula(String(cell));
}

export function buildCsv(rows: CsvCell[][], locale?: string): string {
  const numberFormat = locale
    ? new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 4 })
    : null;
  return rows
    .map((row) => row.map((cell) => `"${formatCell(cell, numberFormat).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
}

export function downloadCsv(filename: string, rows: CsvCell[][], locale?: string) {
  const csv = buildCsv(rows, locale);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
