import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildJourney, currentStageSummary, financeiroResultUrl, resolveFieldUrl, type JourneyInput } from './project-journey.js';
import { ProjectJourneyService } from './project-journey.service.js';
import type { ShipmentData } from '../requests/envio-material.js';
import type { ShipmentLogistics } from '../requests/envio-logistica.js';

/** Agregador da jornada do projeto (PT-11): regra pura (`buildJourney`) e carga em lote com Prisma simulado. */

const D = (iso: string) => new Date(iso);
const dec = (value: string) => new Prisma.Decimal(value);

const SHIPMENT: ShipmentData = {
  projectQuoteId: 'q-1',
  recipientCollaboratorId: 'col-resp',
  recipientName: 'Carla',
  neededBy: '2026-11-30',
  destination: { siteId: 'site-1', siteCode: 'GRU53', siteName: 'Aeroporto GRU', address: null, city: null, state: null, latitude: null, longitude: null },
  items: [
    { materialCode: 'CAB', logisticsMaterialId: null, description: 'Cabo óptico', unit: 'm', quantity: '1200.000' },
    { materialCode: 'CON', logisticsMaterialId: null, description: 'Conector', unit: 'un', quantity: '40.000' },
  ],
  warnings: [],
  approvedAt: '2026-11-09T10:00:00.000Z',
};

const LOGISTICS: ShipmentLogistics = {
  orderId: 'ord-1',
  orderCode: 'ATD-00000007',
  requestVersion: 1,
  status: 'RESERVADA',
  statusReason: null,
  statusAt: '2026-11-10T10:00:00.000Z',
  stage: 1,
  items: [
    { materialCode: 'CAB', description: 'Cabo óptico', unit: 'm', quantity: '1200.000', reserved: '1200.000', shortage: '0.000' },
    { materialCode: 'CON', description: 'Conector', unit: 'un', quantity: '40.000', reserved: '40.000', shortage: '0.000' },
  ],
  shipments: [],
  deliveries: [],
  refusals: [],
  dispatchedAt: null,
  deliveredAt: null,
  seenEventIds: [],
};

function input(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    project: { id: 'p-1', code: 'PROP-7.012-1126', name: 'Cabeamento DC', status: 'proposta', siteId: 'site-1', site: { code: 'GRU53', name: 'Aeroporto GRU' }, updatedAt: D('2026-11-01T00:00:00Z') },
    quoteRequests: [],
    quotes: [],
    acceptance: null,
    request: null,
    fieldWork: null,
    fieldFrontendUrl: null,
    financeiroFrontendUrl: null,
    ...overrides,
  };
}

const quote = (revisionNumber: number, receivedAt = '2026-11-05T12:00:00Z', materialsCount = 2) => ({ id: `q-${revisionNumber}`, revisionNumber, receivedAt: D(receivedAt), materialsCount });
const acceptance = { projectQuoteId: 'q-2', revisionNumber: 2, clientPoNumber: 'PO-77', acceptedAt: D('2026-11-08T15:00:00Z'), acceptedByEmail: 'comercial@lgc.com.br' };

function request(overrides: Record<string, unknown> = {}, logistics?: Partial<ShipmentLogistics>) {
  return {
    id: 'req-1',
    code: 'REQ-2026-000007',
    status: 'em_atendimento' as const,
    createdAt: D('2026-11-08T15:00:01Z'),
    closedAt: null,
    neededBy: D('2026-11-30T00:00:00Z'),
    formData: { shipment: { ...SHIPMENT, ...(logistics ? { logistics: { ...LOGISTICS, ...logistics } } : {}) } } as never,
    approvals: [{ status: 'aprovado', approverName: 'Carla Responsável', decidedAt: D('2026-11-09T10:00:00Z') }],
    ...overrides,
  };
}

const fieldWork = (overrides: Record<string, unknown> = {}) => ({
  fieldProjectId: '42',
  fieldProjectCode: 'CSTR-PROJ-0042',
  url: 'https://field.lgc.local/projetos/42',
  sowPlanStatus: 'generated',
  tasksCount: 12,
  createdInFieldAt: D('2026-11-09T10:00:00Z'),
  startedAt: null,
  completedAt: null,
  progressDate: null,
  progressEventAt: null,
  percentComplete: null,
  tasksTotal: null,
  tasksDone: null,
  realManHours: null,
  plannedManHours: null,
  ...overrides,
});

