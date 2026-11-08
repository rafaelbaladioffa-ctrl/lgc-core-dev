import type { AwsQuote, KpiKey } from './aws-quote.js';

/**
 * O que vai em cada linha do Bid Template (projetos-especificacao §7.4), no formato que a LGC já usa
 * (conferido com uma Bid real enviada à AWS, fora do Git):
 * - cabo fornecido pela AWS: G comprimento médio, S quantidade instalada (por cima da fórmula, sem custo
 *   de material), T horas, U comentário; linha "Free Entry" também leva A descrição, B finalidade,
 *   D fornecedor, E código e K unidade. Tipos da SOW que caem na mesma linha são somados.
 * - material da LGC: linha do catálogo (campo "referência no formulário do cliente"), J preço, M quantidade.
 * - deslocamento, plataforma, hospedagem e diárias: J valor unitário, M quantidade.
 * - mão de obra: J valor hora, M horas.
 * - Bid KPIs: "Yes" nos indicadores fora da meta.
 */

export interface BidHeaderProfile {
  vendorName: string | null;
  pocName: string | null;
  pocEmail: string | null;
  leadTimeDays: number | null;
}

export interface CableLineProfile {
  /** Código da coluna C (part number da AWS ou `free_…`). */
  code: string;
  description?: string | null;
  supplier?: string | null;
  partNumber?: string | null;
  unit?: string | null;
}

/** Padrão combinado com o dono em 2026-11-08: técnico → Technician, encarregado → Foreman, gerente → PM (taxa normal). */
export const DEFAULT_ROLE_CODES: Record<string, string> = { tecnico: 'T-H-S', encarregado: 'GF-H-S', gerente_projeto: 'PM-H-S' };

/** Linhas fixas de condições gerais no modelo 3.26. */
export const CONDITION_CODES = { transport: 'transport', platform: 'equip_rental', lodging: 'lodging', meals: 'perdiem' } as const;

/** Rótulo do indicador na coluna A da aba Bid KPIs. */
export const KPI_ROW_LABEL: Record<KpiKey, string> = {
  efficiency: 'Efficiency',
  costPerPort: 'Cost per Port',
  laborCostPerPort: 'Labor Cost per Port',
  hoursPerPort: 'Hours per Port',
  hoursPerMeter: 'Hours per Meter',
};

export interface PlannedLine {
  code: string;
  /**
   * Fornecedor da linha de catálogo (coluna D). O mesmo código pode existir numa linha com fornecedor e noutra
   * em "Select"; o fornecedor decide qual usar e é escrito quando a linha está em "Select".
   */
  supplier?: string | null;
  /** Coluna → valor. `S` é escrita por cima da fórmula. */
  cells: Record<string, string | number>;
  /** Para a tela: o que a linha representa. */
  label: string;
}

export interface BidPlan {
  header: { vendorName: string; pocName: string; pocEmail: string; proposalName: string; start: string; end: string; submissionDate: string; leadTimeDays: number };
  lines: PlannedLine[];
  kpiYes: string[];
}

