/**
 * Datas no fuso do Brasil (UTC−3 fixo, sem horário de verão desde 2019).
 *
 * Regra do projeto: nunca usar pacote de timezone e nunca usar
 * `toISOString()` para obter "a data de hoje" — ele devolve a data em UTC,
 * que já é o dia seguinte a partir das 21h em Brasília.
 */

const BRAZIL_OFFSET_MS = 3 * 60 * 60 * 1000;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Formata um Date como YYYY-MM-DD usando os componentes LOCAIS do objeto
 *  (ano/mês/dia do navegador), sem conversão para UTC. */
export function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Converte YYYY-MM-DD em Date local à meia-noite. */
export function fromIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Data de hoje no Brasil (UTC−3), em YYYY-MM-DD, independente do fuso do navegador. */
export function brazilTodayIso(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - BRAZIL_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Soma (ou subtrai) dias a uma data YYYY-MM-DD. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Data de N dias atrás no Brasil (UTC−3), em YYYY-MM-DD. */
export function brazilDaysAgoIso(days: number, now: Date = new Date()): string {
  return addDaysIso(brazilTodayIso(now), -days);
}

/** Número de dias do intervalo, contando as duas pontas. */
export function daysInclusive(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split("-").map(Number);
  const [y2, m2, d2] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

/** Hora (HH:mm) de um timestamp ISO, no horário do Brasil (UTC−3). */
export function formatBrazilClock(iso: string, locale: string): string {
  const shifted = new Date(new Date(iso).getTime() - BRAZIL_OFFSET_MS);
  return shifted.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

/** Data YYYY-MM-DD formatada com as opções dadas, sem deslocamento de fuso. */
export function formatIsoDate(iso: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { ...options, timeZone: "UTC" });
}
