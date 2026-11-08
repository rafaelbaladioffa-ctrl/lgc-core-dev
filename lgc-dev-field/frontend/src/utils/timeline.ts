import type { PairPartner, TimelineBlock } from "../api/types";

export const PRESENCE_COLOR: Record<string, string> = {
  not_started: "var(--text-faint)",
  available: "var(--green)",
  in_progress: "var(--amber)",
  lunch: "var(--purple)",
  personal: "var(--blue)",
  meal: "var(--teal)",
  meeting: "var(--pink)",
  traveling: "var(--cyan)",
  support: "var(--lime)",
  site_blocked: "var(--red)",
  awaiting_release: "var(--orange)",
  off_duty: "var(--text-faint)",
  on_leave: "var(--purple)",
};

export const BUSY_COLOR: Record<string, string> = {
  in_progress: "var(--amber)",
  paused: "var(--orange)",
};

export const DONE_COLOR = "var(--blue)";

export const PRESENCE_LABEL: Record<string, string> = {
  not_started: "Indisponível",
  available: "Disponível",
  in_progress: "Em Execução",
  lunch: "Horário de Almoço",
  personal: "Particular",
  meal: "Café",
  meeting: "Reunião",
  traveling: "Em Deslocamento",
  support: "Apoio a outro técnico",
  site_blocked: "Sem Acesso ao Site",
  awaiting_release: "Aguardando Liberações",
  off_duty: "Fim de Expediente",
};

const PRESENCE_LABELS_I18N: Record<string, Record<string, string>> = {
  "pt-BR": PRESENCE_LABEL,
  "en-US": {
    not_started: "Unavailable",
    available: "Available",
    in_progress: "In Progress",
    lunch: "Lunch Break",
    personal: "Personal",
    meal: "Coffee Break",
    meeting: "Meeting",
    traveling: "Traveling",
    support: "Supporting another technician",
    site_blocked: "No Site Access",
    awaiting_release: "Awaiting Release",
    off_duty: "Off Duty",
  },
  "es-ES": {
    not_started: "No disponible",
    available: "Disponible",
    in_progress: "En ejecución",
    lunch: "Descanso / Almuerzo",
    personal: "Personal",
    meal: "Café",
    meeting: "Reunión",
    traveling: "En desplazamiento",
    support: "Apoyo a otro técnico",
    site_blocked: "Sin acceso al site",
    awaiting_release: "Esperando liberaciones",
    off_duty: "Fuera de turno",
  },
};

const EM_PAUSA_I18N: Record<string, string> = {
  "pt-BR": "Em pausa",
  "en-US": "Paused",
  "es-ES": "En pausa",
};

export function presenceLabel(status: string, locale: string, fallback?: string): string {
  return (PRESENCE_LABELS_I18N[locale] ?? PRESENCE_LABEL)[status] ?? fallback ?? status;
}

export function emPausaLabel(locale: string): string {
  return EM_PAUSA_I18N[locale] ?? "Em pausa";
}

// Status que "explicam" uma pausa — se o técnico pausou uma tarefa e trocou
// pra um desses, a barra da pausa reflete o motivo em vez do genérico "Em pausa".
export const AWAY_STATUSES = ["lunch", "personal", "meal", "meeting", "traveling", "support", "site_blocked", "awaiting_release"];

export const WINDOW_START_HOUR = 7;
export const WINDOW_END_HOUR = 19;
export const WINDOW_MINUTES = (WINDOW_END_HOUR - WINDOW_START_HOUR) * 60;
export const HOURS = Array.from({ length: WINDOW_END_HOUR - WINDOW_START_HOUR + 1 }, (_, i) => WINDOW_START_HOUR + i);

