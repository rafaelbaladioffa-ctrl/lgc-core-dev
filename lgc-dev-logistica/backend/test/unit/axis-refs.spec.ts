import 'reflect-metadata';
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException, UnprocessableEntityException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { axisLabels, checkAxisRefs, custodianIdFor, resolveOwnIds } from '../../src/common/axis-cache.js';
import { movementAxisRefs, StockService } from '../../src/stock/stock.service.js';
import { ReturnsService } from '../../src/returns/returns.service.js';
import { DocumentsService } from '../../src/documents/documents.service.js';
import { WarehousesController } from '../../src/warehouses/warehouses.controller.js';
import { FulfillmentService } from '../../src/fulfillment/fulfillment.service.js';
import { AxisLookupController, AxisLookupService } from '../../src/integration/axis-lookup.controller.js';
import { PERMISSIONS_KEY } from '../../src/rbac/permissions.decorator.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

// Onda V4 do mapa de interoperabilidade (L1, L3, L4): ids do Core conferidos no cache, custódia pela pessoa e consulta do cache.

type CacheRow = { kind: string; axisId: string; code: string | null; name: string | null; active: boolean; data?: Record<string, unknown>; syncedAt?: Date };

/** `axisMasterCache` em memória com o subconjunto de filtros que o código usa. */
function cache(rows: CacheRow[]) {
  const kindOk = (k: unknown, row: CacheRow) => (typeof k === 'string' ? row.kind === k : !k || (k as { in: string[] }).in.includes(row.kind));
  const idOk = (id: unknown, row: CacheRow) => (typeof id === 'string' ? row.axisId === id : !id || (id as { in: string[] }).in.includes(row.axisId));
  const match = (where: { kind?: unknown; axisId?: unknown }) => rows.filter((r) => kindOk(where.kind, r) && idOk(where.axisId, r));
  return {
    axisMasterCache: {
      findFirst: vi.fn(async ({ where }: { where: { kind?: unknown; axisId?: unknown } }) => match(where)[0] ?? null),
      findMany: vi.fn(async ({ where }: { where: { kind?: unknown; axisId?: unknown } }) => match(where)),
      findUnique: vi.fn(async ({ where }: { where: { kind_axisId: { kind: string; axisId: string } } }) => match(where.kind_axisId)[0] ?? null),
    },
  };
}

const PROJ = { kind: 'PROJECT', axisId: 'p-1', code: 'PRJ-001', name: 'Data center Sumaré', active: true };
const PROJ_CLOSED = { kind: 'PROJECT', axisId: 'p-2', code: 'PRJ-002', name: 'Obra encerrada', active: false };
const COLLAB_GONE = { kind: 'COLLABORATOR', axisId: 'c-gone', code: null, name: 'Desligado', active: false };
const USER_LINKED = { kind: 'USER', axisId: 'u-1', code: null, name: 'Ana Souza', active: true, data: { collaborator_id: 'c-1' } };

describe('checkAxisRefs: ausente avisa, inativo bloqueia ou avisa conforme o fluxo', () => {
  it('id ausente do cache vira aviso (nunca bloqueia, mesmo com o cache vazio)', async () => {
    const w = await checkAxisRefs(cache([]), [{ id: 'p-x', kinds: ['PROJECT'], label: 'Projeto', onInactive: 'block' }]);
    expect(w).toEqual(['Projeto p-x ainda não sincronizado do Axis.']);
  });

  it('inativo com block → 422 AXIS_REFERENCE_INVALID com o nome do cadastro; com warn → aviso', async () => {
    const db = cache([PROJ_CLOSED]);
    const err = await checkAxisRefs(db, [{ id: 'p-2', kinds: ['PROJECT'], label: 'Projeto', onInactive: 'block' }]).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toEqual({ message: 'Projeto PRJ-002 — Obra encerrada está inativo(a) no Axis: escolha um cadastro ativo.', code: 'AXIS_REFERENCE_INVALID' });
    expect(await checkAxisRefs(db, [{ id: 'p-2', kinds: ['PROJECT'], label: 'Projeto', onInactive: 'warn' }])).toEqual(['Projeto PRJ-002 — Obra encerrada está inativo(a) no Axis.']);
  });

  it('ativo e id vazio passam sem aviso', async () => {
    expect(await checkAxisRefs(cache([PROJ]), [{ id: 'p-1', kinds: ['PROJECT'], label: 'Projeto', onInactive: 'block' }, { id: undefined, kinds: ['SITE'], label: 'Site', onInactive: 'block' }])).toEqual([]);
  });

  it('axisLabels troca ids por "código — nome" e mantém o id do que não está no cache', async () => {
    const names = await axisLabels(cache([PROJ, USER_LINKED]), ['PROJECT'], ['p-1', 'p-sem', null]);
    expect([...names]).toEqual([['p-1', 'PRJ-001 — Data center Sumaré']]);
  });
});

