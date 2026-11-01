/** Padrões brasileiros (PLANNING.md 1.1): DD/MM/AAAA HH:mm em America/Sao_Paulo, números com vírgula. */
export const fmtDateTime = (iso?: string | Date | null) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')
    : '—';

export const fmtQty = (v: string | number, max = 6) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: max });

/** Aceita "1,5", "1.5" e "1.234,5"; vazio ou inválido vira null (nunca zero). */
export function parseQty(text: string): number | null {
  let t = text.trim();
  if (t === '') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
