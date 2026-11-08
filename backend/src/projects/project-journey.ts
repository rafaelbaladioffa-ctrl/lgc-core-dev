import { Prisma } from '@prisma/client';
import type { ProjectStatus, RequestStatus } from '@prisma/client';
import { deliveredByMaterial, formatQuantity, logisticsOf, logisticsStatusLabel, shortageItems } from '../requests/envio-logistica.js';
import { shipmentOf } from '../requests/envio-material.js';

/**
 * Jornada do projeto (PT-11): cotação → aprovado → requisição de envio → obra no Field → encerrado, montada só com o
 * que o Core já guarda. **Nenhum valor de custo, margem ou salário**: horas e percentuais podem; dinheiro fica no
 * Financeiro (o painel só leva o link para lá). `buildJourney` é pura (recebe os dados já lidos) para o agregador em
 * lote da lista e o detalhe do projeto usarem a mesma regra.
 */

export type JourneyState = 'feito' | 'em_andamento' | 'pendente' | 'atencao';
export type JourneyStageKey = 'cotacao' | 'aprovado' | 'requisicao' | 'obra' | 'encerrado';

export const JOURNEY_STAGE_LABEL: Record<JourneyStageKey, string> = {
  cotacao: 'Cotação',
  aprovado: 'Aprovado',
  requisicao: 'Requisição de envio',
  obra: 'Obra no Field',
  encerrado: 'Encerrado',
};

export interface JourneyDetail {
  label: string;
  value: string;
}

export interface JourneyStage {
  key: JourneyStageKey;
  label: string;
  state: JourneyState;
  /** ISO do marco mais recente da etapa; `null` enquanto não houve. */
  date: string | null;
  summary: string;
  details: JourneyDetail[];
  /** Motivos de atenção, em português (ex.: "Falta material no estoque"). */
  alerts: string[];
  /** Tela do Core que detalha a etapa (ex.: a requisição). */
  link: { label: string; to: string } | null;
}

export interface JourneyShipmentItem {
  materialCode: string;
  description: string;
  unit: string;
  /** Texto decimal com 3 casas. */
  quantity: string;
  delivered: string;
  shortage: string | null;
}

export interface JourneyFieldProgress {
  /** Link absoluto da obra no Field; `null` se o Field mandou link relativo e o satélite não tem URL de frontend. */
  url: string | null;
  fieldProjectCode: string | null;
  sowPlanStatus: string | null;
  tasksCount: number | null;
  percentComplete: number | null;
  tasksTotal: number | null;
  tasksDone: number | null;
  realManHours: number | null;
  plannedManHours: number | null;
  progressDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProjectJourney {
  projectId: string;
  code: string;
  name: string | null;
  status: ProjectStatus;
  currentStage: JourneyStageKey;
  stages: JourneyStage[];
  shipment: { requestId: string; code: string; items: JourneyShipmentItem[]; delivered: number; total: number; shortages: number } | null;
  field: JourneyFieldProgress | null;
  /** "Ver resultado no Financeiro": só quando o satélite Financeiro tem URL de frontend configurada. */
  financeiroUrl: string | null;
}

export interface JourneyInput {
  project: { id: string; code: string; name: string | null; status: ProjectStatus; siteId: string | null; site: { code: string; name: string } | null; updatedAt: Date };
  quoteRequests: Array<{ createdAt: Date }>;
  quotes: Array<{ id: string; revisionNumber: number; receivedAt: Date; materialsCount: number }>;
  acceptance: { projectQuoteId: string; revisionNumber: number; clientPoNumber: string | null; acceptedAt: Date; acceptedByEmail: string } | null;
  request: {
    id: string;
    code: string;
    status: RequestStatus;
    createdAt: Date;
    closedAt: Date | null;
    neededBy: Date | null;
    formData: Prisma.JsonValue;
    approvals: Array<{ status: string; approverName: string; decidedAt: Date | null }>;
  } | null;
  fieldWork: {
    fieldProjectId: string;
    fieldProjectCode: string | null;
    url: string | null;
    sowPlanStatus: string | null;
    tasksCount: number | null;
    createdInFieldAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    progressDate: Date | null;
    progressEventAt: Date | null;
    percentComplete: Prisma.Decimal | null;
    tasksTotal: number | null;
    tasksDone: number | null;
    realManHours: Prisma.Decimal | null;
    plannedManHours: Prisma.Decimal | null;
  } | null;
  /** `frontend_url` dos satélites ativos Field e Financeiro (nulos se não há satélite ou URL). */
  fieldFrontendUrl: string | null;
  financeiroFrontendUrl: string | null;
}

const SOW_PLAN_LABEL: Record<string, string> = {
  generated: 'Plano gerado',
  pending_review: 'Plano aguardando revisão no Field',
  failed: 'Falha ao gerar o plano',
  no_sow: 'Obra criada sem SOW',
};
const SOW_PLAN_ATTENTION = new Set(['pending_review', 'failed', 'no_sow']);

const REQUEST_STATUS_LABEL: Partial<Record<RequestStatus, string>> = {
  aguardando_aprovacao: 'Aguardando aprovação do centro de custo',
  aprovada: 'Aprovada',
  em_atendimento: 'Em atendimento na Logística',
  aguardando_entrega: 'Aguardando entrega no site',
  encerrada: 'Encerrada (entregue)',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
  reprovada: 'Reprovada pelo centro de custo',
};

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const dateOnly = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);
/** DD/MM/AAAA de uma data de calendário (UTC), para os textos da tela. */
const brDate = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10).split('-').reverse().join('/') : null);
const num = (value: Prisma.Decimal | null | undefined) => (value === null || value === undefined ? null : value.toNumber());