const stage = (journey: ReturnType<typeof buildJourney>, key: string) => journey.stages.find((s) => s.key === key)!;

describe('buildJourney — cotação e aprovação', () => {
  it('proposta sem pedido de cotação: tudo pendente e a etapa atual é a cotação', () => {
    const journey = buildJourney(input());
    expect(journey.stages.map((s) => [s.key, s.state])).toEqual([
      ['cotacao', 'pendente'],
      ['aprovado', 'pendente'],
      ['requisicao', 'pendente'],
      ['obra', 'pendente'],
      ['encerrado', 'pendente'],
    ]);
    expect(journey.currentStage).toBe('cotacao');
    expect(stage(journey, 'cotacao').summary).toBe('Cotação ainda não solicitada ao Financeiro');
    expect(journey.financeiroUrl).toBeNull();
  });

  it('cotação pedida e não devolvida: em andamento com a data do pedido', () => {
    const journey = buildJourney(input({ quoteRequests: [{ createdAt: D('2026-11-02T09:00:00Z') }, { createdAt: D('2026-11-03T09:00:00Z') }] }));
    expect(stage(journey, 'cotacao')).toMatchObject({ state: 'em_andamento', date: '2026-11-03T09:00:00.000Z', summary: 'Aguardando o Financeiro devolver a cotação' });
    expect(journey.currentStage).toBe('cotacao');
  });

  it('cotação recebida: feita, mostra a revisão vigente; a etapa atual passa a ser a aprovação', () => {
    const journey = buildJourney(input({ quotes: [quote(2), quote(1, '2026-11-03T12:00:00Z')], quoteRequests: [{ createdAt: D('2026-11-02T09:00:00Z') }] }));
    const cotacao = stage(journey, 'cotacao');
    expect(cotacao.state).toBe('feito');
    expect(cotacao.date).toBe('2026-11-05T12:00:00.000Z');
    expect(cotacao.details).toEqual(expect.arrayContaining([{ label: 'Revisão vigente', value: '2' }, { label: 'Revisões recebidas', value: '2' }, { label: 'Materiais na revisão vigente', value: '2' }]));
    expect(journey.currentStage).toBe('aprovado');
    expect(stage(journey, 'aprovado').state).toBe('pendente');
  });

  it('cotação recebida e projeto sem site: avisa que falta o site para aprovar', () => {
    const journey = buildJourney(input({ quotes: [quote(1)], project: { ...input().project, siteId: null, site: null } }));
    expect(stage(journey, 'aprovado').alerts).toEqual(['Informe o site do projeto para poder aprovar.']);
  });

  it('aprovado: data, revisão aceita, PO, quem aprovou e o site', () => {
    const journey = buildJourney(input({ quotes: [quote(2)], acceptance, project: { ...input().project, status: 'aprovado' } }));
    const aprovado = stage(journey, 'aprovado');
    expect(aprovado).toMatchObject({ state: 'feito', date: '2026-11-08T15:00:00.000Z' });
    expect(aprovado.summary).toContain('revisão 2 aceita');
    expect(aprovado.details).toEqual(
      expect.arrayContaining([
        { label: 'Revisão aceita', value: '2' },
        { label: 'PO do cliente', value: 'PO-77' },
        { label: 'Aprovado por', value: 'comercial@lgc.com.br' },
        { label: 'Site', value: 'GRU53 — Aeroporto GRU' },
      ]),
    );
  });
});