export function pct(date: Date, base: Date) {
  const dayStart = new Date(base);
  dayStart.setHours(WINDOW_START_HOUR, 0, 0, 0);
  const minutes = (date.getTime() - dayStart.getTime()) / 60000;
  return Math.max(0, Math.min(100, (minutes / WINDOW_MINUTES) * 100));
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

export interface Segment {
  color: string;
  label: string;
  start: Date;
  end: Date | null; // null = ainda aberto (vai até "agora")
  live: boolean;
  taskId?: number; // presente nas barras de tarefa (permite ações sobre a tarefa)
}

export interface StatusEventLike {
  status: string;
  status_display: string;
  changed_at: string;
  adjusted?: boolean;
}

interface Interval {
  start: number;
  end: number;
}

/** Recorta `base` removendo os trechos cobertos por qualquer intervalo em
 * `cuts` — usado pra tirar das barras de presença o tempo que já é coberto
 * por uma barra de tarefa (concluída ou aberta), pra não desenhar duas
 * barras sobrepostas no mesmo horário. */
function subtractIntervals(base: Interval, cuts: Interval[]): Interval[] {
  let pieces: Interval[] = [base];
  for (const cut of cuts) {
    const next: Interval[] = [];
    for (const p of pieces) {
      if (cut.end <= p.start || cut.start >= p.end) {
        next.push(p);
        continue;
      }
      if (cut.start > p.start) next.push({ start: p.start, end: cut.start });
      if (cut.end < p.end) next.push({ start: cut.end, end: p.end });
    }
    pieces = next;
  }
  // descarta sobras menores que 1min (ruído de arredondamento)
  return pieces.filter((p) => p.end - p.start >= 60000);
}

const AWAY_STATUS_SET = new Set(AWAY_STATUSES);

/** Extrai os intervalos de tempo em que o técnico estava FORA da execução
 * (almoço, café, reunião, deslocamento, apoio, sem acesso ao site, aguardando
 * liberações...) a partir do histórico de eventos de presença já ordenado.
 * Escolher qualquer um desses status pausa as tarefas dele, então nesses
 * trechos a barra da tarefa não pode cobrir a barra do status. */
function getAwayIntervals(sortedEvents: StatusEventLike[], nowMs: number): Interval[] {
  const result: Interval[] = [];
  for (let i = 0; i < sortedEvents.length; i++) {
    if (!AWAY_STATUS_SET.has(sortedEvents[i].status)) continue;
    const startMs = new Date(sortedEvents[i].changed_at).getTime();
    const endMs =
      i + 1 < sortedEvents.length ? new Date(sortedEvents[i + 1].changed_at).getTime() : nowMs;
    if (endMs > startMs) result.push({ start: startMs, end: endMs });
  }
  return result;
}

/** Monta as barras do dia de um técnico combinando três fontes: as tarefas
 * já CONCLUÍDAS naquele dia, as tarefas ABERTAS agora (executando/pausada —
 * pode ter mais de uma, ver stacking em assignLanes), e o HISTÓRICO de
 * trocas de status de presença (`statusEvents`, um registro por troca) —
 * cada troca vira sua própria barra, recortada nos trechos que já são
 * cobertos por uma tarefa naquele intervalo. Isso substitui a aproximação
 * antiga (só a barra do status ATUAL) por uma timeline fiel a cada mudança
 * que realmente aconteceu no dia.
 *
 * Tarefas concluídas são recortadas pelos intervalos em que o técnico esteve
 * fora da execução (almoço, café, deslocamento, bloqueio de site, aguardando
 * liberações... — ver AWAY_STATUSES): esse trecho não aparece como barra azul,
 * aparece como a barra de presença do status correspondente.
 *
 * `isLive`: true = timeline ao vivo (barras abertas vão até "agora" de
 * verdade e pulsam); false = dia fechado no histórico (barras abertas —
 * caso raro de tarefa nunca finalizada — só vão até o `now` passado). */
export function buildTechSegments(
  blocks: TimelineBlock[],
  statusEvents: StatusEventLike[],
  now: Date,
  isLive: boolean,
  locale = "pt-BR"
): Segment[] {
  const nowMs = now.getTime();
  const segments: Segment[] = [];
  const taskIntervals: Interval[] = [];

  const sortedEvents = [...statusEvents].sort(
    (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()
  );
  const lastStatus = sortedEvents.length > 0 ? sortedEvents[sortedEvents.length - 1].status : null;
  const awayIntervals = getAwayIntervals(sortedEvents, nowMs);

  for (const b of blocks) {
    // Rastreamento próprio do técnico: uma barra por trecho trabalhado. A pausa
    // (almoço, café...) vira um vão na barra da tarefa — ocupado pela barra do
    // status, nunca sobreposto — e ao voltar a tarefa recomeça com barra nova.
    if (b.working_intervals) {
      for (const iv of b.working_intervals) {
        const startMs = new Date(iv.start).getTime();
        const endMs = iv.end ? new Date(iv.end).getTime() : nowMs;
        if (endMs <= startMs) continue;
        const open = iv.end == null;
        const pieces = awayIntervals.length > 0 ? subtractIntervals({ start: startMs, end: endMs }, awayIntervals) : [{ start: startMs, end: endMs }];
        for (const piece of pieces) {
          const isOpenTail = open && piece.end === endMs;
          segments.push({
            color: b.status === "completed" ? DONE_COLOR : BUSY_COLOR.in_progress,
            label: b.adjusted ? `${b.name} ✎` : b.name,
            start: new Date(piece.start),
            end: isOpenTail && isLive ? null : new Date(piece.end),
            live: isOpenTail && isLive && b.status === "in_progress",
            taskId: b.id,
          });
          taskIntervals.push(piece);
        }
      }
      continue;
    }
    if (b.status === "completed" && b.actual_start && b.actual_end) {
      const startMs = new Date(b.actual_start).getTime();
      const endMs = new Date(b.actual_end).getTime();
      const taskInterval = { start: startMs, end: endMs };

      // Recorta a barra nos períodos em que o técnico estava fora da execução
      // (almoço, deslocamento, bloqueio...): esses trechos aparecem como a barra
      // do próprio status, e NÃO entram em taskIntervals — senão o laço de
      // presença os descartaria e sobraria um buraco na linha do técnico.
      const effectivePieces =
        awayIntervals.length > 0 ? subtractIntervals(taskInterval, awayIntervals) : [taskInterval];

      for (const piece of effectivePieces) {
        segments.push({
          color: DONE_COLOR,
          label: b.name,
          start: new Date(piece.start),
          end: new Date(piece.end),
          live: false,
          taskId: b.id,
        });
        taskIntervals.push(piece);
      }
    } else if ((b.status === "in_progress" || b.status === "paused") && b.actual_start) {
      const start = new Date(b.actual_start);
      taskIntervals.push({ start: start.getTime(), end: nowMs });
      if (b.status === "paused") {
        if (lastStatus && AWAY_STATUSES.includes(lastStatus)) {
          segments.push({
            color: PRESENCE_COLOR[lastStatus],
            label: `${presenceLabel(lastStatus, locale)} · ${b.name}`,
            start,
            end: isLive ? null : now,
            live: false,
            taskId: b.id,
          });
        } else {
          segments.push({ color: BUSY_COLOR.paused, label: `${emPausaLabel(locale)} · ${b.name}`, start, end: isLive ? null : now, live: false, taskId: b.id });
        }
      } else {
        segments.push({ color: BUSY_COLOR.in_progress, label: b.name, start, end: isLive ? null : now, live: isLive, taskId: b.id });
      }
    }
  }

  for (let i = 0; i < sortedEvents.length; i++) {
    const ev = sortedEvents[i];
    if (ev.status === "not_started") continue;
    const startMs = new Date(ev.changed_at).getTime();
    const endMs = i + 1 < sortedEvents.length ? new Date(sortedEvents[i + 1].changed_at).getTime() : nowMs;
    if (endMs <= startMs) continue;
    const isLastEvent = i === sortedEvents.length - 1;
    const pieces = subtractIntervals({ start: startMs, end: endMs }, taskIntervals);
    for (const piece of pieces) {
      const isOpenTail = isLastEvent && piece.end === endMs;
      segments.push({
        color: PRESENCE_COLOR[ev.status] || "var(--text-faint)",
        label: presenceLabel(ev.status, locale, ev.status_display) + (ev.adjusted ? " ✎" : ""),
        start: new Date(piece.start),
        end: isOpenTail && isLive ? null : new Date(piece.end),
        live: false,
      });
    }
  }

  segments.sort((a, b) => a.start.getTime() - b.start.getTime());
  return segments;
}

export interface LanedSegment {
  segment: Segment;
  lane: number;
  laneCount: number;
}

/** Distribui os segmentos em "lanes" (linhas verticais dentro da mesma
 * trilha do técnico) por SOBREPOSIÇÃO REAL de horário — não por índice fixo.
 * Segmentos que não se sobrepõem no tempo (o caso comum: uma sequência de
 * status/tarefas ao longo do dia) ficam todos alinhados na lane 0; só
 * sobreposição de verdade (ex: pausou uma tarefa e iniciou outra ao mesmo
 * tempo) usa mais de uma lane. */
export function assignLanes(segments: Segment[]): LanedSegment[] {
  const OPEN_END = Number.MAX_SAFE_INTEGER;
  const sorted = [...segments].sort((a, b) => a.start.getTime() - b.start.getTime());
  const laneEnds: number[] = [];
  const raw: { segment: Segment; lane: number }[] = [];
  for (const segment of sorted) {
    const segStart = segment.start.getTime();
    const segEnd = segment.end ? segment.end.getTime() : OPEN_END;
    let lane = laneEnds.findIndex((end) => end <= segStart);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = segEnd;
    raw.push({ segment, lane });
  }
  const laneCount = Math.max(1, laneEnds.length);
  return raw.map((r) => ({ ...r, laneCount }));
}

/** Recolher a timeline de um técnico com várias tarefas simultâneas: fica UMA linha
 * só, sem buracos. As barras mais longas têm prioridade; as menores entram só nos
 * trechos que as longas não cobrem (recortadas, sem sobrepor), e o que sobra de
 * cada uma fica visível ao expandir. Evita a poluição de dezenas de barras
 * empilhadas quando ele inicia muitas tarefas ao mesmo tempo. */
export function collapseLanes(laned: LanedSegment[], expanded: boolean) {
  const fullLaneCount = laned[0]?.laneCount ?? 1;
  const collapsible = fullLaneCount > 1;
  if (expanded || !collapsible) {
    return { visible: laned, laneCount: fullLaneCount, hiddenCount: 0, collapsible, expanded: expanded && collapsible };
  }
  const nowMs = Date.now();
  const endOf = (seg: Segment) => (seg.end ? seg.end.getTime() : nowMs);
  const byLength = [...laned].sort(
    (a, b) => endOf(b.segment) - b.segment.start.getTime() - (endOf(a.segment) - a.segment.start.getTime())
  );
  const chosen: Interval[] = [];
  const visible: LanedSegment[] = [];
  let shown = 0;
  for (const { segment } of byLength) {
    const startMs = segment.start.getTime();
    const endMs = endOf(segment);
    const pieces = subtractIntervals({ start: startMs, end: endMs }, chosen);
    if (pieces.length > 0) shown += 1;
    for (const piece of pieces) {
      chosen.push(piece);
      const reachesOpenEnd = segment.end == null && piece.end === endMs;
      visible.push({
        segment: { ...segment, start: new Date(piece.start), end: reachesOpenEnd ? null : new Date(piece.end) },
        lane: 0,
        laneCount: 1,
      });
    }
  }
  visible.sort((a, b) => a.segment.start.getTime() - b.segment.start.getTime());
  return { visible, laneCount: 1, hiddenCount: laned.length - shown, collapsible, expanded: false };
}

interface Paired {
  id: number;
  pair_partner: PairPartner | null;
}

export interface PairGroup<T extends Paired> {
  primary: T;
  partner: T | null;
}

/** Agrupa a lista de técnicos em duplas fixas (ver CollaboratorPair no
 * backend) — cada item aparece uma única vez, como `primary` sozinho (sem
 * dupla) ou como `{primary, partner}`. A ordem de entrada é preservada
 * (só pula o parceiro quando ele já apareceu antes na lista). */
export function groupByPair<T extends Paired>(items: T[]): PairGroup<T>[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<number>();
  const groups: PairGroup<T>[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const partner = item.pair_partner ? byId.get(item.pair_partner.id) || null : null;
    if (partner) seen.add(partner.id);
    groups.push({ primary: item, partner });
  }
  return groups;
}

/** Reordena `rows` (qualquer lista com `tech: Paired`) pra que duplas
 * fiquem em linhas adjacentes — usado na timeline, onde já existe um array
 * de linhas construído (com segments/lanes calculados) e só a ORDEM precisa
 * mudar, não os dados. */
export function reorderRowsByPair<R extends { tech: Paired }>(rows: R[]): R[] {
  const groups = groupByPair(rows.map((r) => r.tech));
  const byTechId = new Map(rows.map((r) => [r.tech.id, r]));
  const ordered: R[] = [];
  for (const g of groups) {
    const primaryRow = byTechId.get(g.primary.id);
    if (primaryRow) ordered.push(primaryRow);
    if (g.partner) {
      const partnerRow = byTechId.get(g.partner.id);
      if (partnerRow) ordered.push(partnerRow);
    }
  }
  return ordered;
}

/** Classe CSS pra dar o visual de "linhas coladas" às duas linhas de uma
 * dupla na timeline (fundo compartilhado, sem borda entre elas) — chamar
 * pra cada índice da lista JÁ reordenada por reorderRowsByPair. */
export function pairRowClass<R extends { tech: Paired }>(rows: R[], index: number): string {
  const row = rows[index];
  const prev = rows[index - 1];
  const next = rows[index + 1];
  const pairedWithPrev = !!prev && row.tech.pair_partner?.id === prev.tech.id;
  const pairedWithNext = !!next && row.tech.pair_partner?.id === next.tech.id;
  if (!pairedWithPrev && !pairedWithNext) return "";
  return `tl-row-pair${pairedWithPrev ? " tl-row-pair-second" : " tl-row-pair-first"}`;
}
