import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { StockService, movementCode } from '../../src/stock/stock.service.js';
import type { AuthenticatedUser } from '../../src/auth/authenticated-request.js';

// Casos de borda do ledger (StockService) sem banco: validateShape, tipos de movimento, ajustes, estorno e listagens.

const KEY = 'chave-idempotente-01';
const MAT = '00000000-0000-4000-8000-000000000001';
const LOC_A = '00000000-0000-4000-8000-00000000000a';
const LOC_B = '00000000-0000-4000-8000-00000000000b';

const user = (permissions: string[] = []): AuthenticatedUser => ({
  userId: 'u-unit',
  email: 'u@lgc.test',
  axisRoles: [],
  collaboratorId: null,
  mustChangePassword: false,
  permissions,
});

const ALL_PERMS = ['stock:post', 'stock:adjust', 'stock:reverse', 'material:read_cost'];

function build(rbacWarehouses: string[] | 'ALL' = 'ALL') {
  const tx = {
    material: { findUnique: vi.fn() },
    location: { findMany: vi.fn().mockResolvedValue([]) },
    lot: { findUnique: vi.fn() },
    serialNumber: { findUnique: vi.fn(), updateMany: vi.fn() },
    stockBalance: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), upsert: vi.fn().mockResolvedValue({}) },
    stockMovement: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'mov-new', seq: 9, registeredAt: new Date('2026-10-31T12:00:00Z'), ...data })),
    },
    integrationMessage: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    stockMovement: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    stockBalance: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn(async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (t: typeof tx) => unknown)(tx))),
  };
  const rbac = {
    assertWarehouseAccess: vi.fn().mockResolvedValue(undefined),
    accessibleWarehouseIds: vi.fn().mockResolvedValue(rbacWarehouses),
  };
  const service = new StockService(prisma as never, rbac as never);
  const shape = (dto: Record<string, unknown>) => (service as unknown as { validateShape: (d: unknown) => void }).validateShape(dto);
  return { service, prisma, rbac, tx, shape };
}

const material = (over: Record<string, unknown> = {}) => ({
  id: MAT, status: 'ATIVO', code: 'MAT-1', category: 'Teste', lotControlled: false, serialControlled: false, expiryControlled: false,
  stockUomId: 'uom-un', stockUom: { code: 'UN', precision: 0 }, ...over,
});

const movementRow = (over: Record<string, unknown> = {}) => ({
  id: 'mov-orig', seq: 3, type: 'SAIDA_ENTREGA', materialId: MAT, quantity: new Prisma.Decimal(2), lotId: null, serialId: null,
  fromLocationId: LOC_A, toLocationId: null, fromCondition: 'DISPONIVEL', toCondition: 'DISPONIVEL', ownership: 'PROPRIO',
  axisDocumentRef: null, projectAxisId: null, costCenterAxisId: null, clientAxisId: null, unitCost: null, correlationId: 'corr-1',
  reversesMovementId: null, reversedBy: null, registeredAt: new Date('2026-10-30T10:00:00Z'), ...over,
});

const dto = (over: Record<string, unknown> = {}) => ({ type: 'ENTRADA_RECEBIMENTO', materialId: MAT, quantity: 1, reason: 'Recebimento', ...over });

describe('movementCode', () => {
  it('preenche com zeros até 8 dígitos e não trunca códigos maiores', () => {
    expect(movementCode(1)).toBe('MOV-00000001');
    expect(movementCode(12345678)).toBe('MOV-12345678');
    expect(movementCode(123456789)).toBe('MOV-123456789');
  });
});

