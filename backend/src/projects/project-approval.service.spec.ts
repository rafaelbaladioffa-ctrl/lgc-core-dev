import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProjectApprovalService, projectApprovedPayload } from './project-approval.service.js';
import type { LogisticsLookup } from './logistics-materials.client.js';
import { subtractBusinessDays } from '../requests/envio-material.js';

/**
 * Aprovação do projeto (PT-06) com Prisma simulado: status + aceite + requisição de envio + outbox na mesma
 * transação, validações (site, cotação), idempotência e a Logística fora do ar.
 */

const SITE = {
  id: 'site-1',
  clientId: 'cl-1',
  code: 'GRU53',
  name: 'Aeroporto GRU',
  cep: '07190100',
  addressStreet: 'Rod. Hélio Smidt',
  addressNumber: 's/n',
  addressComplement: null,
  addressDistrict: 'Cumbica',
  addressCity: 'Guarulhos',
  addressState: 'SP',
  latitude: -23.4356,
  longitude: -46.4731,
  active: true,
};
const COST_CENTER = { id: 'cc-1', code: '100.1', name: 'Obras SP' };

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    code: 'PROP-7.012-1126',
    name: 'Cabeamento DC Campinas',
    clientId: 'cl-1',
    costCenterId: COST_CENTER.id,
    costCenter: COST_CENTER,
    responsibleCollaboratorId: 'col-resp',
    responsibleCollaborator: { id: 'col-resp', fullName: 'Carla Responsável' },
    siteId: SITE.id,
    site: SITE,
    plannedStartDate: new Date('2026-12-01T00:00:00Z'),
    plannedEndDate: new Date('2027-01-15T00:00:00Z'),
    status: 'proposta',
    proposalSequence: 12,
    ...overrides,
  };
}

const MATERIALS = [
  { id: 'qm-1', materialCode: 'RED-CAB-0123', logisticsMaterialId: null, description: 'Cabo óptico 12F', unit: 'm', quantity: new Prisma.Decimal('1200.000') },
  { id: 'qm-2', materialCode: 'RED-CON-0001', logisticsMaterialId: null, description: 'Conector LC', unit: 'un', quantity: new Prisma.Decimal('40.000') },
];

function quoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-2',
    projectId: 'p-1',
    externalRevisionId: 'rev-ext-2',
    revisionNumber: 2,
    sowDocumentId: 'doc-sow-1',
    workDays: new Prisma.Decimal('10.00'),
    plannedStartDate: new Date('2026-12-07T00:00:00Z'), // segunda-feira
    plannedEndDate: new Date('2026-12-18T00:00:00Z'),
    team: [{ role_key: 'tecnico', role_name: 'Técnico', field_role: true, people: 5, days: 10, hours: 400 }],
    materials: MATERIALS,
    ...overrides,
  };
}

const LOOKUP_OK: LogisticsLookup = {
  ok: true,
  notFound: [],
  materials: new Map([
    ['RED-CAB-0123', { id: 'mat-1', code: 'RED-CAB-0123', averageCost: '3.3000' }],
    ['RED-CON-0001', { id: 'mat-2', code: 'RED-CON-0001', averageCost: '12.5000' }],
  ]),
};

interface FixtureOptions {
  project?: Record<string, unknown> | null;
  quote?: Record<string, unknown> | null;
  lookup?: LogisticsLookup;
  existingRequest?: Record<string, unknown> | null;
  costCenter?: Record<string, unknown>;
  holidays?: Date[];
  config?: Record<string, string>;
}

