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

/** Data de calendário `AAAA-MM-DD` (coluna `DATE`) → DD/MM/AAAA, sem conversão de fuso (meia-noite UTC
 * convertida para São Paulo cairia no dia anterior). Aceita também ISO completo, usando só a data. */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}