describe('buildJourney — requisição de envio', () => {
  const approved = { quotes: [quote(2)], acceptance, project: { ...input().project, status: 'aprovado' as const } };

  it('aprovado sem materiais na cotação: sem requisição, etapa feita com a explicação', () => {
    const journey = buildJourney(input({ ...approved, request: null }));
    expect(stage(journey, 'requisicao')).toMatchObject({ state: 'feito', summary: 'A cotação aceita não tem materiais: nenhum envio necessário' });
    expect(journey.shipment).toBeNull();
    expect(journey.currentStage).toBe('obra');
  });

  it('aguardando aprovação do CC: em andamento citando o aprovador; sem aprovador: atenção', () => {
    const waiting = buildJourney(input({ ...approved, request: request({ status: 'aguardando_aprovacao', approvals: [{ status: 'pendente', approverName: 'Carla Responsável', decidedAt: null }] }) }));
    expect(stage(waiting, 'requisicao')).toMatchObject({ state: 'em_andamento', summary: 'Aguardando aprovação de Carla Responsável' });
    expect(stage(waiting, 'requisicao').details).toEqual(expect.arrayContaining([{ label: 'Aprovação do centro de custo', value: 'Pendente — Carla Responsável' }]));
    expect(waiting.currentStage).toBe('requisicao');

    const without = buildJourney(input({ ...approved, request: request({ status: 'aguardando_aprovacao', approvals: [] }) }));
    expect(stage(without, 'requisicao').state).toBe('atencao');
    expect(stage(without, 'requisicao').alerts[0]).toContain('Sem aprovador');
  });

  it('reprovada pelo CC: atenção, nada foi à Logística', () => {
    const journey = buildJourney(input({ ...approved, request: request({ status: 'reprovada', approvals: [{ status: 'reprovado', approverName: 'Carla Responsável', decidedAt: D('2026-11-09T10:00:00Z') }] }) }));
    expect(stage(journey, 'requisicao').state).toBe('atencao');
    expect(stage(journey, 'requisicao').alerts[0]).toContain('reprovou');
  });

  it('AGUARDANDO_ESTOQUE com falta: atenção (PA-11), com as faltas por item', () => {
    const journey = buildJourney(
      input({
        ...approved,
        request: request({}, {
          status: 'AGUARDANDO_ESTOQUE',
          items: [
            { materialCode: 'CAB', description: 'Cabo óptico', unit: 'm', quantity: '1200.000', reserved: '0.000', shortage: '1200.000' },
            { materialCode: 'CON', description: 'Conector', unit: 'un', quantity: '40.000', reserved: '40.000', shortage: '0.000' },
          ],
        }),
      }),
    );
    const requisicao = stage(journey, 'requisicao');
    expect(requisicao.state).toBe('atencao');
    expect(requisicao.alerts.join(' ')).toContain('Falta material no estoque');
    expect(requisicao.alerts.join(' ')).toContain('aguarda estoque');
    expect(requisicao.details).toEqual(expect.arrayContaining([{ label: 'Faltas', value: 'CAB: 1200 de 1200' }, { label: 'Situação na Logística', value: 'Aguardando estoque — ordem ATD-00000007' }]));
    expect(journey.shipment).toMatchObject({ requestId: 'req-1', shortages: 1, delivered: 0, total: 1240 });
    expect(journey.shipment!.items[0]).toMatchObject({ materialCode: 'CAB', shortage: '1200.000' });
  });

  it('expedido e entrega parcial: em andamento com romaneio, transportadora e o entregue somado', () => {
    const journey = buildJourney(
      input({
        ...approved,
        request: request({ status: 'aguardando_entrega' }, {
          status: 'EXPEDIDA',
          stage: 2,
          dispatchedAt: '2026-11-12T13:00:00.000Z',
          shipments: [{ shipmentId: 'sh-1', shipmentCode: 'EXP-1', manifest: 'ROM-9', carrier: 'Rápido', route: null, vehicle: null, dispatchedAt: '2026-11-12T13:00:00.000Z', packages: 3, items: [] }],
          deliveries: [
            { eventId: 'e1', shipmentId: 'sh-1', complete: false, deliveredAt: '2026-11-13T10:00:00.000Z', receiverName: null, pendingPackages: 1, items: [{ materialCode: 'CAB', quantity: '800.000' }] },
            { eventId: 'e2', shipmentId: 'sh-1', complete: false, deliveredAt: '2026-11-14T10:00:00.000Z', receiverName: null, pendingPackages: 1, items: [{ materialCode: 'CAB', quantity: '200.000' }, { materialCode: 'CON', quantity: '10.000' }] },
          ],
        }),
      }),
    );
    const requisicao = stage(journey, 'requisicao');
    expect(requisicao.state).toBe('em_andamento');
    expect(requisicao.summary).toBe('Logística: Expedida (ATD-00000007)');
    expect(requisicao.details).toEqual(expect.arrayContaining([{ label: 'Expedido em', value: '12/11/2026' }, { label: 'Romaneio', value: 'ROM-9' }, { label: 'Transportadora', value: 'Rápido' }]));
    expect(journey.shipment).toMatchObject({ delivered: 1010, total: 1240, shortages: 0 });
    expect(journey.shipment!.items.map((i) => [i.materialCode, i.delivered])).toEqual([['CAB', '1000.000'], ['CON', '10.000']]);
  });

  it('depois de entregue, a falta registrada na reserva deixa de contar', () => {
    const journey = buildJourney(
      input({
        ...approved,
        request: request({ status: 'encerrada', closedAt: D('2026-11-14T10:00:00Z') }, {
          status: 'ENTREGUE',
          stage: 3,
          deliveredAt: '2026-11-14T10:00:00.000Z',
          items: [{ materialCode: 'CAB', description: 'Cabo óptico', unit: 'm', quantity: '1200.000', reserved: '900.000', shortage: '300.000' }],
        }),
      }),
    );
    expect(stage(journey, 'requisicao').state).toBe('feito');
    expect(stage(journey, 'requisicao').alerts).toEqual([]);
    expect(journey.shipment).toMatchObject({ shortages: 0 });
  });

  it('entrega recusada no site: atenção com o motivo', () => {
    const journey = buildJourney(input({ ...approved, request: request({ status: 'aguardando_entrega' }, { status: 'DIVERGENCIA', stage: 2, refusals: [{ eventId: 'r1', shipmentId: 'sh-1', refusedAt: null, reason: 'Caixas avariadas', items: [] }] }) }));
    expect(stage(journey, 'requisicao').state).toBe('atencao');
    expect(stage(journey, 'requisicao').alerts.join(' ')).toContain('Caixas avariadas');
  });

  it('entregue: feita, com a data do encerramento; a etapa atual passa a ser a obra', () => {
    const journey = buildJourney(input({ ...approved, request: request({ status: 'encerrada', closedAt: D('2026-11-14T10:00:00Z') }, { status: 'ENTREGUE', stage: 3, deliveredAt: '2026-11-14T10:00:00.000Z' }) }));
    expect(stage(journey, 'requisicao')).toMatchObject({ state: 'feito', date: '2026-11-14T10:00:00.000Z', summary: 'Entregue no site (ordem ATD-00000007)' });
    expect(stage(journey, 'requisicao').link).toEqual({ label: 'Abrir a requisição', to: '/requests/req-1' });
    expect(journey.currentStage).toBe('obra');
    expect(stage(journey, 'obra')).toMatchObject({ state: 'pendente', summary: 'Aguardando o Field criar a obra' });
  });
});