function fixture(options: FixtureOptions = {}) {
  const project = options.project === undefined ? projectRow() : options.project;
  const quote = options.quote === undefined ? quoteRow() : options.quote;
  const prisma: any = {
    project: {
      findUnique: vi.fn().mockResolvedValue(project),
      update: vi.fn(async ({ data }) => ({ ...(project as object), ...data })),
    },
    projectQuote: { findFirst: vi.fn().mockResolvedValue(quote) },
    projectAcceptance: {
      create: vi.fn(async ({ data }) => ({ id: 'acc-1', ...data })),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    projectQuoteMaterial: { update: vi.fn() },
    projectDocument: { findFirst: vi.fn().mockResolvedValue({ id: 'doc-sow-3' }) },
    request: {
      findUnique: vi.fn().mockResolvedValue(options.existingRequest ?? null),
      create: vi.fn(async ({ data }) => ({ id: 'req-1', ...data })),
    },
    requestApproval: { create: vi.fn() },
    requestCategory: { findUnique: vi.fn().mockResolvedValue({ id: 'cat-1', sectorId: 'setor-alm', confidentiality: 'interna' }) },
    categoryVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'cv-1' }) },
    collaborator: { findUnique: vi.fn().mockResolvedValue({ id: 'col-sistema' }) },
    costCenter: {
      findUnique: vi.fn().mockResolvedValue(
        options.costCenter ?? { responsibleCollaborator: { id: 'col-cc', status: 'ativo' }, parentCostCenter: null },
      ),
    },
    queue: { findFirst: vi.fn().mockResolvedValue({ id: 'queue-1' }) },
    holiday: { findMany: vi.fn().mockResolvedValue((options.holidays ?? []).map((date) => ({ date }))) },
    auditEvent: { create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ last_value: 7 }]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const logistics = { lookup: vi.fn().mockResolvedValue(options.lookup ?? LOOKUP_OK) };
  const config = { get: vi.fn((key: string) => options.config?.[key]) };
  const service = new ProjectApprovalService(prisma, outbox as any, logistics as any, config as any);
  const events = () => outbox.record.mock.calls.map((c: any[]) => c[1] as string);
  const payload = (type: string) => outbox.record.mock.calls.find((c: any[]) => c[1] === type)?.[2] as Record<string, any>;
  return { service, prisma, outbox, logistics, events, payload };
}