function detail(label: string, value: string | number | null | undefined): JourneyDetail[] {
  return value === null || value === undefined || value === '' ? [] : [{ label, value: String(value) }];
}

function latest(...dates: Array<Date | null | undefined>): Date | null {
  const valid = dates.filter((d): d is Date => d instanceof Date);
  return valid.length ? new Date(Math.max(...valid.map((d) => d.getTime()))) : null;
}

/** Link do Field: absoluto como veio, ou a base do frontend do satélite + o caminho relativo; sem base, `null`. */
export function resolveFieldUrl(url: string | null, frontendBase: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!frontendBase) return null;
  return `${frontendBase.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

/** Link do resultado do projeto no Financeiro (roteador de hash do frontend dele: `#/projetos/:id`). */
export function financeiroResultUrl(frontendBase: string | null, projectId: string): string | null {
  if (!frontendBase) return null;
  return `${frontendBase.replace(/\/+$/, '')}/#/projetos/${encodeURIComponent(projectId)}`;
}

function quoteStage(input: JourneyInput): JourneyStage {
  const { quotes, quoteRequests, project } = input;
  const current = quotes[0] ?? null; // `quotes` vem da maior revisão para a menor
  const requested = quoteRequests.length > 0;
  const lastRequest = quoteRequests.reduce<Date | null>((acc, row) => (acc && acc > row.createdAt ? acc : row.createdAt), null);
  const details: JourneyDetail[] = [];
  let state: JourneyState;
  let summary: string;
  if (current) {
    state = 'feito';
    summary = `Cotação recebida do Financeiro — revisão ${current.revisionNumber} vigente`;
    details.push(...detail('Situação', 'Cotação recebida'), ...detail('Revisão vigente', current.revisionNumber), ...detail('Revisões recebidas', quotes.length), ...detail('Materiais na revisão vigente', current.materialsCount));
  } else if (requested) {
    state = 'em_andamento';
    summary = 'Aguardando o Financeiro devolver a cotação';
    details.push(...detail('Situação', 'Aguardando o Financeiro'), ...detail('Pedida em', brDate(lastRequest)));
  } else {
    state = 'pendente';
    summary = 'Cotação ainda não solicitada ao Financeiro';
    details.push(...detail('Situação', 'Cotação não solicitada'));
  }
  const alerts: string[] = [];
  if (project.status !== 'proposta' && !current && !input.acceptance) alerts.push('O projeto saiu de proposta sem cotação recebida.');
  return { key: 'cotacao', label: JOURNEY_STAGE_LABEL.cotacao, state: alerts.length ? 'atencao' : state, date: iso(current?.receivedAt ?? lastRequest), summary, details, alerts, link: null };
}