describe('buildJourney — obra no Field e encerramento', () => {
  const done = {
    quotes: [quote(2)],
    acceptance,
    request: request({ status: 'encerrada', closedAt: D('2026-11-14T10:00:00Z') }, { status: 'ENTREGUE', stage: 3, deliveredAt: '2026-11-14T10:00:00.000Z' }),
    project: { ...input().project, status: 'aprovado' as const },
  };

  it('obra criada sem tarefa iniciada: em andamento, com link, plano e tarefas', () => {
    const journey = buildJourney(input({ ...done, fieldWork: fieldWork() }));
    const obra = stage(journey, 'obra');
    expect(obra).toMatchObject({ state: 'em_andamento', link: { label: 'Abrir a obra no Field', to: 'https://field.lgc.local/projetos/42' } });
    expect(obra.summary).toContain('Obra criada no Field com 12 tarefas');
    expect(obra.details).toEqual(expect.arrayContaining([{ label: 'Obra no Field', value: 'CSTR-PROJ-0042' }, { label: 'Plano da SOW', value: 'Plano gerado' }]));
    expect(journey.field).toMatchObject({ url: 'https://field.lgc.local/projetos/42', percentComplete: null });
  });

  it('em execução: percentual, tarefas e HH real × previsto (sem nenhum valor em dinheiro)', () => {
    const journey = buildJourney(input({ ...done, project: { ...done.project, status: 'em_execucao' }, fieldWork: fieldWork({ startedAt: D('2026-11-15T08:00:00Z'), progressDate: D('2026-11-16T00:00:00Z'), progressEventAt: D('2026-11-16T22:00:00Z'), percentComplete: dec('25.50'), tasksTotal: 12, tasksDone: 3, realManHours: dec('40.5'), plannedManHours: dec('400') }) }));
    const obra = stage(journey, 'obra');
    expect(obra.state).toBe('em_andamento');
    expect(obra.summary).toBe('Em execução — 25,5% concluído');
    expect(obra.details).toEqual(expect.arrayContaining([{ label: 'Tarefas', value: '3 de 12 concluídas' }, { label: 'HH real × previsto', value: '40,5 h × 400 h' }, { label: 'Início real', value: '15/11/2026' }]));
    expect(journey.field).toMatchObject({ percentComplete: 25.5, tasksDone: 3, tasksTotal: 12, realManHours: 40.5, plannedManHours: 400 });
    expect(journey.currentStage).toBe('obra');
    // Nada de custo, margem, salário ou valor monetário no que sai do Core.
    // "centro de custo" é o cadastro, não um valor: só procuramos dinheiro, margem e salário.
    const found = JSON.stringify(journey).match(/cost[^_]|custo (real|previsto|médio)|margem|margin|salar|estimated|price|preco|preço|R\$/i);
    expect(found?.[0] ?? null).toBeNull();
  });

  it('plano da SOW aguardando revisão ou HH acima do previsto: atenção', () => {
    const review = buildJourney(input({ ...done, fieldWork: fieldWork({ sowPlanStatus: 'pending_review' }) }));
    expect(stage(review, 'obra').state).toBe('atencao');
    expect(stage(review, 'obra').alerts[0]).toContain('aguardando revisão');
    const over = buildJourney(input({ ...done, fieldWork: fieldWork({ startedAt: D('2026-11-15T08:00:00Z'), percentComplete: dec('50'), realManHours: dec('500'), plannedManHours: dec('400') }) }));
    expect(stage(over, 'obra')).toMatchObject({ state: 'atencao', alerts: ['HH real acima do previsto.'] });
  });

  it('link relativo do Field usa a URL de frontend do satélite; sem ela, sem link', () => {
    expect(resolveFieldUrl('/projetos/42', 'https://field.lgc.local/')).toBe('https://field.lgc.local/projetos/42');
    expect(resolveFieldUrl('/projetos/42', null)).toBeNull();
    expect(resolveFieldUrl('http://x/y', null)).toBe('http://x/y');
    expect(resolveFieldUrl(null, 'https://field')).toBeNull();
    const journey = buildJourney(input({ ...done, fieldFrontendUrl: 'https://field.lgc.local', fieldWork: fieldWork({ url: '/projetos/42' }) }));
    expect(stage(journey, 'obra').link?.to).toBe('https://field.lgc.local/projetos/42');
    expect(stage(buildJourney(input({ ...done, fieldWork: fieldWork({ url: '/projetos/42' }) })), 'obra').link).toBeNull();
  });

  it('obra concluída com o projeto ainda aberto: obra feita e atenção para encerrar (encerrar é manual)', () => {
    const journey = buildJourney(input({ ...done, project: { ...done.project, status: 'em_execucao' }, fieldWork: fieldWork({ startedAt: D('2026-11-15T08:00:00Z'), completedAt: D('2026-11-30T17:00:00Z'), percentComplete: dec('100') }) }));
    expect(stage(journey, 'obra')).toMatchObject({ state: 'feito', summary: 'Obra concluída no Field', date: '2026-11-30T17:00:00.000Z' });
    expect(stage(journey, 'encerrado')).toMatchObject({ state: 'atencao', summary: 'Obra concluída no Field: falta encerrar o projeto' });
    expect(journey.currentStage).toBe('encerrado');
    expect(currentStageSummary(journey)).toEqual({ key: 'encerrado', label: 'Encerrado', state: 'atencao' });
  });

  it('projeto encerrado: jornada terminada, mesmo se alguma etapa nunca aconteceu', () => {
    const journey = buildJourney(input({ project: { ...input().project, status: 'encerrado', updatedAt: D('2026-12-05T12:00:00Z') } }));
    expect(journey.currentStage).toBe('encerrado');
    expect(stage(journey, 'encerrado')).toMatchObject({ state: 'feito', date: '2026-12-05T12:00:00.000Z' });
    expect(currentStageSummary(journey)).toEqual({ key: 'encerrado', label: 'Encerrado', state: 'feito' });
  });

  it('link para o resultado no Financeiro só existe com URL configurada', () => {
    expect(financeiroResultUrl(null, 'p-1')).toBeNull();
    expect(financeiroResultUrl('https://fin.lgc.local/', 'p-1')).toBe('https://fin.lgc.local/#/projetos/p-1');
    expect(buildJourney(input({ financeiroFrontendUrl: 'https://fin.lgc.local' })).financeiroUrl).toBe('https://fin.lgc.local/#/projetos/p-1');
  });
});