describe('StockService.validateShape (forma por tipo de movimento)', () => {
  it('entradas exigem destino e proíbem origem', () => {
    const { shape } = build();
    expect(() => shape({ type: 'ENTRADA_RECEBIMENTO', toLocationId: LOC_A })).not.toThrow();
    expect(() => shape({ type: 'ENTRADA_RECEBIMENTO' })).toThrow(new BadRequestException('Informe o endereço de destino.'));
    expect(() => shape({ type: 'ENTRADA_DEVOLUCAO', toLocationId: LOC_A, fromLocationId: LOC_B })).toThrow('Entradas não têm endereço de origem.');
  });

  it('ajustes positivos são entradas: não aceitam origem', () => {
    const { shape } = build();
    expect(() => shape({ type: 'AJUSTE_POSITIVO', toLocationId: LOC_A })).not.toThrow();
    expect(() => shape({ type: 'AJUSTE_POSITIVO', fromLocationId: LOC_A, toLocationId: LOC_B })).toThrow('Entradas não têm endereço de origem.');
  });

  it.each(['SAIDA_ENTREGA', 'AJUSTE_NEGATIVO', 'BAIXA_PERDA', 'DESCARTE'])('%s exige origem e proíbe destino', (type) => {
    const { shape } = build();
    expect(() => shape({ type, fromLocationId: LOC_A })).not.toThrow();
    expect(() => shape({ type })).toThrow('Informe o endereço de origem.');
    expect(() => shape({ type, fromLocationId: LOC_A, toLocationId: LOC_B })).toThrow('Saídas não têm endereço de destino.');
  });

  it('transferência exige origem e destino', () => {
    const { shape } = build();
    expect(() => shape({ type: 'TRANSFERENCIA', fromLocationId: LOC_A, toLocationId: LOC_B })).not.toThrow();
    expect(() => shape({ type: 'TRANSFERENCIA', fromLocationId: LOC_A })).toThrow('Transferência exige endereço de origem e de destino.');
    expect(() => shape({ type: 'TRANSFERENCIA', toLocationId: LOC_B })).toThrow('Transferência exige endereço de origem e de destino.');
  });

  it('origem e destino iguais só geram movimento se a condição mudar', () => {
    const { shape } = build();
    expect(() => shape({ type: 'TRANSFERENCIA', fromLocationId: LOC_A, toLocationId: LOC_A })).toThrow('não geram movimento');
    expect(() => shape({ type: 'TRANSFERENCIA', fromLocationId: LOC_A, toLocationId: LOC_A, fromCondition: 'DISPONIVEL', toCondition: 'DISPONIVEL' })).toThrow('não geram movimento');
    expect(() => shape({ type: 'TRANSFERENCIA', fromLocationId: LOC_A, toLocationId: LOC_A, fromCondition: 'QUARENTENA', toCondition: 'DISPONIVEL' })).not.toThrow();
    // condição omitida conta como DISPONIVEL
    expect(() => shape({ type: 'TRANSFERENCIA', fromLocationId: LOC_A, toLocationId: LOC_A, toCondition: 'DISPONIVEL' })).toThrow('não geram movimento');
  });

  it('todo tipo do enum MovementType tem uma forma aceita (guarda para tipos novos)', () => {
    const { shape } = build();
    const entries = ['ENTRADA_RECEBIMENTO', 'ENTRADA_DEVOLUCAO', 'AJUSTE_POSITIVO'];
    const exits = ['SAIDA_ENTREGA', 'AJUSTE_NEGATIVO', 'BAIXA_PERDA', 'DESCARTE'];
    for (const type of Object.values(MovementType)) {
      const ok = entries.includes(type) ? { toLocationId: LOC_A } : exits.includes(type) ? { fromLocationId: LOC_A } : type === 'TRANSFERENCIA' ? { fromLocationId: LOC_A, toLocationId: LOC_B } : undefined;
      expect(ok, `tipo ${type} sem forma definida em validateShape`).toBeDefined();
      expect(() => shape({ type, ...ok })).not.toThrow();
    }
  });
});