describe('movimento manual de estoque (L1)', () => {
  it('na saída para consumo, projeto e custodiante inativos bloqueiam; centro de custo e cliente só avisam', () => {
    const refs = movementAxisRefs({ type: 'SAIDA_ENTREGA', projectAxisId: 'p', costCenterAxisId: 'cc', clientAxisId: 'cl', custodianAxisId: 'c' });
    expect(refs.map((r) => [r.label, r.onInactive])).toEqual([['Projeto', 'block'], ['Centro de custo', 'warn'], ['Cliente', 'warn'], ['Custodiante', 'block']]);
    expect(movementAxisRefs({ type: 'ENTRADA_DEVOLUCAO', projectAxisId: 'p' }).every((r) => r.onInactive === 'warn')).toBe(true);
  });

  const stock = (rows: CacheRow[]) => {
    const tx = {
      material: { findUnique: vi.fn().mockResolvedValue({ id: 'm-1', status: 'ATIVO', category: 'Cabos', lotControlled: false, serialControlled: false, expiryControlled: false, stockUom: { code: 'UN', precision: 0 } }) },
      location: { findMany: vi.fn().mockResolvedValue([{ id: 'loc-1', code: 'A-01', warehouseId: 'wh-1', isVirtual: false, status: 'ATIVO', allowedCategories: [], warehouse: { status: 'ATIVO' } }]) },
      stockCountLine: { count: vi.fn().mockResolvedValue(0) },
      stockBalance: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), upsert: vi.fn().mockResolvedValue({}) },
      stockMovement: { create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'mov-1', seq: 1, registeredAt: new Date(), ...data })) },
      integrationMessage: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { ...cache(rows), stockMovement: { findUnique: vi.fn().mockResolvedValue(null) }, $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const service = new StockService(prisma as never, { assertWarehouseAccess: vi.fn() } as never);
    return { service, tx };
  };
  const u = { userId: 'u-op', email: 'op@lgc', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions: ['stock:post'] };

  it('saída para projeto encerrado é recusada (422) antes de gravar', async () => {
    const s = stock([PROJ_CLOSED]);
    await expect(s.service.post({ type: 'SAIDA_ENTREGA', materialId: 'm-1', quantity: 1, fromLocationId: 'loc-1', reason: 'Consumo', projectAxisId: 'p-2' } as never, 'chave-0001', u)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(s.tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('projeto ainda fora do cache não bloqueia: o movimento grava e volta com o aviso', async () => {
    const s = stock([]);
    const res = await s.service.post({ type: 'SAIDA_ENTREGA', materialId: 'm-1', quantity: 1, fromLocationId: 'loc-1', reason: 'Consumo', projectAxisId: 'p-novo' } as never, 'chave-0002', u);
    expect(res.referenceWarnings).toEqual(['Projeto p-novo ainda não sincronizado do Axis.']);
    expect(s.tx.stockMovement.create).toHaveBeenCalled();
  });
});

describe('devolução (L1): cadastro inativo nunca recusa a devolução', () => {
  it('quem devolveu desligado e projeto encerrado viram avisos na resposta', async () => {
    const tx = {
      location: { findFirst: vi.fn().mockResolvedValue({ id: 'loc-r', status: 'ATIVO' }) },
      return: { create: vi.fn().mockResolvedValue({ id: 'ret-1', seq: 4, projectAxisId: 'p-2', returnedByAxisId: 'c-gone' }), findUnique: vi.fn().mockResolvedValue({ id: 'ret-1', seq: 4, warehouseId: 'wh-1', items: [] }) },
      material: { findUnique: vi.fn().mockResolvedValue({ id: 'm-1', lotControlled: false, serialControlled: false, stockUom: { code: 'UN', precision: 0 } }) },
      returnItem: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { ...cache([COLLAB_GONE, PROJ_CLOSED]), $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const svc = new ReturnsService(prisma as never, { assertWarehouseAccess: vi.fn() } as never, { applyInternal: vi.fn() } as never);
    const res = await svc.create({ type: 'SOBRA', warehouseId: 'wh-1', receivingLocationId: 'loc-r', returnedByAxisId: 'c-gone', projectAxisId: 'p-2', items: [{ materialId: 'm-1', quantity: 2 }] } as never, { userId: 'u-op', permissions: [] } as never);
    expect(res.code).toBe('DEV-00000004');
    expect(res.referenceWarnings).toEqual(['Quem devolveu Desligado está inativo(a) no Axis.', 'Projeto PRJ-002 — Obra encerrada está inativo(a) no Axis.']);
  });
});

describe('almoxarifado (L1/L7): responsável, projeto e site do Core', () => {
  const build = (rows: CacheRow[]) => {
    const create = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'wh-new', ...data }));
    const audit = { record: vi.fn().mockResolvedValue({}) };
    const ctrl = new WarehousesController({ ...cache(rows), warehouse: { create } } as never, {} as never, audit as never);
    return { ctrl, create, audit };
  };
  const dto = { code: 'ALM-OBRA', name: 'Almoxarifado da obra', type: 'PROJETO' };

  it('responsável desligado é recusado (422) e nada é gravado', async () => {
    const b = build([COLLAB_GONE]);
    await expect(b.ctrl.create({ ...dto, responsibleAxisUserId: 'c-gone' } as never, { userId: 'adm' } as never)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(b.create).not.toHaveBeenCalled();
  });

  it('projeto ausente do cache grava com aviso na resposta e na auditoria; site e responsável ativos passam', async () => {
    const b = build([USER_LINKED, { kind: 'SITE', axisId: 's-1', code: 'GRU53', name: 'Site GRU53', active: true }]);
    const res = await b.ctrl.create({ ...dto, responsibleAxisUserId: 'u-1', siteAxisId: 's-1', projectAxisId: 'p-novo', addressText: 'Rua A, 1' } as never, { userId: 'adm' } as never);
    expect(res).toMatchObject({ siteAxisId: 's-1', responsibleAxisUserId: 'u-1', addressText: 'Rua A, 1', referenceWarnings: ['Projeto p-novo ainda não sincronizado do Axis.'] });
    expect(b.audit.record.mock.calls[0][4]).toMatchObject({ referenceWarnings: ['Projeto p-novo ainda não sincronizado do Axis.'] });
  });
});

describe('custódia pela pessoa (L3): usuário + colaborador ligado', () => {
  it('resolveOwnIds junta o usuário, o colaborador do token e o colaborador do cache USER', async () => {
    expect(await resolveOwnIds(cache([USER_LINKED]), { userId: 'u-1', collaboratorId: null })).toEqual(['u-1', 'c-1']);
    expect(await resolveOwnIds(cache([USER_LINKED]), { userId: 'u-1', collaboratorId: 'c-1' })).toEqual(['u-1', 'c-1']);
    expect(await resolveOwnIds(cache([]), { userId: 'u-2', collaboratorId: 'c-2' })).toEqual(['u-2', 'c-2']);
  });

  it('custodianIdFor grava o colaborador quando o recebedor é um usuário ligado a ele; senão o id como veio', async () => {
    const db = cache([USER_LINKED]);
    expect(await custodianIdFor(db, 'u-1')).toBe('c-1');
    expect(await custodianIdFor(db, 'c-7')).toBe('c-7');
  });

  const custody = (rows: CacheRow[]) => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = { ...cache(rows), custodyTerm: { findMany, count }, $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)) };
    return { svc: new ReturnsService(prisma as never, {} as never, {} as never), findMany };
  };
  const me = { userId: 'u-1', collaboratorId: null, permissions: ['stock:read'] } as never;

  it('"minha custódia" busca pelo usuário e pelo colaborador ligado (termos novos e antigos)', async () => {
    const c = custody([USER_LINKED]);
    await c.svc.listCustody({}, me);
    expect(c.findMany.mock.calls[0][0].where).toEqual({ custodianAxisId: { in: ['u-1', 'c-1'] } });
  });

  it('pode filtrar pelo próprio colaborador; o de outra pessoa é 403', async () => {
    const c = custody([USER_LINKED]);
    await c.svc.listCustody({ custodianAxisId: 'c-1' }, me);
    expect(c.findMany.mock.calls[0][0].where).toEqual({ custodianAxisId: 'c-1' });
    await expect(c.svc.listCustody({ custodianAxisId: 'c-outro' }, me)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('o termo de custódia (documento) abre para o colaborador ligado ao usuário e mostra nomes', async () => {
    const term = { id: 't-1', seq: 2, custodianAxisId: 'c-1', materialId: 'm-1', serialId: null, quantity: 1, projectAxisId: 'p-1', deliveredAt: new Date(), expectedReturnAt: null, status: 'ATIVO', acceptanceRef: null };
    const prisma = {
      ...cache([USER_LINKED, PROJ, { kind: 'COLLABORATOR', axisId: 'c-1', code: null, name: 'Ana Souza', active: true }]),
      custodyTerm: { findUnique: vi.fn().mockResolvedValue(term) },
      material: { findUniqueOrThrow: vi.fn().mockResolvedValue({ code: 'EPI-1', shortDescription: 'Capacete', stockUom: { code: 'UN' } }) },
    };
    const docs = new DocumentsService(prisma as never, {} as never);
    const doc = await docs.custody('t-1', me);
    expect(doc.header).toMatchObject({ Custodiante: 'Ana Souza', Projeto: 'PRJ-001 — Data center Sumaré' });
    await expect(docs.custody('t-1', { userId: 'u-outro', collaboratorId: null, permissions: [] } as never)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('ordens de atendimento também usam o colaborador do cache quando o token não traz', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { ...cache([USER_LINKED]), fulfillmentOrder: { count: vi.fn().mockResolvedValue(0), findMany }, $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)) };
    await new FulfillmentService(prisma as never, {} as never).list({}, { userId: 'u-1', collaboratorId: null, permissions: ['fulfillment:read'] } as never);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ OR: [{ requesterAxisId: 'u-1' }, { recipientAxisId: { in: ['u-1', 'c-1'] } }] });
  });
});

