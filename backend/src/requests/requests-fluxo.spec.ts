import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RequestsService } from './requests.service.js';

/** Testes de unidade do fluxo de requisições com Prisma simulado. Cobrem as correções de
 * 2026-11-07: visibilidade da fila, reenvio após devolução, reabertura e resposta do
 * solicitante a um pedido de informação. */

const REQUESTER = 'col-solicitante';
const STAFF = 'col-atendente';

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    code: 'REQ-000001',
    executionMode: 'legacy',
    status: 'rascunho',
    requesterId: REQUESTER,
    beneficiaryId: REQUESTER,
    assigneeId: null,
    categoryVersionId: 'cv-1',
    formData: null,
    closedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function fixture(request: Record<string, unknown> = baseRequest()) {
  const prisma: any = {
    request: {
      findUnique: vi.fn().mockResolvedValue(request),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...request, ...data })),
    },
    categoryVersion: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'cv-1', formSchema: [] }) },
    collaborator: { findUnique: vi.fn().mockResolvedValue({ sectorId: 'setor-sup' }) },
    slaClock: { findFirst: vi.fn().mockResolvedValue(null) },
    requestComment: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const outbox = { record: vi.fn() };
  const service = new RequestsService(prisma, outbox as any, {} as any, {} as any, {} as any);
  const auditEvents = () => prisma.auditEvent.create.mock.calls.map((c: any[]) => c[0].data.event);
  return { prisma, outbox, service, auditEvents };
}

describe('findQueue — visibilidade da fila', () => {
  const viewer = { roles: ['gestor'], collaboratorId: 'col-leitor', canViewWhistleblowerIdentity: false };

  it('filtra requisições restritas no servidor e nunca seleciona formData/descrição', async () => {
    const { prisma, service } = fixture();
    await service.findQueue({}, viewer);
    const args = prisma.request.findMany.mock.calls[0][0];
    expect(args.where.AND[1]).toEqual({
      OR: [
        { confidentiality: { not: 'restrita' } },
        { requesterId: 'col-leitor' },
        { beneficiaryId: 'col-leitor' },
        { assigneeId: 'col-leitor' },
        { approvals: { some: { approverId: 'col-leitor' } } },
      ],
    });
    expect(args.select.formData).toBeUndefined();
    expect(args.select.description).toBeUndefined();
  });

  it('sem colaborador vinculado, só enxerga o que não é restrito', async () => {
    const { prisma, service } = fixture();
    await service.findQueue({}, { ...viewer, collaboratorId: null });
    expect(prisma.request.findMany.mock.calls[0][0].where.AND[1]).toEqual({ confidentiality: { not: 'restrita' } });
  });

  it('mascara solicitante e beneficiário de denúncia anônima', async () => {
    const { prisma, service } = fixture();
    prisma.request.findMany.mockResolvedValue([{ id: 'r', anonymous: true, requesterId: 'denunciante', beneficiaryId: 'denunciante' }]);
    const [row] = await service.findQueue({}, viewer);
    expect(row).toMatchObject({ requesterId: null, beneficiaryId: null, requesterDisplay: 'Anônimo' });
  });

  it('não mascara para o próprio solicitante nem para quem tem a permissão de identidade', async () => {
    const { prisma, service } = fixture();
    prisma.request.findMany.mockResolvedValue([{ id: 'r', anonymous: true, requesterId: 'col-leitor', beneficiaryId: 'col-leitor' }]);
    const [self] = await service.findQueue({}, viewer);
    expect(self.requesterId).toBe('col-leitor');

    prisma.request.findMany.mockResolvedValue([{ id: 'r', anonymous: true, requesterId: 'denunciante', beneficiaryId: 'denunciante' }]);
    const [privileged] = await service.findQueue({}, { ...viewer, canViewWhistleblowerIdentity: true });
    expect(privileged.requesterId).toBe('denunciante');
  });

  it('analista de suprimentos vê só o próprio setor, ignorando o filtro pedido', async () => {
    const { prisma, service } = fixture();
    await service.findQueue({ sectorId: 'outro-setor' }, { ...viewer, roles: ['analista_suprimentos'] });
    expect(prisma.request.findMany.mock.calls[0][0].where.AND[0].sectorId).toBe('setor-sup');
  });
});