describe('ProjectJourneyService', () => {
  function fixture() {
    const project = {
      id: 'p-1', code: 'PROP-1', name: 'Projeto', status: 'aprovado', siteId: 'site-1', updatedAt: D('2026-11-01T00:00:00Z'),
      site: { code: 'GRU53', name: 'GRU' },
      quotes: [{ id: 'q-2', revisionNumber: 2, receivedAt: D('2026-11-05T12:00:00Z'), _count: { materials: 2 } }],
      quoteRequests: [{ createdAt: D('2026-11-02T09:00:00Z') }],
      acceptance: { projectQuoteId: 'q-2', clientPoNumber: 'PO-77', acceptedAt: D('2026-11-08T15:00:00Z'), projectQuote: { revisionNumber: 2 }, acceptedBy: { email: 'comercial@lgc.com.br' } },
      fieldWork: null,
    };
    const other = { ...project, id: 'p-2', code: 'PROP-2', status: 'proposta', quotes: [], quoteRequests: [], acceptance: null };
    const prisma: any = {
      project: { findMany: vi.fn(async ({ where }) => [project, other].filter((p) => where.id.in.includes(p.id))) },
      request: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'req-1', code: 'REQ-1', status: 'aguardando_aprovacao', projectId: 'p-1', sourceRef: 'q-2', createdAt: D('2026-11-08T15:00:01Z'), closedAt: null, neededBy: null, formData: { shipment: SHIPMENT }, approvals: [{ status: 'pendente', decidedAt: null, stepOrder: 1, approver: { fullName: 'Carla' } }] },
        ]),
      },
      integrationSatellite: { findMany: vi.fn().mockResolvedValue([{ name: 'financeiro', frontendUrl: 'https://fin.lgc.local' }, { name: 'field', frontendUrl: null }]) },
    };
    return { service: new ProjectJourneyService(prisma), prisma };
  }

  it('monta a jornada de um projeto com a requisição achada pela cotação aceita', async () => {
    const { service } = fixture();
    const journey = await service.journey('p-1');
    expect(journey.currentStage).toBe('requisicao');
    expect(stage(journey, 'requisicao').summary).toBe('Aguardando aprovação de Carla');
    expect(journey.financeiroUrl).toBe('https://fin.lgc.local/#/projetos/p-1');
  });

  it('projeto inexistente: 404 em português', async () => {
    const { service } = fixture();
    await expect(service.journey('nao-existe')).rejects.toThrow(NotFoundException);
    await expect(service.journey('nao-existe')).rejects.toThrow('Projeto não encontrado.');
  });

  it('a etapa atual de vários projetos sai em lote: uma consulta por tabela', async () => {
    const { service, prisma } = fixture();
    const stages = await service.currentStages(['p-1', 'p-2']);
    expect(stages).toEqual({
      'p-1': { key: 'requisicao', label: 'Requisição de envio', state: 'em_andamento' },
      'p-2': { key: 'cotacao', label: 'Cotação', state: 'pendente' },
    });
    expect(prisma.project.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.request.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.integrationSatellite.findMany).toHaveBeenCalledTimes(1);
    expect(await service.currentStages([])).toEqual({});
  });
});
