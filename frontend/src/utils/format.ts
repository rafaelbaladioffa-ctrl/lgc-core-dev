const BR_LOCALE = 'pt-BR';

export function formatBRL(value: number | string | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat(BR_LOCALE, { style: 'currency', currency: 'BRL' }).format(numeric);
}

export function formatNumberBR(value: number | string | null | undefined, maximumFractionDigits = 2): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat(BR_LOCALE, { maximumFractionDigits }).format(numeric);
}

export function formatPercentBR(value: number | string | null | undefined, maximumFractionDigits = 2): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat(BR_LOCALE, { style: 'percent', maximumFractionDigits }).format(numeric > 1 ? numeric / 100 : numeric);
}
