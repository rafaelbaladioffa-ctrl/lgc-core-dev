/** Formatação padrão do Axis: pt-BR, fuso America/Sao_Paulo. */
const TZ = 'America/Sao_Paulo';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Valor monetário vindo da API como texto decimal ("1234.56") ou número. */
export function formatBRL(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? brl.format(n) : '—';
}

/** Data de negócio (aaaa-mm-dd) sem deslocar o dia pelo fuso; instantes ISO são convertidos para São Paulo. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const only = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (only) return `${only[3]}/${only[2]}/${only[1]}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : date.format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateTime.format(d).replace(',', '');
}