function approvedStage(input: JourneyInput): JourneyStage {
  const { acceptance, project, quotes } = input;
  if (acceptance) {
    const details = [
      ...detail('Revisão aceita', acceptance.revisionNumber),
      ...detail('PO do cliente', acceptance.clientPoNumber),
      ...detail('Aprovado por', acceptance.acceptedByEmail),
      ...detail('Site', project.site ? `${project.site.code} — ${project.site.name}` : null),
    ];
    return { key: 'aprovado', label: JOURNEY_STAGE_LABEL.aprovado, state: 'feito', date: iso(acceptance.acceptedAt), summary: `Aprovado — revisão ${acceptance.revisionNumber} aceita${acceptance.clientPoNumber ? `, PO ${acceptance.clientPoNumber}` : ''}`, details, alerts: [], link: null };
  }
  const alerts: string[] = [];
  const ready = quotes.length > 0;
  if (ready && !project.siteId) alerts.push('Informe o site do projeto para poder aprovar.');
  return {
    key: 'aprovado',
    label: JOURNEY_STAGE_LABEL.aprovado,
    state: 'pendente',
    date: null,
    summary: ready ? 'Cotação recebida: pronto para o cliente aprovar' : 'Depende da cotação do Financeiro',
    details: [...detail('Site', project.site ? `${project.site.code} — ${project.site.name}` : 'Sem site cadastrado')],
    alerts,
    link: null,
  };
}

function requestStage(input: JourneyInput): { stage: JourneyStage; shipment: ProjectJourney['shipment'] } {
  const { acceptance, request } = input;
  const base = { key: 'requisicao' as const, label: JOURNEY_STAGE_LABEL.requisicao };
  if (!acceptance) {
    return { stage: { ...base, state: 'pendente', date: null, summary: 'Nasce quando o projeto é aprovado', details: [], alerts: [], link: null }, shipment: null };
  }
  if (!request) {
    return { stage: { ...base, state: 'feito', date: null, summary: 'A cotação aceita não tem materiais: nenhum envio necessário', details: [], alerts: [], link: null }, shipment: null };
  }

  const shipment = shipmentOf(request.formData);
  const logistics = logisticsOf(request.formData);
  const delivered = logistics ? deliveredByMaterial(logistics) : new Map<string, Prisma.Decimal>();
  const closed = request.status === 'encerrada' || request.status === 'concluida';
  // Falta registrada na reserva deixa de valer quando a entrega foi concluída (a reposição não gera evento próprio).
  const shortages = logistics && !closed ? shortageItems(logistics) : [];
  const dead = request.status === 'cancelada' || request.status === 'reprovada';
  const pendingApprovals = request.approvals.filter((a) => a.status === 'pendente');
  const decided = request.approvals.filter((a) => a.decidedAt).sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())[0] ?? null;

  const alerts: string[] = [];
  if (request.status === 'aguardando_aprovacao' && pendingApprovals.length === 0) alerts.push('Sem aprovador: o centro de custo do projeto não tem responsável cadastrado.');
  if (dead) alerts.push(request.status === 'reprovada' ? 'O centro de custo reprovou o envio: nada foi enviado à Logística.' : 'A requisição foi cancelada.');
  if (!closed && logistics) {
    if (shortages.length > 0) alerts.push(`Falta material no estoque da Logística (${shortages.length} ${shortages.length === 1 ? 'item' : 'itens'}).`);
    if (logistics.status === 'AGUARDANDO_ESTOQUE') alerts.push('A Logística aguarda estoque: o Suprimentos precisa abrir a compra do que falta.');
    if (['BLOQUEADA', 'DIVERGENCIA'].includes(logistics.status)) alerts.push(`Logística: ${logisticsStatusLabel(logistics.status).toLowerCase()}${logistics.statusReason ? ` — ${logistics.statusReason}` : ''}.`);
    for (const refusal of logistics.refusals) alerts.push(`Entrega recusada no site: ${refusal.reason ?? 'motivo não informado'}.`);
  }
  for (const warning of shipment?.warnings ?? []) if (request.status === 'aguardando_aprovacao') alerts.push(warning);

  const state: JourneyState = closed ? 'feito' : alerts.length > 0 ? 'atencao' : 'em_andamento';

  let summary: string;
  if (closed) summary = `Entregue no site${logistics?.orderCode ? ` (ordem ${logistics.orderCode})` : ''}`;
  else if (request.status === 'aguardando_aprovacao') summary = pendingApprovals.length > 0 ? `Aguardando aprovação de ${pendingApprovals.map((a) => a.approverName).join(', ')}` : 'Aguardando aprovação do centro de custo';
  else if (logistics) summary = `Logística: ${logisticsStatusLabel(logistics.status)}${logistics.orderCode ? ` (${logistics.orderCode})` : ''}`;
  else summary = REQUEST_STATUS_LABEL[request.status] ?? request.status;

  const approvalText = pendingApprovals.length > 0
    ? `Pendente — ${pendingApprovals.map((a) => a.approverName).join(', ')}`
    : request.status === 'reprovada'
      ? `Reprovada${decided ? ` por ${decided.approverName}` : ''}`
      : shipment?.approvedAt || decided
        ? `Aprovada${decided ? ` por ${decided.approverName}` : ''}`
        : 'Sem aprovador';
  const firstShipment = logistics?.shipments[0] ?? null;
  const items: JourneyShipmentItem[] = (shipment?.items ?? []).map((item) => ({
    materialCode: item.materialCode,
    description: item.description,
    unit: item.unit,
    quantity: formatQuantityFixed(item.quantity),
    delivered: (delivered.get(item.materialCode) ?? new Prisma.Decimal(0)).toFixed(3),
    shortage: shortages.find((s) => s.materialCode === item.materialCode)?.shortage ?? null,
  }));
  const totalQty = items.reduce((sum, item) => sum.plus(item.quantity), new Prisma.Decimal(0));
  const deliveredQty = items.reduce((sum, item) => sum.plus(Prisma.Decimal.min(item.delivered, item.quantity)), new Prisma.Decimal(0));

  const details: JourneyDetail[] = [
    ...detail('Requisição', request.code),
    ...detail('Aprovação do centro de custo', approvalText),
    ...detail('Necessário no site até', brDate(request.neededBy)),
    ...detail('Situação na Logística', logistics ? `${logisticsStatusLabel(logistics.status)}${logistics.orderCode ? ` — ordem ${logistics.orderCode}` : ''}` : shipment?.approvedAt ? 'Enviada à Logística; sem retorno ainda' : 'Ainda não enviada à Logística'),
    ...detail('Expedido em', brDate(logistics?.dispatchedAt ? new Date(logistics.dispatchedAt) : null)),
    ...detail('Romaneio', firstShipment?.manifest ?? firstShipment?.shipmentCode),
    ...detail('Transportadora', firstShipment?.carrier),
    ...detail('Entregue em', brDate(logistics?.deliveredAt ? new Date(logistics.deliveredAt) : null)),
    ...detail('Faltas', shortages.length > 0 ? shortages.map((s) => `${s.materialCode}: ${formatQuantity(s.shortage!)} de ${formatQuantity(s.quantity)}`).join('; ') : null),
  ];

  const date = latest(
    closed ? request.closedAt : null,
    logistics?.deliveredAt ? new Date(logistics.deliveredAt) : null,
    logistics?.dispatchedAt ? new Date(logistics.dispatchedAt) : null,
    shipment?.approvedAt ? new Date(shipment.approvedAt) : null,
    decided?.decidedAt,
    request.createdAt,
  );

  return {
    stage: { ...base, state, date: iso(date), summary, details, alerts, link: { label: 'Abrir a requisição', to: `/requests/${request.id}` } },
    shipment: {
      requestId: request.id,
      code: request.code,
      items,
      delivered: deliveredQty.toDecimalPlaces(3).toNumber(),
      total: totalQty.toDecimalPlaces(3).toNumber(),
      shortages: shortages.length,
    },
  };
}

