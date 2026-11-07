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
