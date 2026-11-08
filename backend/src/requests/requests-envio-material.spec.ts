import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RequestsService } from './requests.service.js';
import { ShipmentRequestsService } from './shipment-requests.service.js';
import { materialRequestApprovedPayload, type ShipmentData } from './envio-material.js';

/**
 * Envio de material para obra (PT-06): aprovação pelo responsável do centro de custo emite
 * `material_request.approved` no formato do adaptador da Logística e vai a `em_atendimento`; reprovar não emite;
 * cancelar depois de aprovada emite `material_request.cancel_requested`.
 */

const ADAPTER_PATH = fileURLToPath(new URL('../../../lgc-dev-logistica/backend/src/integration/material-request.adapter.ts', import.meta.url));
const LOGISTICS_ADAPTER_AVAILABLE =
  existsSync(ADAPTER_PATH) && existsSync(fileURLToPath(new URL('../../../lgc-dev-logistica/backend/node_modules/@nestjs/common', import.meta.url)));

const SYSTEM = 'col-sistema';
const CC_RESPONSIBLE = 'col-resp'; // também é o responsável do projeto (recebedor no site)

const SHIPMENT: ShipmentData = {
  projectQuoteId: 'q-2',
  recipientCollaboratorId: 'col-resp',
  recipientName: 'Carla Responsável',
  neededBy: '2026-11-30',
  destination: {
    siteId: 'site-1',
    siteCode: 'GRU53',
    siteName: 'Aeroporto GRU',
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
  approvedAt: null,
};

function shipmentRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    code: 'REQ-2026-000007',
    executionMode: 'legacy',
    status: 'aguardando_aprovacao',
    requesterId: SYSTEM,
    beneficiaryId: SYSTEM,
    assigneeId: null,
    sectorId: 'setor-alm',
    categoryVersionId: 'cv-envio',
    projectId: 'p-1',
    costCenterId: 'cc-1',
    formData: { shipment: SHIPMENT },
    approvals: [
      { id: 'ap-1', requestId: 'req-1', stepOrder: 1, approverId: CC_RESPONSIBLE, status: 'pendente', completionRule: 'todos', requiredCount: null, approvalSource: 'centro_custo' },
    ],
    ...overrides,
  };
}

function fixture(request: Record<string, unknown> = shipmentRequest(), kind = 'envio_material') {
  const prisma: any = {
    request: {
      findUnique: vi.fn().mockResolvedValue(request),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...request, ...data })),
    },
    categoryVersion: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'cv-envio', slaFirstResponseMinutes: 240, slaResolutionMinutes: 2880, category: { code: 'LOG-ENVIO-OBRA', kind } }),
    },
    requestApproval: { update: vi.fn(), updateMany: vi.fn() },
    requestComment: { create: vi.fn() },
    slaClock: { createMany: vi.fn(), updateMany: vi.fn() },
    holiday: { findMany: vi.fn().mockResolvedValue([]) },
    auditEvent: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const delegations = { findActiveDelegate: vi.fn().mockResolvedValue(null) };
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new RequestsService(prisma, outbox as any, delegations as any, {} as any, {} as any);
  const events = () => outbox.record.mock.calls.map((c: any[]) => c[1] as string);
  const payload = (type: string) => outbox.record.mock.calls.find((c: any[]) => c[1] === type)?.[2] as Record<string, any>;
  const audits = () => prisma.auditEvent.create.mock.calls.map((c: any[]) => c[0].data.event as string);
  return { prisma, outbox, service, events, payload, audits };
}