describe('ProjectApprovalService.approve — validações', () => {
  it('projeto sem site → 400 em pt-BR, sem gravar nada', async () => {
    const { service, prisma, outbox } = fixture({ project: projectRow({ siteId: null, site: null }) });
    await expect(service.approve('p-1', {}, 'user-1')).rejects.toThrow(new BadRequestException('Informe o site do projeto antes de aprovar.'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('site inativo → 400', async () => {
    const { service } = fixture({ project: projectRow({ site: { ...SITE, active: false } }) });
    await expect(service.approve('p-1', {}, 'user-1')).rejects.toThrow(/site do projeto está inativo/);
  });

  it('sem cotação recebida → 400', async () => {
    const { service } = fixture({ quote: null });
    await expect(service.approve('p-1', {}, 'user-1')).rejects.toThrow(
      new BadRequestException('O projeto não tem cotação recebida do Financeiro. Solicite a cotação antes de aprovar.'),
    );
  });

  it('cotação informada de outro projeto → 400', async () => {
    const { service, prisma } = fixture({ quote: null });
    await expect(service.approve('p-1', { acceptedQuoteId: 'q-de-outro' }, 'user-1')).rejects.toThrow('A cotação informada não pertence ao projeto.');
    expect(prisma.projectQuote.findFirst.mock.calls[0][0].where).toEqual({ id: 'q-de-outro', projectId: 'p-1' });
  });

  it.each(['aprovado', 'em_execucao', 'encerrado'])('projeto em %s não aprova de novo', async (status) => {
    const { service } = fixture({ project: projectRow({ status }) });
    await expect(service.approve('p-1', {}, 'user-1')).rejects.toThrow(`Não é possível mudar o projeto de "${status}" para "aprovado".`);
  });

  it('a cotação padrão é a vigente (maior revisão)', async () => {
    const { service, prisma } = fixture();
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.projectQuote.findFirst.mock.calls[0][0]).toMatchObject({ where: { projectId: 'p-1' }, orderBy: { revisionNumber: 'desc' } });
  });
});

describe('ProjectApprovalService.approve — mesma transação', () => {
  it('grava status, aceite, requisição e os três eventos do outbox', async () => {
    const { service, prisma, events } = fixture();
    const result = await service.approve('p-1', { clientPoNumber: 'PO-4500123' }, 'user-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.project.update.mock.calls[0][0].data).toEqual({ status: 'aprovado' });
    expect(prisma.projectAcceptance.create.mock.calls[0][0].data).toMatchObject({
      projectId: 'p-1',
      projectQuoteId: 'q-2',
      clientPoNumber: 'PO-4500123',
      acceptedByUserId: 'user-1',
    });
    expect(prisma.request.create).toHaveBeenCalledTimes(1);
    expect(events()).toEqual(['project.status_changed', 'project.approved', 'request.submitted']);
    expect(result.materialRequest).toMatchObject({ id: 'req-1', status: 'aguardando_aprovacao' });
    expect(result.withoutMaterials).toBe(false);
  });

  it('requisição: solicitante = sistema (sem beneficiário próprio), CC do projeto, origem e chave únicas, destino e itens', async () => {
    const { service, prisma } = fixture();
    await service.approve('p-1', {}, 'user-1');
    const data = prisma.request.create.mock.calls[0][0].data;

    expect(data).toMatchObject({
      code: 'REQ-' + new Date().getFullYear() + '-000007',
      categoryVersionId: 'cv-1',
      requesterId: 'col-sistema',
      beneficiaryId: 'col-sistema',
      projectId: 'p-1',
      costCenterId: 'cc-1',
      status: 'aguardando_aprovacao',
      origin: 'projeto_aprovado',
      sourceRef: 'q-2',
    });
    expect(data.formData.shipment).toMatchObject({
      projectQuoteId: 'q-2',
      recipientCollaboratorId: 'col-resp',
      recipientName: 'Carla Responsável',
      approvedAt: null,
      destination: {
        siteId: 'site-1',
        siteCode: 'GRU53',
        address: 'Rod. Hélio Smidt, s/n, Cumbica, CEP 07190-100',
        city: 'Guarulhos',
        state: 'SP',
        latitude: -23.4356,
        longitude: -46.4731,
      },
      items: [
        { materialCode: 'RED-CAB-0123', logisticsMaterialId: 'mat-1', description: 'Cabo óptico 12F', unit: 'm', quantity: '1200.000' },
        { materialCode: 'RED-CON-0001', logisticsMaterialId: 'mat-2', description: 'Conector LC', unit: 'un', quantity: '40.000' },
      ],
      warnings: [],
    });
  });

  it('aprovador = responsável do CC do projeto, mesmo quando é o responsável do projeto (o solicitante é o sistema)', async () => {
    const { service, prisma } = fixture({ costCenter: { responsibleCollaborator: { id: 'col-resp', status: 'ativo' }, parentCostCenter: null } });
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.requestApproval.create.mock.calls[0][0].data).toMatchObject({
      requestId: 'req-1',
      stepOrder: 1,
      approverId: 'col-resp',
      approvalSource: 'centro_custo',
      completionRule: 'todos',
    });
  });

  it('sem responsável no CC, cai no responsável do CC pai', async () => {
    const { service, prisma } = fixture({
      costCenter: { responsibleCollaborator: null, parentCostCenter: { responsibleCollaborator: { id: 'col-pai', status: 'ativo' } } },
    });
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.requestApproval.create.mock.calls[0][0].data.approverId).toBe('col-pai');
    const submitted = prisma.auditEvent.create.mock.calls.map((c: any[]) => c[0].data).find((d: any) => d.event === 'request.submitted');
    expect(submitted.afterJson).toMatchObject({ approverId: 'col-pai', approverFallback: 'cc_pai' });
  });

  it('responsável desligado é pulado', async () => {
    const { service, prisma } = fixture({
      costCenter: { responsibleCollaborator: { id: 'col-saiu', status: 'desligado' }, parentCostCenter: { responsibleCollaborator: { id: 'col-pai', status: 'ativo' } } },
    });
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.requestApproval.create.mock.calls[0][0].data.approverId).toBe('col-pai');
  });

  it('sem nenhum responsável: fica aguardando_aprovacao sem linha de aprovação, com aviso e evento de auditoria (alerta ao admin)', async () => {
    const { service, prisma } = fixture({ costCenter: { responsibleCollaborator: null, parentCostCenter: null } });
    const result = await service.approve('p-1', {}, 'user-1');
    expect(prisma.requestApproval.create).not.toHaveBeenCalled();
    expect(result.materialRequest?.status).toBe('aguardando_aprovacao');
    const data = prisma.request.create.mock.calls[0][0].data;
    expect(data.formData.shipment.warnings[0]).toMatch(/^Sem responsável no centro de custo do projeto/);
    expect(prisma.auditEvent.create.mock.calls.map((c: any[]) => c[0].data.event)).toContain('request.shipment_without_approver');
  });

  it('resolve logistics_material_id nos materiais da cotação quando a Logística responde', async () => {
    const { service, prisma } = fixture();
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.projectQuoteMaterial.update).toHaveBeenCalledWith({ where: { id: 'qm-1' }, data: { logisticsMaterialId: 'mat-1' } });
    expect(prisma.projectQuoteMaterial.update).toHaveBeenCalledWith({ where: { id: 'qm-2' }, data: { logisticsMaterialId: 'mat-2' } });
  });
});

