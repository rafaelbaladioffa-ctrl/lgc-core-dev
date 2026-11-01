const TIME_ZONE = 'America/Sao_Paulo';

/** DD/MM/AAAA, America/Sao_Paulo (PLANNING.md 1.1). Accepts an ISO string, Date, or nullish. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', { timeZone: TIME_ZONE });
}

/** DD/MM/AAAA HH:mm (24h), America/Sao_Paulo (PLANNING.md 1.1). Accepts an ISO string, Date, or nullish. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const datePart = date.toLocaleDateString('pt-BR', { timeZone: TIME_ZONE });
  const timePart = date.toLocaleTimeString('pt-BR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
  return `${datePart} ${timePart}`;
}