describe('StockService.post — pré-validações', () => {
  it('Idempotency-Key ausente, curta (<8) ou longa (>120) é recusada antes de tocar no banco', async () => {
    const { service, prisma } = build();
    for (const key of ['', 'abc1234', 'x'.repeat(121)]) {
      await expect(service.post(dto() as never, key, user(ALL_PERMS))).rejects.toThrow(BadRequestException);
    }
    expect(prisma.stockMovement.findUnique).not.toHaveBeenCalled();
  });

  it('chave com exatamente 8 e 120 caracteres é aceita no formato', async () => {
    const { service, prisma } = build();
    prisma.stockMovement.findUnique.mockResolvedValue(movementRow({ type: 'ENTRADA_RECEBIMENTO', toLocationId: LOC_A, fromLocationId: null, seq: 1 }));
    await expect(service.post(dto({ toLocationId: LOC_A }) as never, 'x'.repeat(8), user(ALL_PERMS))).resolves.toMatchObject({ replayed: true });
    await expect(service.post(dto({ toLocationId: LOC_A }) as never, 'x'.repeat(120), user(ALL_PERMS))).resolves.toMatchObject({ replayed: true });
  });

  it('ajuste/perda/descarte exige stock:adjust (não basta stock:post)', async () => {
    const { service } = build();
    await expect(service.post(dto({ type: 'AJUSTE_POSITIVO', toLocationId: LOC_A, axisApprovalRef: 'APR-1' }) as never, KEY, user(['stock:post'])))
      .rejects.toThrow(new ForbiddenException('Permissão insuficiente. Necessário: stock:adjust.'));
    await expect(service.post(dto({ type: 'DESCARTE', fromLocationId: LOC_A, axisApprovalRef: 'APR-1' }) as never, KEY, user(['stock:post'])))
      .rejects.toThrow(ForbiddenException);
  });

  it('ajuste sem axisApprovalRef é recusado mesmo com stock:adjust', async () => {
    const { service } = build();
    await expect(service.post(dto({ type: 'BAIXA_PERDA', fromLocationId: LOC_A }) as never, KEY, user(['stock:adjust'])))
      .rejects.toThrow('exigem a referência de aprovação do Axis');
  });

  it('movimento comum sem stock:post é 403', async () => {
    const { service } = build();
    await expect(service.post(dto({ toLocationId: LOC_A }) as never, KEY, user([]))).rejects.toThrow('Necessário: stock:post.');
  });

  it('replay devolve o movimento original com código e replayed=true, sem nova transação', async () => {
    const { service, prisma } = build();
    prisma.stockMovement.findUnique.mockResolvedValueOnce(movementRow({ seq: 7, type: 'ENTRADA_RECEBIMENTO', fromLocationId: null, toLocationId: LOC_A }));
    const r = await service.post(dto({ toLocationId: LOC_A }) as never, KEY, user(ALL_PERMS));
    expect(r).toMatchObject({ code: 'MOV-00000007', replayed: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('quantidade com mais casas decimais que a unidade (UN = 0) é recusada', async () => {
    const { service, tx } = build();
    tx.material.findUnique.mockResolvedValue(material());
    tx.location.findMany.mockResolvedValue([{ id: LOC_A, warehouseId: 'w', status: 'ATIVO', code: 'A', allowedCategories: [], warehouse: { status: 'ATIVO' } }]);
    await expect(service.post(dto({ quantity: 1.5, toLocationId: LOC_A }) as never, KEY, user(ALL_PERMS))).rejects.toThrow('no máximo 0 casa(s)');
  });

  it('material inexistente ou inativo não recebe movimento', async () => {
    const { service, tx } = build();
    tx.material.findUnique.mockResolvedValueOnce(null);
    await expect(service.post(dto({ toLocationId: LOC_A }) as never, KEY, user(ALL_PERMS))).rejects.toThrow('Material não encontrado.');
    tx.material.findUnique.mockResolvedValueOnce(material({ status: 'INATIVO' }));
    await expect(service.post(dto({ toLocationId: LOC_A }) as never, KEY, user(ALL_PERMS))).rejects.toThrow('Material inativo');
  });

  it('material com controle de lote sem lote é recusado; lote informado em material sem controle também', async () => {
    const { service, tx } = build();
    tx.material.findUnique.mockResolvedValue(material({ lotControlled: true }));
    tx.location.findMany.mockResolvedValue([{ id: LOC_A, warehouseId: 'w', status: 'ATIVO', code: 'A', allowedCategories: [], warehouse: { status: 'ATIVO' } }]);
    await expect(service.post(dto({ toLocationId: LOC_A }) as never, KEY, user(ALL_PERMS))).rejects.toThrow('controlado por lote');
    tx.material.findUnique.mockResolvedValue(material());
    await expect(service.post(dto({ toLocationId: LOC_A, lotId: LOC_B }) as never, KEY, user(ALL_PERMS))).rejects.toThrow('não é controlado por lote');
  });
});

describe('StockService.post — conversão de erros de banco', () => {
  it('P2002 com a mesma chave devolve o movimento existente (corrida de idempotência)', async () => {
    const { service, prisma } = build();
    const dup = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5.0.0' });
    prisma.stockMovement.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(movementRow({ seq: 4, type: 'ENTRADA_RECEBIMENTO', fromLocationId: null, toLocationId: LOC_A }));
    prisma.$transaction.mockRejectedValueOnce(dup);
    await expect(service.post(dto({ toLocationId: LOC_A }) as never, KEY, user(ALL_PERMS))).resolves.toMatchObject({ code: 'MOV-00000004', replayed: true });
  });

  it('P2002 sem linha com a chave é conflito (ex.: estorno duplo concorrente)', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5.0.0' }));
    await expect(service.post(dto({ toLocationId: LOC_A }) as never, KEY, user(ALL_PERMS))).rejects.toThrow(ConflictException);
  });

  it('violação do CHECK de saldo vira 422 de negócio', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockRejectedValueOnce(new Error('new row violates check constraint "stock_balances_quantity_nonneg"'));
    await expect(service.post(dto({ toLocationId: LOC_A }) as never, KEY, user(ALL_PERMS))).rejects.toThrow(UnprocessableEntityException);
  });

  it('erro desconhecido é propagado sem disfarce', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockRejectedValueOnce(new Error('falha de rede'));
    await expect(service.post(dto({ toLocationId: LOC_A }) as never, KEY, user(ALL_PERMS))).rejects.toThrow('falha de rede');
  });
});

describe('StockService.reverse', () => {
  it('chave inválida ou sem stock:reverse é recusado', async () => {
    const { service } = build();
    await expect(service.reverse('mov-orig', { reason: 'Engano' } as never, 'curta', user(ALL_PERMS))).rejects.toThrow(BadRequestException);
    await expect(service.reverse('mov-orig', { reason: 'Engano' } as never, KEY, user(['stock:post']))).rejects.toThrow('Necessário: stock:reverse.');
  });

  it('movimento inexistente é 404', async () => {
    const { service, prisma } = build();
    prisma.stockMovement.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(service.reverse('x', { reason: 'Engano' } as never, KEY, user(ALL_PERMS))).rejects.toThrow(NotFoundException);
  });

  it('não se estorna um estorno', async () => {
    const { service, prisma } = build();
    prisma.stockMovement.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(movementRow({ reversesMovementId: 'mov-x' }));
    await expect(service.reverse('mov-orig', { reason: 'Engano' } as never, KEY, user(ALL_PERMS))).rejects.toThrow('não pode ser estornado');
  });

  it('segundo estorno do mesmo movimento é 409', async () => {
    const { service, prisma } = build();
    prisma.stockMovement.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(movementRow({ reversedBy: { id: 'mov-rev' } }));
    await expect(service.reverse('mov-orig', { reason: 'Engano' } as never, KEY, user(ALL_PERMS))).rejects.toThrow(ConflictException);
  });

  it('estorno de saída troca origem/destino e condições, mantém o vínculo e o motivo original', async () => {
    const { service, prisma, tx } = build();
    prisma.stockMovement.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(movementRow({ fromCondition: 'DISPONIVEL', toCondition: 'DISPONIVEL' }));
    tx.material.findUnique.mockResolvedValue(material());
    tx.location.findMany.mockResolvedValue([{ id: LOC_A, warehouseId: 'w', status: 'ATIVO', code: 'A', allowedCategories: [], warehouse: { status: 'ATIVO' } }]);

    await service.reverse('mov-orig', { reason: 'Cliente devolveu' } as never, KEY, user(ALL_PERMS));

    const data = tx.stockMovement.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      type: 'SAIDA_ENTREGA', fromLocationId: undefined, toLocationId: LOC_A, reversesMovementId: 'mov-orig', correlationId: 'corr-1',
      reason: 'Estorno de MOV-00000003: Cliente devolveu',
    });
    expect(tx.integrationMessage.create.mock.calls[0][0].data.eventType).toBe('stock.movement.reversed');
  });

  it('estorno não passa pela regra de categoria do endereço de destino', async () => {
    const { service, prisma, tx } = build();
    prisma.stockMovement.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(movementRow({ type: 'SAIDA_ENTREGA', fromLocationId: LOC_A, toLocationId: null }));
    tx.material.findUnique.mockResolvedValue(material({ category: 'Outra' }));
    tx.location.findMany.mockResolvedValue([{ id: LOC_A, warehouseId: 'w', status: 'BLOQUEADO', code: 'A', allowedCategories: ['Teste'], warehouse: { status: 'ATIVO' } }]);
    await expect(service.reverse('mov-orig', { reason: 'Estorno' } as never, KEY, user(ALL_PERMS))).resolves.toBeDefined();
  });
});