describe('ProjectApprovalService.approve — idempotência', () => {
  it('requisição já existente para (projeto_aprovado, cotação) não é duplicada', async () => {
    const existing = { id: 'req-antiga', code: 'REQ-2026-000001', status: 'em_atendimento' };
    const { service, prisma, payload } = fixture({ existingRequest: existing });
    const result = await service.approve('p-1', {}, 'user-1');
    expect(prisma.request.findUnique.mock.calls[0][0]).toEqual({ where: { origin_sourceRef: { origin: 'projeto_aprovado', sourceRef: 'q-2' } } });
    expect(prisma.request.create).not.toHaveBeenCalled();
    expect(prisma.requestApproval.create).not.toHaveBeenCalled();
    expect(result.materialRequest?.id).toBe('req-antiga');
    expect(payload('project.approved').material_request_id).toBe('req-antiga');
  });

  it('o índice (origin, source_ref) é a trava final: a transação trava a linha do projeto antes de reler o status', async () => {
    const { service, prisma } = fixture();
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE');
  });
});

describe('ProjectApprovalService.approve — sem materiais', () => {
  it('aprova o projeto e o aceite, mas não cria requisição nem emite request.submitted', async () => {
    const { service, prisma, events, payload, logistics } = fixture({ quote: quoteRow({ materials: [] }) });
    const result = await service.approve('p-1', {}, 'user-1');
    expect(prisma.project.update).toHaveBeenCalled();
    expect(prisma.projectAcceptance.create).toHaveBeenCalled();
    expect(prisma.request.create).not.toHaveBeenCalled();
    expect(logistics.lookup).not.toHaveBeenCalled();
    expect(events()).toEqual(['project.status_changed', 'project.approved']);
    expect(payload('project.approved').material_request_id).toBeNull();
    expect(result).toMatchObject({ materialRequest: null, withoutMaterials: true });
  });
});