describe('GET /axis/lookup (V4): cache do Core para seletores', () => {
  let app: INestApplication;
  const findMany = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [AxisLookupController], providers: [AxisLookupService, { provide: PrismaService, useValue: { axisMasterCache: { findMany } } }] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  });
  afterAll(() => app?.close());

  it('exige stock:read (leitura básica de qualquer perfil)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, Object.getOwnPropertyDescriptor(AxisLookupController.prototype, 'lookup')!.value as object)).toEqual(['stock:read']);
  });

  it('busca por nome ou código, só ativos, ordenada por nome, com limite', async () => {
    findMany.mockResolvedValueOnce([{ kind: 'PROJECT', axisId: 'p-1', code: 'PRJ-001', name: 'Data center Sumaré', active: true }]);
    const res = await request(app.getHttpServer()).get('/axis/lookup?kind=PROJECT&search=%20sum%20&limit=5').expect(200);
    expect(res.body).toEqual({ items: [{ kind: 'PROJECT', id: 'p-1', code: 'PRJ-001', name: 'Data center Sumaré', active: true }] });
    expect(findMany.mock.calls.at(-1)![0]).toMatchObject({
      where: { kind: { in: ['PROJECT'] }, active: true, OR: [{ name: { contains: 'sum', mode: 'insensitive' } }, { code: { contains: 'sum', mode: 'insensitive' } }] },
      orderBy: [{ name: 'asc' }, { code: 'asc' }], take: 5,
    });
  });

  it('ids resolve nomes de vários tipos (pessoa = COLLABORATOR,USER), incluindo inativos', async () => {
    findMany.mockResolvedValueOnce([{ kind: 'COLLABORATOR', axisId: 'c-gone', code: null, name: 'Desligado', active: false }]);
    const res = await request(app.getHttpServer()).get('/axis/lookup?kind=COLLABORATOR,USER&ids=c-gone,u-9').expect(200);
    expect(res.body.items[0]).toEqual({ kind: 'COLLABORATOR', id: 'c-gone', code: null, name: 'Desligado', active: false });
    expect(findMany.mock.calls.at(-1)![0].where).toEqual({ kind: { in: ['COLLABORATOR', 'USER'] }, axisId: { in: ['c-gone', 'u-9'] } });
  });

  it('kind ausente ou inválido, limite acima do máximo e ids+search juntos', async () => {
    await request(app.getHttpServer()).get('/axis/lookup?search=x').expect(400);
    const bad = await request(app.getHttpServer()).get('/axis/lookup?kind=COMPANY').expect(400);
    expect(JSON.stringify(bad.body.message)).toContain('kind inválido');
    findMany.mockResolvedValueOnce([]);
    await request(app.getHttpServer()).get('/axis/lookup?kind=SITE&limit=500').expect(200);
    expect(findMany.mock.calls.at(-1)![0].take).toBe(50);
    await request(app.getHttpServer()).get('/axis/lookup?kind=SITE&ids=a&search=b').expect(400);
  });

  it('includeInactive=true lista também os inativos', async () => {
    findMany.mockResolvedValueOnce([]);
    await request(app.getHttpServer()).get('/axis/lookup?kind=CLIENT&includeInactive=true').expect(200);
    expect(findMany.mock.calls.at(-1)![0].where).toEqual({ kind: { in: ['CLIENT'] } });
  });

  it('serviço recusa ids e search juntos (400)', async () => {
    await expect(new AxisLookupService({} as never).lookup({ kind: ['SITE'], ids: ['a'], search: 'b' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
