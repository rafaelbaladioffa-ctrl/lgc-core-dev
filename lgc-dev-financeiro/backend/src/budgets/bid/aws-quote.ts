import type { BidTargets } from './bid-template-reader.js';
import type { SowCableType } from '../sow/sow-parser.js';

/**
 * Cotação no modelo `aws_sow` (projetos-especificacao §7.2–§7.4): horas-meta pelas metas do Bid Template,
 * dias sugeridos, horas T por tipo de cabo, indicadores da aba Bid KPIs e os valores que vão para a Bid.
 * Função pura: recebe o resultado já calculado do orçamento e devolve números; não grava nada.
 */

export type KpiKey = 'efficiency' | 'costPerPort' | 'laborCostPerPort' | 'hoursPerPort' | 'hoursPerMeter';

export const KPI_LABEL: Record<KpiKey, string> = {
  efficiency: 'Eficiência',
  costPerPort: 'Custo por porta',
  laborCostPerPort: 'Mão de obra por porta',
  hoursPerPort: 'Horas por porta',
  hoursPerMeter: 'Horas por metro',
};

export interface AwsQuoteInput {
  types: SowCableType[];
  targets: BidTargets;
  /** Resultado do orçamento (motor da PJ2), só o que importa aqui. */
  result: {
    workDays: number;
    fieldHours: string;
    vehicleDays: number;
    labor: Array<{ roleKey: string; label: string; fieldRole: boolean; people: number | null; hours: string; billingRate: string; billed: string }>;
    revenue: { total: string; labor: string; travel: string; platform: string };
  };
  hoursPerDay: number | null;
  /** Janela de execução da SOW (`AAAA-MM-DD`). */
  window: { start: string | null; end: string | null };
  /** Horas T digitadas à mão por tipo de cabo. */
  hoursOverrides: Record<string, number>;
  justifications: Partial<Record<KpiKey, string>>;
  bid: { proposalName: string; start: string | null; end: string | null; platformDays: number; platformDaily: string | null };
  /** Feriados ativos do Core (`AAAA-MM-DD`). `null`/ausente = o cache ainda não tem o calendário do Core. */
  holidays?: ReadonlySet<string> | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/**
 * Dias úteis de `start` a `end`, inclusive: segunda a sexta, menos os feriados do Core (`holidays`, datas
 * `AAAA-MM-DD` do cache `HOLIDAY`). Sem feriados, conta só segunda a sexta.
 */
export function businessDays(start: string | null, end: string | null, holidays?: ReadonlySet<string> | null): number | null {
  if (!start || !end) return null;
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null;
  let n = 0;
  for (const d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays?.has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

/** Distribui `total` (inteiro) proporcionalmente; a sobra de arredondamento vai para a primeira linha (§7.2). */
export function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || weights.length === 0) return weights.map(() => 0);
  const parts = weights.map((w) => Math.round((total * w) / sum));
  parts[0] += Math.round(total) - parts.reduce((s, p) => s + p, 0);
  return parts;
}

/**
 * Equipe alinhada ao que a AWS projeta (pedido do dono em 2026-11-08): sempre 1 encarregado; técnicos e dias
 * para que as horas de campo cubram as horas-meta do Bid Template dentro da janela da SOW. Primeiro acha a
 * menor equipe que cabe na janela; depois os menores dias para essa equipe. Sem janela, usa 1 técnico.
 * Conferido com uma Bid real: 176,4 h, janela de 7 dias úteis, 8 h/dia → 1 encarregado + 3 técnicos × 6 dias.
 */
export function suggestTeam(targetHours: number, windowDays: number | null, hoursPerDay: number | null): { foremen: number; technicians: number; days: number } | null {
  if (!(targetHours > 0) || !hoursPerDay || hoursPerDay <= 0) return null;
  const foremen = 1;
  let crew = windowDays && windowDays > 0 ? Math.ceil(targetHours / (windowDays * hoursPerDay)) : foremen + 1;
  crew = Math.max(crew, foremen + 1);
  const days = Math.ceil(targetHours / (crew * hoursPerDay));
  return { foremen, technicians: crew - foremen, days };
}

export function computeAwsQuote(input: AwsQuoteInput) {
  const { types, targets, result } = input;
  const hpm = targets.targets.hoursPerMeter;
  const hpp = targets.targets.hoursPerPort;
  const warnings: string[] = [];
  if (hpm === null || hpp === null) warnings.push('Sem metas de horas do cluster: horas-meta e indicadores de horas não foram calculados.');

  const perTypeBase = types.map((t) => {
    const consideredMeters = t.quantity * t.averageLengthM;
    const target = hpm !== null && hpp !== null ? targets.weights.meters * consideredMeters * hpm + targets.weights.ports * t.ports * hpp : 0;
    return { ...t, consideredMeters, targetHours: round2(target) };
  });
  // Dispositivos: o Bid Template só conta linhas de dispositivo preenchidas; numa proposta só de cabeamento é 0.
  const targetHours = round2(perTypeBase.reduce((s, t) => s + t.targetHours, 0));
  const meters = perTypeBase.reduce((s, t) => s + t.consideredMeters, 0);
  const ports = perTypeBase.reduce((s, t) => s + t.ports, 0);

  const fieldHours = Number(result.fieldHours) || 0;
  const totalLaborHours = round2(result.labor.reduce((s, l) => s + (Number(l.hours) || 0), 0));
  const fieldPeople = result.labor.filter((l) => l.fieldRole).reduce((s, l) => s + (l.people ?? 0), 0);

  const auto = distribute(fieldHours, perTypeBase.map((t) => t.targetHours));
  const perType = perTypeBase.map((t, i) => {
    const override = input.hoursOverrides[t.type];
    const overridden = typeof override === 'number' && Number.isFinite(override);
    return { ...t, hoursTAuto: auto[i], hoursT: overridden ? override : auto[i], overridden };
  });
  const hoursTSum = round2(perType.reduce((s, t) => s + t.hoursT, 0));
  const hoursTMatches = Math.abs(hoursTSum - fieldHours) <= 0.01;

  const suggestedDays = input.hoursPerDay && fieldPeople > 0 && targetHours > 0 ? Math.ceil(targetHours / (fieldPeople * input.hoursPerDay)) : null;
  const windowBusinessDays = businessDays(input.window.start, input.window.end, input.holidays);
  const fitsWindow = windowBusinessDays === null || !result.workDays ? null : result.workDays <= windowBusinessDays;
  if (windowBusinessDays !== null && !input.holidays) warnings.push('Sem o calendário de feriados do Axis Core: os dias úteis da janela contam só segunda a sexta.');

  const revenue = Number(result.revenue.total) || 0;
  const laborBilled = Number(result.revenue.labor) || 0;
  const t = targets.thresholds;
  const kpi = (key: KpiKey, value: number | null, target: number | null, threshold: number, lowerIsBad: boolean) => {
    const delta = value !== null && target ? value / target - 1 : null;
    const flagged = delta !== null && (lowerIsBad ? delta < threshold : delta > threshold);
    const justification = input.justifications[key]?.trim() || null;
    return {
      key,
      label: KPI_LABEL[key],
      value: value === null ? null : Math.round(value * 10000) / 10000,
      target,
      delta: delta === null ? null : Math.round(delta * 10000) / 10000,
      threshold,
      flagged,
      justification,
      missingJustification: flagged && !justification,
    };
  };
  const kpis = [
    kpi('efficiency', ratio(targetHours, totalLaborHours), 1, t.efficiency, true),
    kpi('costPerPort', ratio(revenue, ports), targets.converted.costPerPort, t.costPerPort, false),
    kpi('laborCostPerPort', ratio(laborBilled, ports), targets.converted.laborCostPerPort, t.laborCostPerPort, false),
    kpi('hoursPerPort', ratio(totalLaborHours, ports), hpp, t.hoursPerPort, false),
    kpi('hoursPerMeter', ratio(totalLaborHours, meters), hpm, t.hoursPerMeter, false),
  ];

  const blockers: string[] = [];
  if (types.length === 0) blockers.push('A SOW não tem cabos.');
  if (!hoursTMatches) blockers.push(`As horas por tipo de cabo somam ${hoursTSum}; precisam ser iguais às horas de campo (${fieldHours}).`);
  for (const k of kpis.filter((x) => x.missingJustification)) blockers.push(`Justifique o indicador "${k.label}" (fora da meta do cliente).`);

  const travelPerCarDay = result.vehicleDays > 0 ? round2((Number(result.revenue.travel) || 0) / result.vehicleDays) : null;
  return {
    totals: { targetHours, meters, ports, fieldHours, totalLaborHours, fieldPeople },
    perType,
    hoursTSum,
    hoursTMatches,
    suggestedDays,
    /** Equipe que cobre as horas-meta na janela (1 encarregado + técnicos × dias); o orçamentista pode mudar. */
    suggestedTeam: suggestTeam(targetHours, windowBusinessDays, input.hoursPerDay),
    workDays: result.workDays,
    windowBusinessDays,
    fitsWindow,
    kpis,
    blockers,
    warnings,
    bidValues: {
      proposalName: input.bid.proposalName,
      start: input.bid.start,
      end: input.bid.end,
      labor: result.labor.map((l) => ({ roleKey: l.roleKey, label: l.label, rate: l.billingRate, hours: l.hours })),
      travel: { perCarDay: travelPerCarDay, vehicleDays: result.vehicleDays },
      platform: { days: input.bid.platformDays, daily: input.bid.platformDaily },
      cables: perType.map((c) => ({ type: c.type, averageLengthM: c.averageLengthM, quantity: c.quantity, hoursT: c.hoursT })),
    },
  };
}

export type AwsQuote = ReturnType<typeof computeAwsQuote>;