describe('ProjectApprovalService.approve — valor estimado e Logística', () => {
  it('Σ quantidade × averageCost consultado na Logística (1200 × 3,30 + 40 × 12,50 = 4.460,00)', async () => {
    const { service, prisma, logistics } = fixture();
    await service.approve('p-1', {}, 'user-1');
    expect(logistics.lookup).toHaveBeenCalledWith(['RED-CAB-0123', 'RED-CON-0001']);
    expect(prisma.request.create.mock.calls[0][0].data.estimatedValue.toFixed(2)).toBe('4460.00');
  });

  it('Logística fora do ar: valor 0, aviso na requisição, aprovação segue', async () => {
    const { service, prisma, events } = fixture({ lookup: { ok: false, reason: 'A Logística não respondeu à consulta de materiais.' } });
    const result = await service.approve('p-1', {}, 'user-1');
    const data = prisma.request.create.mock.calls[0][0].data;
    expect(data.estimatedValue.toFixed(2)).toBe('0.00');
    expect(data.formData.shipment.warnings).toEqual(['Valor estimado não calculado (ficou em R$ 0,00): A Logística não respondeu à consulta de materiais.']);
    expect(prisma.projectQuoteMaterial.update).not.toHaveBeenCalled();
    expect(events()).toContain('project.approved');
    expect(result.materialRequest).not.toBeNull();
  });

  it('material fora da Logística ou sem custo médio: avisos e conta como zero', async () => {
    const lookup: LogisticsLookup = {
      ok: true,
      notFound: ['RED-CON-0001'],
      materials: new Map([['RED-CAB-0123', { id: 'mat-1', code: 'RED-CAB-0123', averageCost: null }]]),
    };
    const { service, prisma } = fixture({ lookup });
    await service.approve('p-1', {}, 'user-1');
    const data = prisma.request.create.mock.calls[0][0].data;
    expect(data.estimatedValue.toFixed(2)).toBe('0.00');
    expect(data.formData.shipment.warnings).toEqual([
      'Material não encontrado ou inativo na Logística: RED-CON-0001. A Logística recusará a ordem até o cadastro ser corrigido.',
      'Sem custo médio na Logística (contam como zero no valor estimado): RED-CAB-0123.',
    ]);
  });
});

describe('ProjectApprovalService.approve — data de necessidade', () => {
  it('início previsto da cotação aceita − 5 dias úteis (segunda 07/12 → segunda 30/11)', async () => {
    const { service, prisma } = fixture();
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.request.create.mock.calls[0][0].data.formData.shipment.neededBy).toBe('2026-11-30');
    expect(prisma.request.create.mock.calls[0][0].data.neededBy).toEqual(new Date('2026-11-30T00:00:00Z'));
  });

  it('pula feriado cadastrado', async () => {
    const { service, prisma } = fixture({ holidays: [new Date('2026-12-04T00:00:00Z')] }); // sexta
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.request.create.mock.calls[0][0].data.formData.shipment.neededBy).toBe('2026-11-27');
  });

  it('a folga é configurável (SHIPMENT_LEAD_BUSINESS_DAYS)', async () => {
    const { service, prisma } = fixture({ config: { SHIPMENT_LEAD_BUSINESS_DAYS: '2' } });
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.request.create.mock.calls[0][0].data.formData.shipment.neededBy).toBe('2026-12-03');
  });

  it('sem início na cotação usa o do projeto; sem nenhum, não há data de necessidade', async () => {
    const withProjectStart = fixture({ quote: quoteRow({ plannedStartDate: null }) });
    await withProjectStart.service.approve('p-1', {}, 'user-1');
    expect(withProjectStart.prisma.request.create.mock.calls[0][0].data.formData.shipment.neededBy).toBe('2026-11-24');

    const none = fixture({ quote: quoteRow({ plannedStartDate: null }), project: projectRow({ plannedStartDate: null }) });
    await none.service.approve('p-1', {}, 'user-1');
    expect(none.prisma.request.create.mock.calls[0][0].data.formData.shipment.neededBy).toBeNull();
    expect(none.prisma.request.create.mock.calls[0][0].data.neededBy).toBeUndefined();
  });

  it('subtractBusinessDays ignora fim de semana', () => {
    expect(subtractBusinessDays(new Date('2026-12-07T00:00:00Z'), 1, new Set()).toISOString().slice(0, 10)).toBe('2026-12-04');
    expect(subtractBusinessDays(new Date('2026-12-07T00:00:00Z'), 0, new Set()).toISOString().slice(0, 10)).toBe('2026-12-07');
  });
});

