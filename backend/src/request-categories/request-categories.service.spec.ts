import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestCategoriesService } from './request-categories.service.js';
import { isPurchase, isWhistleblower } from './category-kind.js';

function fixture() {
  const category = { id: 'cat-1', kind: 'padrao', confidentiality: 'interna', useDynamicAuthority: false };
  const prisma: any = {
    requestCategory: {
      findUnique: vi.fn().mockResolvedValue(category),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'cat-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    categoryVersion: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'v-2' }),
      create: vi.fn().mockResolvedValue({ id: 'v-2' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    collaborator: { findMany: vi.fn().mockResolvedValue([]) },
    sector: { findUnique: vi.fn().mockResolvedValue({ id: 'setor-1' }) },
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma, service: new RequestCategoriesService(prisma) };
}

const validDraft = {
  id: 'v-2',
  version: 2,
  status: 'rascunho',
  formSchema: [{ key: 'a', label: 'A', type: 'text' }],
  workflowSchema: [],
  slaFirstResponseMinutes: 60,
  slaResolutionMinutes: 120,
};

describe('isPurchase / isWhistleblower', () => {
  it('decidem pelo kind, não por código ou nome', () => {
    expect(isPurchase({ kind: 'compra_material' })).toBe(true);
    expect(isPurchase({ kind: 'padrao' })).toBe(false);
    expect(isPurchase({ kind: 'denuncia' })).toBe(false);
    expect(isWhistleblower({ kind: 'denuncia' })).toBe(true);
    expect(isWhistleblower({ kind: 'padrao' })).toBe(false);
  });
});

describe('catálogo', () => {
  it('só devolve ativas com versão publicada e nunca seleciona rascunho', async () => {
    const { prisma, service } = fixture();
    prisma.requestCategory.findMany.mockResolvedValue([
      { id: 'c', name: 'X', versions: [{ id: 'v-1', version: 1, status: 'publicada' }] },
    ]);
    const out = await service.findAllCatalog();
    const args = prisma.requestCategory.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ active: true, versions: { some: { status: 'publicada' } } });
    expect(args.include.versions.where).toEqual({ status: 'publicada' });
    expect(out[0].currentVersion).toMatchObject({ version: 1 });
  });
});

describe('rascunho', () => {
  it('cria rascunho com version = max+1 copiando a última publicada', async () => {
    const { prisma, service } = fixture();
    prisma.categoryVersion.findFirst
      .mockResolvedValueOnce(null) // sem rascunho
      .mockResolvedValueOnce({ id: 'v-1', version: 1, formSchema: [{ key: 'x' }], workflowSchema: [], slaFirstResponseMinutes: 30, slaResolutionMinutes: 90 }) // publicada
      .mockResolvedValueOnce({ version: 1 }); // max
    await service.createDraft('cat-1', 'col-1');
    const data = prisma.categoryVersion.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ version: 2, status: 'rascunho', slaFirstResponseMinutes: 30, createdBy: 'col-1', formSchema: [{ key: 'x' }] });
  });

  it('rascunho duplicado dá 409', async () => {
    const { prisma, service } = fixture();
    prisma.categoryVersion.findFirst.mockResolvedValueOnce({ id: 'v-2' });
    await expect(service.createDraft('cat-1', 'col-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.categoryVersion.create).not.toHaveBeenCalled();
  });

  it('edição valida e devolve 400 com a lista de erros', async () => {
    const { prisma, service } = fixture();
    prisma.categoryVersion.findFirst.mockResolvedValueOnce(validDraft);
    const err = await service.updateDraft('cat-1', { formSchema: [{ key: '', label: '', type: 'x' }] }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(Array.isArray(err.getResponse().message)).toBe(true);
    expect(prisma.categoryVersion.updateMany).not.toHaveBeenCalled();
  });

  it('colaborador inativo ou inexistente no fluxo é rejeitado', async () => {
    const { prisma, service } = fixture();
    prisma.categoryVersion.findFirst.mockResolvedValueOnce(validDraft);
    prisma.collaborator.findMany.mockResolvedValue([{ id: 'a', fullName: 'Ana', status: 'desligado' }]);
    const err = await service
      .updateDraft('cat-1', { workflowSchema: [{ stepOrder: 1, approverRule: 'colaboradores', collaboratorIds: ['a', 'b'], completionRule: 'todos' }] })
      .catch((e) => e);
    const msgs: string[] = err.getResponse().message;
    expect(msgs.some((m) => m.includes('Ana não está ativo'))).toBe(true);
    expect(msgs.some((m) => m.includes('não encontrado'))).toBe(true);
  });

  it('descartar só apaga rascunho', async () => {
    const { prisma, service } = fixture();
    prisma.categoryVersion.findFirst.mockResolvedValueOnce(validDraft);
    await service.discardDraft('cat-1');
    expect(prisma.categoryVersion.deleteMany).toHaveBeenCalledWith({ where: { id: 'v-2', status: 'rascunho' } });
  });

  it('sem rascunho: 404 ao descartar e ao publicar', async () => {
    const { service } = fixture();
    await expect(service.discardDraft('cat-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.publishDraft('cat-1', 'col-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('publicação', () => {
  it('rascunho vira publicada com publishedAt e publishedBy, por update condicional', async () => {
    const { prisma, service } = fixture();
    prisma.categoryVersion.findFirst.mockResolvedValueOnce(validDraft);
    await service.publishDraft('cat-1', 'col-9');
    const args = prisma.categoryVersion.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'v-2', status: 'rascunho' });
    expect(args.data).toMatchObject({ status: 'publicada', publishedBy: 'col-9' });
    expect(args.data.publishedAt).toBeInstanceOf(Date);
  });

  it('corrida: o segundo publicador (count 0) recebe 409', async () => {
    const { prisma, service } = fixture();
    prisma.categoryVersion.findFirst.mockResolvedValueOnce(validDraft);
    prisma.categoryVersion.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.publishDraft('cat-1', 'col-9')).rejects.toBeInstanceOf(ConflictException);
  });

  it('revalida tudo na publicação (rascunho inválido não publica)', async () => {
    const { prisma, service } = fixture();
    prisma.categoryVersion.findFirst.mockResolvedValueOnce({ ...validDraft, slaFirstResponseMinutes: 500, slaResolutionMinutes: 10 });
    await expect(service.publishDraft('cat-1', 'col-9')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.categoryVersion.updateMany).not.toHaveBeenCalled();
  });

  it('denúncia não publica com confidencialidade diferente de restrita', async () => {
    const { prisma, service } = fixture();
    prisma.requestCategory.findUnique.mockResolvedValue({ id: 'cat-1', kind: 'denuncia', confidentiality: 'interna', useDynamicAuthority: false });
    prisma.categoryVersion.findFirst.mockResolvedValueOnce(validDraft);
    await expect(service.publishDraft('cat-1', 'col-9')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('criação e edição da categoria', () => {
  it('cria a versão 1 em rascunho com defaults de SLA', async () => {
    const { prisma, service } = fixture();
    await service.create({ code: 'TI-X', name: 'X', sectorId: 'setor-1' }, 'col-1');
    const data = prisma.requestCategory.create.mock.calls[0][0].data;
    expect(data.kind).toBe('padrao');
    expect(data.versions.create).toMatchObject({ version: 1, status: 'rascunho', slaFirstResponseMinutes: 240, slaResolutionMinutes: 2880, createdBy: 'col-1' });
  });

  it('código duplicado dá 409 em pt-BR', async () => {
    const { prisma, service } = fixture();
    prisma.requestCategory.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    await expect(service.create({ code: 'TI-X', name: 'X', sectorId: 'setor-1' }, null)).rejects.toThrow('Já existe uma categoria com o código TI-X.');
  });

  it('denúncia na criação exige restrita; compra rejeita alçada por valor', async () => {
    const { service } = fixture();
    await expect(service.create({ code: 'CMP-X', name: 'X', sectorId: 's', kind: 'denuncia' }, null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ code: 'SUP-X', name: 'X', sectorId: 's', kind: 'compra_material', useDynamicAuthority: true }, null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('PATCH revalida as regras do tipo e exige setor existente', async () => {
    const { prisma, service } = fixture();
    prisma.requestCategory.findUnique.mockResolvedValue({ id: 'cat-1', kind: 'denuncia', confidentiality: 'restrita', useDynamicAuthority: false });
    await expect(service.update('cat-1', { confidentiality: 'interna' })).rejects.toBeInstanceOf(BadRequestException);
    prisma.sector.findUnique.mockResolvedValue(null);
    await expect(service.update('cat-1', { sectorId: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('desativar categoria só altera active', async () => {
    const { prisma, service } = fixture();
    await service.update('cat-1', { active: false });
    expect(prisma.requestCategory.update.mock.calls[0][0].data).toMatchObject({ active: false });
  });
});