describe('aprovação do envio de material pelo responsável do CC', () => {
  it('quando o responsável do CC é o responsável do projeto continua aprovando (o solicitante é o sistema)', async () => {
    const { service, prisma } = fixture();
    const result = await service.approve('req-1', CC_RESPONSIBLE, {} as any);
    expect(prisma.requestApproval.update.mock.calls[0][0]).toMatchObject({ where: { id: 'ap-1' }, data: { status: 'aprovado' } });
    expect(result.status).toBe('em_atendimento');
  });

  it('não exige a análise de estoque do Suprimentos (própria da compra)', async () => {
    const { service } = fixture();
    await expect(service.approve('req-1', CC_RESPONSIBLE, {} as any)).resolves.toBeDefined();
  });

  it('quem não é o aprovador não decide', async () => {
    const { service } = fixture();
    await expect(service.approve('req-1', 'col-outro', {} as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('aprovar emite request.status_changed (aprovada), material_request.approved e request.status_changed (em_atendimento)', async () => {
    const { service, events } = fixture();
    await service.approve('req-1', CC_RESPONSIBLE, {} as any);
    expect(events()).toEqual(['request.status_changed', 'material_request.approved', 'request.status_changed']);
  });

  it('material_request.approved sai no formato exato do §4.3 (adaptador da Logística)', async () => {
    const { service, payload } = fixture();
    await service.approve('req-1', CC_RESPONSIBLE, {} as any);
    expect(payload('material_request.approved')).toEqual({
      request_id: 'req-1',
      version: 1,
      code: 'REQ-2026-000007',
      project_id: 'p-1',
      cost_center_id: 'cc-1',
      requester_id: null,
      recipient_id: 'col-resp',
      warehouse_code: null,
      needed_by: '2026-11-30',
      destination: {
        site_id: 'site-1',
        site_code: 'GRU53',
        address: 'Rod. Hélio Smidt, s/n, Cumbica, CEP 07190-100',
        city: 'Guarulhos',
        state: 'SP',
        latitude: -23.4356,
        longitude: -46.4731,
      },
      items: [
        { material_code: 'RED-CAB-0123', quantity: '1200.000' },
        { material_code: 'RED-CON-0001', quantity: '40.000' },
      ],
    });
  });

  it('vai a em_atendimento, marca approvedAt no envio e para os relógios de SLA', async () => {
    const { service, prisma } = fixture();
    await service.approve('req-1', CC_RESPONSIBLE, {} as any);
    const lastUpdate = prisma.request.update.mock.calls.at(-1)[0];
    expect(lastUpdate.data.status).toBe('em_atendimento');
    expect(lastUpdate.data.formData.shipment.approvedAt).toEqual(expect.any(String));
    expect(prisma.slaClock.updateMany.mock.calls[0][0]).toMatchObject({ where: { requestId: 'req-1', stoppedAt: null } });
  });

  it('o evento sai na MESMA transação da aprovação', async () => {
    const { service, prisma, outbox } = fixture();
    await service.approve('req-1', CC_RESPONSIBLE, {} as any);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    for (const call of outbox.record.mock.calls) expect(call[0]).toBe(prisma);
  });

  // Sem `npm ci` em lgc-dev-logistica/backend não dá para importar o adaptador (o teste aparece como "skipped"): o formato
  // exato fica coberto pelo teste anterior.
  it.skipIf(!LOGISTICS_ADAPTER_AVAILABLE)('o payload é aceito pelo adaptador real da Logística (quando as dependências dela estão instaladas)', async () => {
    const { adaptMaterialRequestEvent } = (await import(/* @vite-ignore */ pathToFileURL(ADAPTER_PATH).href)) as {
      adaptMaterialRequestEvent: (type: string, payload: Record<string, unknown>) => { kind: string; order: Record<string, unknown> } | null;
    };
    const payload = materialRequestApprovedPayload({ id: 'req-1', code: 'REQ-2026-000007', projectId: 'p-1', costCenterId: 'cc-1' }, SHIPMENT);
    const adapted = adaptMaterialRequestEvent('material_request.approved', payload);
    expect(adapted).toMatchObject({
      kind: 'approved',
      order: {
        axisRequestId: 'req-1',
        requestVersion: 1,
        projectAxisId: 'p-1',
        costCenterAxisId: 'cc-1',
        recipientAxisId: 'col-resp',
        neededBy: '2026-11-30',
        destinationSiteAxisId: 'site-1',
        destinationLat: -23.4356,
        destinationLng: -46.4731,
        items: [
          { materialCode: 'RED-CAB-0123', quantity: 1200 },
          { materialCode: 'RED-CON-0001', quantity: 40 },
        ],
      },
    });
    expect((adapted!.order as any).destinationText).toBe('GRU53 — Rod. Hélio Smidt, s/n, Cumbica, CEP 07190-100, Guarulhos/SP');
    const cancel = adaptMaterialRequestEvent('material_request.cancel_requested', { request_id: 'req-1', reason: 'Projeto cancelado' });
    expect(cancel).toEqual({ kind: 'cancel_requested', axisRequestId: 'req-1', reason: 'Projeto cancelado' });
  });
});

describe('reprovação do envio de material', () => {
  it('reprovar não emite nada para a Logística', async () => {
    const { service, events, payload } = fixture();
    const result = await service.reject('req-1', CC_RESPONSIBLE, { comment: 'Material já entregue' } as any);
    expect(result.status).toBe('reprovada');
    expect(events()).toEqual(['request.status_changed']);
    expect(payload('material_request.approved')).toBeUndefined();
    expect(events().some((e) => e.startsWith('material_request.'))).toBe(false);
  });
});

describe('cancelamento do envio de material', () => {
  const approved = () => shipmentRequest({ status: 'em_atendimento', approvals: [], formData: { shipment: { ...SHIPMENT, approvedAt: '2026-11-09T12:00:00.000Z' } } });

  it('cancelar depois de aprovada emite material_request.cancel_requested com o motivo', async () => {
    const { service, events, payload } = fixture(approved());
    const result = await service.cancel('req-1', 'col-staff', true, { reason: 'Obra suspensa pelo cliente' } as any, ['gestor']);
    expect(result.status).toBe('cancelada');
    expect(events()).toEqual(['request.status_changed', 'material_request.cancel_requested']);
    expect(payload('material_request.cancel_requested')).toEqual({
      request_id: 'req-1',
      code: 'REQ-2026-000007',
      project_id: 'p-1',
      cost_center_id: 'cc-1',
      reason: 'Obra suspensa pelo cliente',
    });
  });

  it('cancelar antes da aprovação (a Logística nunca recebeu) não emite o evento', async () => {
    const { service, events } = fixture(shipmentRequest());
    await service.cancel('req-1', 'col-staff', true, { reason: 'Duplicada' } as any, ['gestor']);
    expect(events()).toEqual(['request.status_changed']);
  });

  it('requisição que não é envio de material não emite material_request.*', async () => {
    const { service, events } = fixture(shipmentRequest({ status: 'em_atendimento', formData: null }), 'padrao');
    await service.cancel('req-1', 'col-staff', true, { reason: 'x' } as any, ['gestor']);
    expect(events()).toEqual(['request.status_changed']);
  });
});

describe('envio de material — o que a tela não faz', () => {
  it('não abre pela tela (create recusa a categoria)', async () => {
    const { prisma, service } = fixture();
    prisma.requestCategory = { findUnique: vi.fn().mockResolvedValue({ id: 'cat-1', active: true, kind: 'envio_material' }) };
    await expect(service.create('col-1', { categoryId: 'cat-1', description: 'x' } as any)).rejects.toThrow(
      new BadRequestException('O envio de material para obra é criado automaticamente ao aprovar o projeto.'),
    );
  });

  it('a conclusão vem da Logística: complete e pedir informação são recusados', async () => {
    const { service } = fixture(shipmentRequest({ status: 'em_atendimento', approvals: [] }));
    await expect(service.complete('req-1', 'col-staff', {} as any, ['gestor'])).rejects.toThrow(/conclusão vem da entrega confirmada pela Logística/);
    await expect(service.requestInformation('req-1', 'col-staff', { question: 'Onde?' } as any, ['gestor'])).rejects.toThrow(/solicitante é o sistema/);
  });
});

describe('ShipmentRequestsService.resolveApprover — "Reavaliar aprovador"', () => {
  function resolveFixture(requestOverrides: Record<string, unknown> = {}, costCenter: Record<string, unknown> | null = { responsibleCollaborator: { id: 'col-novo', status: 'ativo' }, parentCostCenter: null }) {
    const request = shipmentRequest({
      approvals: [],
      categoryVersion: { category: { kind: 'envio_material' } },
      formData: { shipment: { ...SHIPMENT, warnings: ['Sem responsável no centro de custo do projeto nem no centro de custo pai: cadastre o responsável.', 'Outro aviso'] } },
      ...requestOverrides,
    });
    const prisma: any = {
      request: { findUnique: vi.fn().mockResolvedValue(request), update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...request, ...data })) },
      costCenter: { findUnique: vi.fn().mockResolvedValue(costCenter) },
      requestApproval: { create: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    return { prisma, service: new ShipmentRequestsService(prisma) };
  }

  it('cria a linha centro_custo do responsável recém-cadastrado e limpa o aviso de "sem responsável"', async () => {
    const { service, prisma } = resolveFixture();
    await service.resolveApprover('req-1', 'col-admin');
    expect(prisma.requestApproval.create.mock.calls[0][0].data).toMatchObject({ requestId: 'req-1', stepOrder: 1, approverId: 'col-novo', approvalSource: 'centro_custo' });
    expect(prisma.request.update.mock.calls[0][0].data.formData.shipment.warnings).toEqual(['Outro aviso']);
    expect(prisma.auditEvent.create.mock.calls[0][0].data).toMatchObject({ event: 'request.shipment_approver_resolved', actorId: 'col-admin' });
  });

  it('continua sem responsável → 400 e nada gravado', async () => {
    const { service, prisma } = resolveFixture({}, { responsibleCollaborator: null, parentCostCenter: null });
    await expect(service.resolveApprover('req-1', 'col-admin')).rejects.toThrow(/continua sem responsável/);
    expect(prisma.requestApproval.create).not.toHaveBeenCalled();
  });

  it('só vale para envio de material aguardando aprovação e sem aprovador pendente', async () => {
    await expect(resolveFixture({ categoryVersion: { category: { kind: 'padrao' } } }).service.resolveApprover('req-1', 'a')).rejects.toThrow(/não é um envio de material/);
    await expect(resolveFixture({ status: 'em_atendimento' }).service.resolveApprover('req-1', 'a')).rejects.toThrow(/não está aguardando aprovação/);
    await expect(
      resolveFixture({ approvals: [{ stepOrder: 1, status: 'pendente' }] }).service.resolveApprover('req-1', 'a'),
    ).rejects.toThrow(/já tem um aprovador pendente/);
  });
});