describe('StockService.listBalances — disponível', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    materialId: MAT, locationId: LOC_A, lotId: null, condition: 'DISPONIVEL', ownership: 'PROPRIO',
    quantity: new Prisma.Decimal(10), reservedQty: new Prisma.Decimal(4), lot: null, location: { code: 'A1', warehouseId: 'w1' }, ...over,
  });
  const list = async (rows: unknown[], query: Record<string, unknown> = {}, wh: string[] | 'ALL' = 'ALL') => {
    const { service, prisma, rbac } = build(wh);
    rbac.accessibleWarehouseIds.mockResolvedValue(wh);
    prisma.stockBalance.count.mockResolvedValue(rows.length);
    prisma.stockBalance.findMany.mockResolvedValue(rows);
    const res = await service.listBalances(query as never, user(['stock:read']));
    return { res, where: prisma.stockBalance.findMany.mock.calls[0][0].where };
  };

  it('disponível = quantidade − reservado em condição DISPONIVEL sem lote', async () => {
    const { res } = await list([row()]);
    expect(res.items[0]).toMatchObject({ quantity: '10', reserved: '4', available: '6', lotNumber: null });
  });

  it.each(['QUARENTENA', 'BLOQUEADO', 'AVARIADO'])('condição %s não compõe disponível', async (condition) => {
    const { res } = await list([row({ condition })]);
    expect(res.items[0].available).toBe('0');
    expect(res.items[0].quantity).toBe('10');
  });

  it('lote bloqueado/quarentena ou vencido ontem não compõe disponível; vencendo hoje compõe', async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00Z');
    const lot = (over: Record<string, unknown>) => ({ lotNumber: 'L1', status: 'LIBERADO', expiresAt: null, ...over });
    const { res } = await list([
      row({ lot: lot({ status: 'BLOQUEADO' }) }),
      row({ lot: lot({ status: 'QUARENTENA' }), locationId: 'l2' }),
      row({ lot: lot({ expiresAt: yesterday }), locationId: 'l3' }),
      row({ lot: lot({ expiresAt: today }), locationId: 'l4' }),
    ]);
    expect(res.items.map((i) => i.available)).toEqual(['0', '0', '0', '6']);
  });

  it('usuário restrito sem filtro é limitado aos almoxarifados acessíveis; filtro de almoxarifado fora do escopo não vaza', async () => {
    const restricted = await list([], {}, ['w1']);
    expect(restricted.where.location).toEqual({ warehouseId: { in: ['w1'] } });
    const outside = await list([], { warehouseId: 'w9' }, ['w1']);
    expect(outside.where.location).toEqual({ warehouseId: '-' });
  });

  it('consulta sempre exclui saldo zerado e pagina com padrão de 50', async () => {
    const { where } = await list([]);
    expect(where.quantity).toEqual({ gt: 0 });
    const { service, prisma, rbac } = build();
    rbac.accessibleWarehouseIds.mockResolvedValue('ALL');
    prisma.stockBalance.count.mockResolvedValue(0);
    prisma.stockBalance.findMany.mockResolvedValue([]);
    const r = await service.listBalances({} as never, user(['stock:read']));
    expect(r).toMatchObject({ page: 1, pageSize: 50 });
    expect(prisma.stockBalance.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 50 });
  });
});