describe('submit/update — reenvio após devolução', () => {
  it('reenvia devolvida_ajuste para a triagem sem sobrescrever o primeiro envio', async () => {
    const { prisma, outbox, service, auditEvents } = fixture(baseRequest({ status: 'devolvida_ajuste' }));
    const updated = await service.submit('req-1', REQUESTER);
    expect(updated.status).toBe('enviada');
    expect(prisma.request.update.mock.calls[0][0].data.submittedAt).toBeUndefined();
    expect(auditEvents()).toEqual(['request.resubmitted']);
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'request.status_changed', expect.objectContaining({ status: 'enviada' }));
  });

  it('primeiro envio continua emitindo request.submitted', async () => {
    const { outbox, service, auditEvents } = fixture();
    await service.submit('req-1', REQUESTER);
    expect(auditEvents()).toEqual(['request.submitted']);
    expect(outbox.record).toHaveBeenCalledWith(expect.anything(), 'request.submitted', expect.anything());
  });

  it('permite editar uma requisição devolvida para ajuste', async () => {
    const { prisma, service } = fixture(baseRequest({ status: 'devolvida_ajuste' }));
    await service.update('req-1', REQUESTER, { title: 'Ajustada' } as any);
    expect(prisma.request.update).toHaveBeenCalled();
  });

  it.each(['enviada', 'aguardando_aprovacao', 'concluida'])('recusa enviar a partir de %s', async (status) => {
    const { prisma, service } = fixture(baseRequest({ status }));
    await expect(service.submit('req-1', REQUESTER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('só o solicitante reenvia', async () => {
    const { service } = fixture(baseRequest({ status: 'devolvida_ajuste' }));
    await expect(service.submit('req-1', STAFF)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('reopen — volta para a fila de triagem', () => {
  it('requisição reprovada reaberta vai para enviada (de onde a triagem parte)', async () => {
    const { prisma, outbox, service } = fixture(baseRequest({ status: 'reprovada' }));
    const updated = await service.reopen('req-1', REQUESTER, false, { reason: 'Mesmo problema' } as any);
    expect(updated.status).toBe('enviada');
    expect(prisma.request.update.mock.calls[0][0].data).toEqual({ status: 'enviada', closedAt: null });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'request.status_changed', expect.objectContaining({ status: 'enviada' }));
  });
});

describe('complete — não se aplica à compra', () => {
  function completeFixture(kind: 'padrao' | 'compra_material') {
    const f = fixture(baseRequest({ status: 'em_atendimento', assigneeId: STAFF }));
    f.prisma.categoryVersion.findUniqueOrThrow.mockResolvedValue({ id: 'cv-1', formSchema: [], category: { kind } });
    f.prisma.requestApproval = { findMany: vi.fn().mockResolvedValue([]) };
    f.prisma.requestRelation = { findMany: vi.fn().mockResolvedValue([]) };
    return f;
  }

  it('compra: complete responde 400 e não grava nada', async () => {
    const { prisma, outbox, service } = completeFixture('compra_material');
    await expect(service.complete('req-1', STAFF, { resolution: 'Feito' } as any, ['analista_suprimentos'])).rejects.toThrow(
      'Na compra, a conclusão é a confirmação de recebimento pelo solicitante.',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.request.update).not.toHaveBeenCalled();
    expect(prisma.requestComment.create).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('categoria padrão em atendimento conclui (regressão)', async () => {
    const { service } = completeFixture('padrao');
    const updated = await service.complete('req-1', STAFF, { resolution: 'Feito' } as any, ['analista_suprimentos']);
    expect(updated.status).toBe('concluida');
  });
});

describe('resume — resposta do solicitante', () => {
  it('solicitante responde à pergunta e a requisição volta ao atendimento', async () => {
    const { prisma, service } = fixture(baseRequest({ status: 'aguardando_solicitante' }));
    const updated = await service.resume('req-1', REQUESTER, false, { answer: 'Segue o detalhe' });
    expect(updated.status).toBe('em_atendimento');
    expect(prisma.requestComment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ authorId: REQUESTER, body: 'Segue o detalhe' }) });
  });

  it('solicitante precisa escrever a resposta', async () => {
    const { service } = fixture(baseRequest({ status: 'aguardando_solicitante' }));
    await expect(service.resume('req-1', REQUESTER, false, { answer: '  ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solicitante não retoma pendência de terceiro', async () => {
    const { service } = fixture(baseRequest({ status: 'aguardando_terceiro' }));
    await expect(service.resume('req-1', REQUESTER, true, { answer: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('terceiro sem request:update não retoma', async () => {
    const { service } = fixture(baseRequest({ status: 'aguardando_solicitante' }));
    await expect(service.resume('req-1', 'col-qualquer', false, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('atendente com request:update retoma sem resposta', async () => {
    const { service } = fixture(baseRequest({ status: 'aguardando_terceiro' }));
    const updated = await service.resume('req-1', STAFF, true, {});
    expect(updated.status).toBe('em_atendimento');
  });
});

describe('returnForAdjustment — devolução da compra ao solicitante', () => {
  function returnFixture(
    status: string,
    approvals: Array<{ approvalSource: string; status: string }> = [],
    kind: 'padrao' | 'compra_material' = 'compra_material',
  ) {
    const f = fixture(baseRequest({ status, assigneeId: STAFF }));
    f.prisma.categoryVersion.findUniqueOrThrow.mockResolvedValue({ id: 'cv-1', formSchema: [], category: { kind } });
    f.prisma.requestApproval = {
      findMany: vi.fn().mockResolvedValue(approvals),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    return f;
  }

  it('devolve em em_atendimento: status, comentário com prefixo, auditoria e outbox', async () => {
    const { prisma, outbox, service, auditEvents } = returnFixture('em_atendimento');
    const updated = await service.returnForAdjustment('req-1', STAFF, { reason: 'Faltou o item X' });
    expect(updated.status).toBe('devolvida_ajuste');
    expect(prisma.requestComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ authorId: STAFF, visibility: 'publico', body: 'Devolvida para ajuste: Faltou o item X' }),
    });
    expect(auditEvents()).toEqual(['request.returned_for_adjustment']);
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'request.status_changed', { request_id: 'req-1', code: 'REQ-000001', status: 'devolvida_ajuste' });
  });

  it('devolve em aguardando_aprovacao e marca a aprovação pendente como devolvido', async () => {
    const { prisma, outbox, service } = returnFixture('aguardando_aprovacao', [{ approvalSource: 'centro_custo', status: 'pendente' }]);
    const updated = await service.returnForAdjustment('req-1', STAFF, { reason: 'Quantidade errada' });
    expect(updated.status).toBe('devolvida_ajuste');
    expect(prisma.requestApproval.updateMany).toHaveBeenCalledWith({
      where: { requestId: 'req-1', status: 'pendente' },
      data: expect.objectContaining({ status: 'devolvido' }),
    });
    expect(outbox.record).toHaveBeenCalled();
  });

  it('recusa depois da aprovação do centro de custo', async () => {
    const { prisma, outbox, service } = returnFixture('em_atendimento', [{ approvalSource: 'centro_custo', status: 'aprovado' }]);
    await expect(service.returnForAdjustment('req-1', STAFF, { reason: 'Tarde demais' })).rejects.toThrow(
      'A compra já foi aprovada e não pode mais ser devolvida para ajuste.',
    );
    expect(prisma.request.update).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('recusa categoria que não é compra', async () => {
    const { prisma, service } = returnFixture('em_atendimento', [], 'padrao');
    await expect(service.returnForAdjustment('req-1', STAFF, { reason: 'Qualquer motivo' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('recusa o próprio solicitante', async () => {
    const { prisma, service } = returnFixture('em_atendimento');
    await expect(service.returnForAdjustment('req-1', REQUESTER, { reason: 'Qualquer motivo' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it.each(['enviada', 'aprovada', 'concluida', 'devolvida_ajuste'])('recusa a partir de %s', async (status) => {
    const { prisma, service } = returnFixture(status);
    await expect(service.returnForAdjustment('req-1', STAFF, { reason: 'Qualquer motivo' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });
});

describe('compra — ciclo novo no reenvio e formData de servidor', () => {
  const serverKeys = {
    procurementAnalysis: { notes: 'x' },
    procurementQuotations: [{ quotationId: 'c1' }],
    procurementQuotation: { quotationId: 'c1' },
    selectedQuotationId: 'c1',
    procurementSelection: [{ materialId: 'm1' }],
  };
  const items = [{ materialId: 'm1', quantity: 2, unitPrice: 10 }];

  function purchaseFixture(status: string, formData: Record<string, unknown>) {
    const f = fixture(baseRequest({ status, formData }));
    f.prisma.categoryVersion.findUniqueOrThrow.mockResolvedValue({ id: 'cv-1', formSchema: [], category: { kind: 'compra_material' } });
    return f;
  }

  it('reenvio de compra devolvida remove análise, cotações e escolha, mantendo os itens', async () => {
    const { prisma, service } = purchaseFixture('devolvida_ajuste', { purchaseItems: items, ...serverKeys });
    await service.submit('req-1', REQUESTER);
    expect(prisma.request.update.mock.calls[0][0].data.formData).toEqual({ purchaseItems: items });
    expect(prisma.request.update.mock.calls[0][0].data.status).toBe('enviada');
  });

  it('primeiro envio de compra não mexe no formData', async () => {
    const { prisma, service } = purchaseFixture('rascunho', { purchaseItems: items });
    await service.submit('req-1', REQUESTER);
    expect(prisma.request.update.mock.calls[0][0].data.formData).toBeUndefined();
  });

  it('create recusa formData com procurementAnalysis vindo do cliente', async () => {
    const { prisma, service } = fixture();
    prisma.requestCategory = { findUnique: vi.fn().mockResolvedValue({ id: 'cat', active: true, kind: 'compra_material' }) };
    prisma.categoryVersion.findFirst = vi.fn().mockResolvedValue({ id: 'cv-1', formSchema: [] });
    prisma.costCenter = { findUnique: vi.fn().mockResolvedValue({ id: 'cc' }) };
    await expect(
      service.create(REQUESTER, { categoryId: 'cat', description: 'x', costCenterId: 'cc', formData: { purchaseItems: items, procurementAnalysis: {} } } as any),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(Object.keys(serverKeys))('update recusa %s no formData do cliente', async (key) => {
    const { prisma, service } = purchaseFixture('devolvida_ajuste', { purchaseItems: items });
    await expect(service.update('req-1', REQUESTER, { formData: { purchaseItems: items, [key]: 'forjado' } } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('update de compra revalida os itens', async () => {
    const { service } = purchaseFixture('devolvida_ajuste', { purchaseItems: items });
    await expect(service.update('req-1', REQUESTER, { formData: { purchaseItems: [] } } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update de compra recalcula estimatedValue e ignora o valor enviado', async () => {
    const { prisma, service } = purchaseFixture('devolvida_ajuste', { purchaseItems: items, ...serverKeys });
    await service.update('req-1', REQUESTER, {
      estimatedValue: '1.00',
      title: 'Titulo forjado aqui',
      formData: { purchaseItems: [{ materialId: 'm1', quantity: 3, unitPrice: 5.5 }] },
    } as any);
    const data = prisma.request.update.mock.calls[0][0].data;
    expect(data.estimatedValue).toBe('16.50');
    expect(data.title).toBeUndefined();
    // chaves de servidor persistidas são preservadas no merge
    expect(data.formData.procurementAnalysis).toEqual(serverKeys.procurementAnalysis);
    expect(data.formData.purchaseItems).toHaveLength(1);
  });
});

describe('compra — só o Suprimentos age depois da triagem', () => {
  const MANAGER_ROLES = ['gestor'];
  const ANALYST_ROLES = ['analista_suprimentos'];

  function opsFixture(kind: 'padrao' | 'compra_material', status = 'aprovada') {
    const f = fixture(baseRequest({ status, assigneeId: STAFF }));
    f.prisma.categoryVersion.findUniqueOrThrow.mockResolvedValue({ id: 'cv-1', formSchema: [], category: { kind } });
    f.prisma.requestApproval = { findMany: vi.fn().mockResolvedValue([{ approvalSource: 'centro_custo', status: 'aprovado' }]) };
    f.prisma.requestRelation = { findMany: vi.fn().mockResolvedValue([]) };
    return f;
  }

  it('gestor com request:update não inicia compra aprovada (403)', async () => {
    const { prisma, service } = opsFixture('compra_material');
    await expect(service.start('req-1', 'col-gestor', MANAGER_ROLES)).rejects.toThrow('Somente o Suprimentos pode executar esta ação na compra.');
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('gestor não cancela compra aprovada como staff (403)', async () => {
    const { prisma, service } = opsFixture('compra_material');
    await expect(service.cancel('req-1', 'col-gestor', true, { reason: 'x' } as any, MANAGER_ROLES)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it.each([
    ['requestInformation', 'em_atendimento', (s: RequestsService) => s.requestInformation('req-1', 'col-gestor', { question: 'q' } as any, MANAGER_ROLES)],
    ['complete', 'em_atendimento', (s: RequestsService) => s.complete('req-1', 'col-gestor', { resolution: 'r' } as any, MANAGER_ROLES)],
    ['close', 'concluida', (s: RequestsService) => s.close('req-1', 'col-gestor', MANAGER_ROLES)],
    ['resume', 'aguardando_terceiro', (s: RequestsService) => s.resume('req-1', 'col-gestor', true, {}, MANAGER_ROLES)],
  ])('gestor não executa %s em compra (403)', async (_name, status, act) => {
    const { prisma, service } = opsFixture('compra_material', status);
    await expect(act(service)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('analista de suprimentos não inicia a compra (400) mas cancela, inclusive aguardando entrega', async () => {
    const a = opsFixture('compra_material');
    await expect(a.service.start('req-1', STAFF, ANALYST_ROLES)).rejects.toThrow('Na compra, registre o pedido ao fornecedor.');
    expect(a.prisma.request.update).not.toHaveBeenCalled();
    const b = opsFixture('compra_material');
    expect((await b.service.cancel('req-1', STAFF, true, { reason: 'x' } as any, ANALYST_ROLES)).status).toBe('cancelada');
    const c = opsFixture('compra_material', 'aguardando_entrega');
    expect((await c.service.cancel('req-1', STAFF, true, { reason: 'x' } as any, ANALYST_ROLES)).status).toBe('cancelada');
  });

  it('solicitante ainda cancela a própria compra devolvida para ajuste', async () => {
    const { service } = opsFixture('compra_material', 'devolvida_ajuste');
    expect((await service.cancel('req-1', REQUESTER, false, { reason: 'x' } as any, [])).status).toBe('cancelada');
  });

  it('categoria padrão: gestor inicia e cancela normalmente (regressão)', async () => {
    const a = opsFixture('padrao');
    expect((await a.service.start('req-1', 'col-gestor', MANAGER_ROLES)).status).toBe('em_atendimento');
    const b = opsFixture('padrao');
    expect((await b.service.cancel('req-1', 'col-gestor', true, { reason: 'x' } as any, MANAGER_ROLES)).status).toBe('cancelada');
  });
});