function formatQuantityFixed(value: string): string {
  return new Prisma.Decimal(value).toFixed(3);
}

function fieldStage(input: JourneyInput): { stage: JourneyStage; field: JourneyFieldProgress | null } {
  const { fieldWork, acceptance } = input;
  const base = { key: 'obra' as const, label: JOURNEY_STAGE_LABEL.obra };
  if (!fieldWork) {
    return {
      stage: {
        ...base,
        state: 'pendente',
        date: null,
        summary: acceptance ? 'Aguardando o Field criar a obra' : 'Nasce quando o projeto é aprovado',
        details: [],
        alerts: [],
        link: null,
      },
      field: null,
    };
  }
  const url = resolveFieldUrl(fieldWork.url, input.fieldFrontendUrl);
  const field: JourneyFieldProgress = {
    url,
    fieldProjectCode: fieldWork.fieldProjectCode,
    sowPlanStatus: fieldWork.sowPlanStatus,
    tasksCount: fieldWork.tasksCount,
    percentComplete: num(fieldWork.percentComplete),
    tasksTotal: fieldWork.tasksTotal,
    tasksDone: fieldWork.tasksDone,
    realManHours: num(fieldWork.realManHours),
    plannedManHours: num(fieldWork.plannedManHours),
    progressDate: dateOnly(fieldWork.progressDate),
    startedAt: iso(fieldWork.startedAt),
    completedAt: iso(fieldWork.completedAt),
  };
  const alerts: string[] = [];
  if (fieldWork.sowPlanStatus && SOW_PLAN_ATTENTION.has(fieldWork.sowPlanStatus)) alerts.push(`${SOW_PLAN_LABEL[fieldWork.sowPlanStatus]}: as tarefas precisam de atenção no Field.`);
  if (field.plannedManHours && field.realManHours !== null && field.realManHours > field.plannedManHours) alerts.push('HH real acima do previsto.');

  const completed = fieldWork.completedAt !== null;
  const started = fieldWork.startedAt !== null || (field.percentComplete ?? 0) > 0;
  const state: JourneyState = completed ? 'feito' : alerts.length > 0 ? 'atencao' : started || fieldWork.createdInFieldAt ? 'em_andamento' : 'pendente';
  const summary = completed
    ? 'Obra concluída no Field'
    : started
      ? `Em execução — ${field.percentComplete !== null ? `${formatPercent(field.percentComplete)} concluído` : 'sem avanço informado'}`
      : `Obra criada no Field${fieldWork.tasksCount !== null ? ` com ${fieldWork.tasksCount} tarefas` : ''}; ainda sem tarefa iniciada`;

  const details: JourneyDetail[] = [
    ...detail('Obra no Field', fieldWork.fieldProjectCode ?? `#${fieldWork.fieldProjectId}`),
    ...detail('Plano da SOW', fieldWork.sowPlanStatus ? (SOW_PLAN_LABEL[fieldWork.sowPlanStatus] ?? fieldWork.sowPlanStatus) : null),
    ...detail('Tarefas', field.tasksTotal !== null ? `${field.tasksDone ?? 0} de ${field.tasksTotal} concluídas` : fieldWork.tasksCount),
    ...detail('Avanço', field.percentComplete !== null ? formatPercent(field.percentComplete) : null),
    ...detail('HH real × previsto', field.realManHours !== null || field.plannedManHours !== null ? `${formatHours(field.realManHours)} × ${formatHours(field.plannedManHours)}` : null),
    ...detail('Início real', brDate(fieldWork.startedAt)),
    ...detail('Último avanço', brDate(fieldWork.progressDate)),
    ...detail('Concluída em', brDate(fieldWork.completedAt)),
  ];
  return {
    stage: { ...base, state, date: iso(latest(fieldWork.completedAt, fieldWork.progressEventAt, fieldWork.startedAt, fieldWork.createdInFieldAt)), summary, details, alerts, link: url ? { label: 'Abrir a obra no Field', to: url } : null },
    field,
  };
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatHours(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)} h`;
}

function closedStage(input: JourneyInput): JourneyStage {
  const { project, fieldWork } = input;
  const base = { key: 'encerrado' as const, label: JOURNEY_STAGE_LABEL.encerrado };
  if (project.status === 'encerrado') {
    return { ...base, state: 'feito', date: iso(project.updatedAt), summary: 'Projeto encerrado', details: [], alerts: [], link: null };
  }
  if (fieldWork?.completedAt) {
    return {
      ...base,
      state: 'atencao',
      date: null,
      summary: 'Obra concluída no Field: falta encerrar o projeto',
      details: [],
      alerts: ['A obra foi concluída no Field. Encerrar o projeto continua sendo manual.'],
      link: null,
    };
  }
  return { ...base, state: 'pendente', date: null, summary: 'Encerrar o projeto é manual, depois da obra', details: [], alerts: [], link: null };
}

export function buildJourney(input: JourneyInput): ProjectJourney {
  const { project } = input;
  const request = requestStage(input);
  const field = fieldStage(input);
  const stages: JourneyStage[] = [quoteStage(input), approvedStage(input), request.stage, field.stage, closedStage(input)];
  // Projeto encerrado: a jornada acabou, mesmo que alguma etapa anterior nunca tenha acontecido.
  const current = project.status === 'encerrado' ? 'encerrado' : (stages.find((s) => s.state !== 'feito')?.key ?? 'encerrado');
  return {
    projectId: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
    currentStage: current,
    stages,
    shipment: request.shipment,
    field: field.field,
    financeiroUrl: financeiroResultUrl(input.financeiroFrontendUrl, project.id),
  };
}

/** Selo curto da etapa atual para a lista de projetos. */
export function currentStageSummary(journey: Pick<ProjectJourney, 'currentStage' | 'stages'>): { key: JourneyStageKey; label: string; state: JourneyState } {
  const stage = journey.stages.find((s) => s.key === journey.currentStage)!;
  return { key: stage.key, label: stage.label, state: stage.state };
}