describe('StockService.listMovements — escopo e custo', () => {
  const movs = [movementRow({ unitCost: new Prisma.Decimal('9.9') })];
  const run = async (perms: string[], wh: string[] | 'ALL' = 'ALL', query: Record<string, unknown> = {}) => {
    const { service, prisma, rbac } = build();
    rbac.accessibleWarehouseIds.mockResolvedValue(wh);
    prisma.stockMovement.count.mockResolvedValue(movs.length);
    prisma.stockMovement.findMany.mockResolvedValue(movs);
    const res = await service.listMovements(query as never, user(perms));
    return { res, args: prisma.stockMovement.findMany.mock.calls[0][0] };
  };

  it('oculta unitCost sem material:read_cost e mostra com a permissão', async () => {
    const hidden = await run(['stock:read']);
    expect(hidden.res.items[0]).not.toHaveProperty('unitCost');
    const shown = await run(['stock:read', 'material:read_cost']);
    expect(shown.res.items[0]).toHaveProperty('unitCost');
  });

  it('usuário com escopo vê só movimentos que tocam os almoxarifados acessíveis (origem OU destino)', async () => {
    const { args } = await run(['stock:read'], ['w1']);
    expect(args.where.AND[0]).toEqual({ OR: [{ fromLocation: { warehouseId: { in: ['w1'] } } }, { toLocation: { warehouseId: { in: ['w1'] } } }] });
  });

  it('padrão de paginação e ordenação por sequência decrescente', async () => {
    const { args, res } = await run(['stock:read']);
    expect(args).toMatchObject({ skip: 0, take: 20, orderBy: { seq: 'desc' } });
    expect(res).toMatchObject({ page: 1, pageSize: 20, total: 1 });
  });

  it('página 3 de 5 por página calcula skip=10', async () => {
    const { args } = await run(['stock:read'], 'ALL', { page: 3, pageSize: 5 });
    expect(args).toMatchObject({ skip: 10, take: 5 });
  });

  it('filtro de data usa só o limite informado', async () => {
    const onlyFrom = await run(['stock:read'], 'ALL', { from: '2026-01-01T00:00:00Z' });
    expect(onlyFrom.args.where.AND[1].effectiveAt).toEqual({ gte: new Date('2026-01-01T00:00:00Z') });
    const onlyTo = await run(['stock:read'], 'ALL', { to: '2026-01-31T23:59:59Z' });
    expect(onlyTo.args.where.AND[1].effectiveAt).toEqual({ lte: new Date('2026-01-31T23:59:59Z') });
  });

  it('filtro por local casa origem ou destino', async () => {
    const { args } = await run(['stock:read'], 'ALL', { locationId: LOC_A });
    expect(args.where.AND[1].OR).toEqual([{ fromLocationId: LOC_A }, { toLocationId: LOC_A }]);
  });
});
