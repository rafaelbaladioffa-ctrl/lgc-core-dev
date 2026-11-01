/** Data de calendário (AAAA-MM-DD) em America/Sao_Paulo, o mesmo fuso de fmtDateTime. Evita que após 21h (BRT) "hoje" vire o dia seguinte em UTC. */
export function todaySaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Datas do tipo DATE chegam como "AAAA-MM-DDT00:00:00.000Z": só o dia importa. Sem valor vira '—'. */
export const dateBr = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