export interface BidPlanInput {
  projectCode: string;
  submissionDate: string;
  quote: AwsQuote;
  hoursPerDay: number | null;
  result: {
    workDays: number;
    vehicleDays: number;
    labor: Array<{ roleKey: string; label: string; fieldRole: boolean; people: number | null; hours: string; billingRate: string }>;
    materials: Array<{ materialId: string | null; description: string; unit: string; quantity: string; billed: string }>;
    revenue: { travel: string; platform: string };
  };
  inputs: {
    travel?: { destinationName?: string | null; kmRoundTrip?: string | null; cars?: number | null };
    platform?: { days?: number | null; dailyBilled?: string | null };
    lodging?: { people?: number | null; nights?: number | null; nightValue?: string | null };
    meals?: { people?: number | null; days?: number | null; dayValue?: string | null };
  };
  /** Do catálogo, pelos ids das linhas de material. */
  catalog: Map<string, { clientRef: string | null; manufacturer: string | null; partNumber: string | null; name: string; unit: string }>;
  profile: { header: BidHeaderProfile; cables: Record<string, CableLineProfile>; roles: Record<string, string> };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

export function buildBidPlan(input: BidPlanInput): { plan: BidPlan | null; blockers: string[]; unmappedCables: string[]; unmappedRoles: string[] } {
  const blockers: string[] = [];
  const { quote, result, profile } = input;
  const h = profile.header;
  if (!h.vendorName) blockers.push('Preencha o nome do fornecedor no perfil da Bid (como aparece na lista da AWS).');
  if (!h.pocName || !h.pocEmail) blockers.push('Preencha o contato e o e-mail da proposta no perfil da Bid.');
  if (!quote.bidValues.start || !quote.bidValues.end) blockers.push('A revisão precisa de início e conclusão previstos (cabeçalho do orçamento ou Axis Core).');

  const lines: PlannedLine[] = [];
  const usedCodes = new Map<string, string>();
  const claim = (code: string, what: string) => {
    const prev = usedCodes.get(code);
    if (prev) blockers.push(`"${what}" e "${prev}" caem na mesma linha do Bid Template (${code}); o modelo tem uma linha por item.`);
    else usedCodes.set(code, what);
  };

  // Cabos: agrupados pela linha do Bid Template.
  const unmappedCables: string[] = [];
  const groups = new Map<string, { profile: CableLineProfile; types: string[]; quantity: number; meters: number; hours: number }>();
  for (const t of quote.perType) {
    const p = profile.cables[t.type];
    if (!p?.code) {
      unmappedCables.push(t.type);
      continue;
    }
    const g = groups.get(p.code) ?? { profile: p, types: [], quantity: 0, meters: 0, hours: 0 };
    g.types.push(t.type);
    g.quantity += t.quantity;
    g.meters += t.meters;
    g.hours += t.hoursT;
    groups.set(p.code, g);
  }
  if (unmappedCables.length) blockers.push(`Escolha a linha do Bid Template para: ${unmappedCables.join(', ')}.`);
  for (const [code, g] of groups) {
    claim(code, g.types.join(' + '));
    const meters = round2(g.meters);
    const what = `${g.quantity}x ${g.types.join(' + ')}`;
    const cells: Record<string, string | number> = {
      G: g.quantity ? Math.round(g.meters / g.quantity) : 0,
      S: g.quantity,
      T: round2(g.hours),
      U: `AWS-provided material (install only). ${what}, ${fmt(meters)} m total; average length shown.`,
    };
    if (code.startsWith('free_')) {
      if (!g.profile.description || !g.profile.unit) blockers.push(`A linha livre ${code} precisa de descrição e unidade no perfil da Bid.`);
      Object.assign(cells, {
        A: g.profile.description ?? g.types.join(' + '),
        B: `${what} (AWS-provided cable, install only)`,
        D: g.profile.supplier ?? 'AWS Internal',
        E: g.profile.partNumber ?? '',
        K: g.profile.unit ?? 'm',
      });
    }
    lines.push({ code, cells, label: `Cabos: ${g.types.join(' + ')}`, supplier: code.startsWith('free_') ? null : (g.profile.supplier ?? null) });
  }

  // Materiais da LGC.
  for (const m of result.materials) {
    const qty = Number(m.quantity);
    if (!(qty > 0)) continue;
    const cat = m.materialId ? input.catalog.get(m.materialId) : undefined;
    if (!cat) {
      blockers.push(`O material avulso "${m.description}" precisa estar no catálogo, com a linha do Bid Template.`);
      continue;
    }
    if (!cat.clientRef) {
      blockers.push(`Informe a linha do Bid Template ("referência no formulário do cliente") do material "${cat.name}" no catálogo.`);
      continue;
    }
    if (!Number.isInteger(qty)) blockers.push(`O Bid Template só aceita quantidade inteira: material "${cat.name}" está com ${m.quantity}.`);
    claim(cat.clientRef, cat.name);
    const cells: Record<string, string | number> = { J: round2(Number(m.billed) / qty), M: qty };
    if (cat.clientRef.startsWith('free_')) Object.assign(cells, { A: cat.name, D: cat.manufacturer ?? '', E: cat.partNumber ?? '', K: cat.unit });
    lines.push({ code: cat.clientRef, cells, label: `Material: ${cat.name}` });
  }

  // Condições gerais.
  const travel = Number(result.revenue.travel) || 0;
  if (travel > 0 && result.vehicleDays > 0) {
    const rate = round2(travel / result.vehicleDays);
    const cars = input.inputs.travel?.cars ?? 0;
    const km = input.inputs.travel?.kmRoundTrip;
    claim(CONDITION_CODES.transport, 'Deslocamento');
    lines.push({
      code: CONDITION_CODES.transport,
      label: 'Deslocamento',
      cells: {
        J: rate,
        M: result.vehicleDays,
        B: `Daily round trip${input.inputs.travel?.destinationName ? ` to ${input.inputs.travel.destinationName}` : ''}${km ? `: ${fmt(Number(km))} km/day` : ''}, ${cars} vehicle(s).`,
        U: `${cars} vehicle(s) x ${result.workDays} working days = ${result.vehicleDays} vehicle-days @ ${fmt(rate)}.`,
      },
    });
  }
  const platformDays = input.inputs.platform?.days ?? 0;
  if ((Number(result.revenue.platform) || 0) > 0 && platformDays > 0) {
    claim(CONDITION_CODES.platform, 'Plataforma');
    lines.push({ code: CONDITION_CODES.platform, label: 'Plataforma elevatória', cells: { J: Number(input.inputs.platform?.dailyBilled ?? 0), M: platformDays, U: `Mobile elevating work platform: ${platformDays} day(s).` } });
  }
  const lodging = input.inputs.lodging;
  if (lodging?.people && lodging.nights && Number(lodging.nightValue) > 0) {
    claim(CONDITION_CODES.lodging, 'Hospedagem');
    lines.push({ code: CONDITION_CODES.lodging, label: 'Hospedagem', cells: { J: Number(lodging.nightValue), M: lodging.people * lodging.nights, U: `${lodging.people} people x ${lodging.nights} night(s).` } });
  }
  const meals = input.inputs.meals;
  if (meals?.people && meals.days && Number(meals.dayValue) > 0) {
    claim(CONDITION_CODES.meals, 'Alimentação');
    lines.push({ code: CONDITION_CODES.meals, label: 'Alimentação (diárias)', cells: { J: Number(meals.dayValue), M: meals.people * meals.days, U: `${meals.people} people x ${meals.days} day(s).` } });
  }

  // Mão de obra.
  const unmappedRoles: string[] = [];
  for (const l of result.labor) {
    const hours = round2(Number(l.hours) || 0);
    if (hours <= 0) continue;
    const code = profile.roles[l.roleKey] ?? DEFAULT_ROLE_CODES[l.roleKey];
    if (!code) {
      unmappedRoles.push(l.label);
      continue;
    }
    claim(code, l.label);
    const comment = l.fieldRole && l.people
      ? `${l.people} x ${result.workDays} working days x ${input.hoursPerDay ?? '—'} h`
      : `${fmt(hours)} h`;
    lines.push({ code, label: `Mão de obra: ${l.label}`, cells: { J: Number(l.billingRate), M: hours, U: comment } });
  }
  if (unmappedRoles.length) blockers.push(`Escolha a linha de mão de obra do Bid Template para: ${unmappedRoles.join(', ')}.`);

  const kpiYes = quote.kpis.filter((k) => k.flagged).map((k) => KPI_ROW_LABEL[k.key]);
  if (blockers.length) return { plan: null, blockers, unmappedCables, unmappedRoles };
  return {
    plan: {
      header: {
        vendorName: h.vendorName!,
        pocName: h.pocName!,
        pocEmail: h.pocEmail!,
        proposalName: input.projectCode,
        start: quote.bidValues.start!,
        end: quote.bidValues.end!,
        submissionDate: input.submissionDate,
        leadTimeDays: h.leadTimeDays ?? 0,
      },
      lines,
      kpiYes,
    },
    blockers,
    unmappedCables,
    unmappedRoles,
  };
}