describe('project.approved — payload (§4.2)', () => {
  it('estado completo do projeto + site, accepted_quote, PO, requisição e quem aprovou', async () => {
    const { service, payload } = fixture();
    await service.approve('p-1', { clientPoNumber: 'PO-4500123' }, 'user-1');
    const p = payload('project.approved');
    const { approved_at, ...rest } = p;
    expect(new Date(approved_at).toString()).not.toBe('Invalid Date');
    expect(rest).toEqual({
      project_id: 'p-1',
      code: 'PROP-7.012-1126',
      name: 'Cabeamento DC Campinas',
      status: 'aprovado',
      client_id: 'cl-1',
      cost_center_id: 'cc-1',
      cost_center_code: '100.1',
      cost_center_name: 'Obras SP',
      site_id: 'site-1',
      site_code: 'GRU53',
      site_name: 'Aeroporto GRU',
      responsible_collaborator_id: 'col-resp',
      planned_start_date: '2026-12-01',
      planned_end_date: '2027-01-15',
      site: {
        site_id: 'site-1',
        code: 'GRU53',
        name: 'Aeroporto GRU',
        cep: '07190100',
        address_street: 'Rod. Hélio Smidt',
        address_number: 's/n',
        address_complement: null,
        address_district: 'Cumbica',
        address_city: 'Guarulhos',
        address_state: 'SP',
        latitude: -23.4356,
        longitude: -46.4731,
      },
      accepted_quote: {
        project_quote_id: 'q-2',
        external_revision_id: 'rev-ext-2',
        revision_number: 2,
        work_days: 10,
        planned_start_date: '2026-12-07',
        planned_end_date: '2026-12-18',
        team: [{ role_key: 'tecnico', role_name: 'Técnico', field_role: true, people: 5, days: 10, hours: 400 }],
        sow_document_id: 'doc-sow-1',
      },
      client_po_number: 'PO-4500123',
      material_request_id: 'req-1',
      approved_by_user_id: 'user-1',
    });
  });

  it('cotação sem SOW (modelo genérico): project.approved leva a SOW mais recente do projeto', async () => {
    const { service, payload, prisma } = fixture({ quote: quoteRow({ sowDocumentId: null }) });
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.projectDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'p-1', kind: 'sow' }, orderBy: { version: 'desc' } }));
    expect(payload('project.approved').accepted_quote.sow_document_id).toBe('doc-sow-3');
  });

  it('cotação com SOW: project.approved mantém a SOW usada na cotação', async () => {
    const { service, payload, prisma } = fixture();
    await service.approve('p-1', {}, 'user-1');
    expect(prisma.projectDocument.findFirst).not.toHaveBeenCalled();
    expect(payload('project.approved').accepted_quote.sow_document_id).toBe('doc-sow-1');
  });

  it('project.status_changed leva previous_status proposta e o estado já aprovado', async () => {
    const { service, payload } = fixture();
    await service.approve('p-1', {}, 'user-1');
    expect(payload('project.status_changed')).toMatchObject({ project_id: 'p-1', status: 'aprovado', previous_status: 'proposta' });
  });

  it('projectApprovedPayload sem PO nem requisição leva null nos dois', () => {
    const p = projectApprovedPayload(projectRow() as any, quoteRow() as any, {
      clientPoNumber: null,
      materialRequestId: null,
      approvedByUserId: 'u',
      approvedAt: new Date('2026-11-08T12:00:00Z'),
    });
    expect(p).toMatchObject({ client_po_number: null, material_request_id: null, approved_at: '2026-11-08T12:00:00.000Z' });
  });
});

describe('ProjectApprovalService.approve — configuração ausente', () => {
  it('sem usuário de sistema ou categoria, falha com mensagem clara (nada é gravado fora da transação)', async () => {
    const { service, prisma } = fixture();
    prisma.collaborator.findUnique.mockResolvedValue(null);
    await expect(service.approve('p-1', {}, 'user-1')).rejects.toThrow(/não está configurado/);
  });
});
