import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransfersService, transferCode } from '../../src/transfers/transfers.service.js';
import type { AuthenticatedUser } from '../../src/auth/authenticated-request.js';

// Regras de approve / dispatch / receive / cancel com Prisma e StockService mockados (sem banco).

const D = (v: number | string) => new Prisma.Decimal(v);
const SOLIC = 'u-solic';
const APROV = 'u-aprov';
const user = (userId: string): AuthenticatedUser => ({ userId, email: 'u@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions: [] });

const item = (over: Record<string, unknown> = {}) => ({
  id: 'it-1', materialId: 'mat-1', fromLocationId: 'loc-orig', lotId: null, serialId: null, quantity: D(4), balanceId: 'bal-1', reservedQty: D(4), ...over,
});
const transfer = (over: Record<string, unknown> = {}) => ({
  id: 'trf-1', seq: 7, status: 'APROVADA', urgent: false, fromWarehouseId: 'wh-orig', toWarehouseId: 'wh-dest', requestedBy: SOLIC, items: [item()], ...over,
});

function build(t: Record<string, unknown>, opts: { affected?: number; destLocation?: boolean; warehouseScope?: string[] | 'ALL' } = {}) {
  const tx = {
    transfer: { findUnique: vi.fn().mockResolvedValue(t), update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...t, ...data })) },
    transferItem: { update: vi.fn().mockResolvedValue({}) },
    stockBalance: { findUnique: vi.fn().mockResolvedValue({ id: 'bal-1' }) },
    warehouse: { upsert: vi.fn().mockResolvedValue({ id: 'wh-transit' }) },
    location: { upsert: vi.fn().mockResolvedValue({ id: 'loc-transit' }), findFirst: vi.fn().mockResolvedValue(opts.destLocation === false ? null : { id: 'loc-dest' }) },
    material: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'mat-1', serialControlled: false }) },
    $executeRaw: vi.fn().mockResolvedValue(opts.affected ?? 1),
    integrationMessage: { create: vi.fn().mockResolvedValue({}) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (x: typeof tx) => unknown) => fn(tx)),
    transfer: { findUnique: vi.fn().mockResolvedValue(t) },
  };
  const rbac = {
    assertWarehouseAccess: vi.fn().mockResolvedValue(undefined),
    accessibleWarehouseIds: vi.fn().mockResolvedValue(opts.warehouseScope ?? 'ALL'),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const stock = { applyInternal: vi.fn().mockResolvedValue({}) };
  const service = new TransfersService(prisma as never, rbac as never, audit as never, stock as never);
  return { service, tx, rbac, audit, stock };
}

describe('transferCode', () => {
  it('formata TRF com 8 dígitos', () => {
    expect(transferCode(42)).toBe('TRF-00000042');
  });
});

describe('approve — reserva na origem (9.7)', () => {
  it('bloqueia quem solicitou a própria transferência (segregação de funções)', async () => {
    const { service } = build(transfer({ status: 'SOLICITADA', requestedBy: SOLIC }));
    await expect(service.approve('trf-1', user(SOLIC))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('exige status SOLICITADA', async () => {
    const { service } = build(transfer({ status: 'APROVADA' }));
    await expect(service.approve('trf-1', user(APROV))).rejects.toBeInstanceOf(ConflictException);
  });

  it('saldo insuficiente (UPDATE afeta 0 linhas) gera 422 INSUFFICIENT_STOCK e não aprova', async () => {
    const { service, tx } = build(transfer({ status: 'SOLICITADA' }), { affected: 0 });
    const err = await service.approve('trf-1', user(APROV)).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse().code).toBe('INSUFFICIENT_STOCK');
    expect(tx.transfer.update).not.toHaveBeenCalled();
  });

  it('sem saldo DISPONIVEL próprio no endereço de origem também recusa', async () => {
    const { service, tx } = build(transfer({ status: 'SOLICITADA' }));
    tx.stockBalance.findUnique.mockResolvedValue(null);
    await expect(service.approve('trf-1', user(APROV))).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('reserva usando o saldo de lote vazio quando o item não tem lote', async () => {
    const { service, tx } = build(transfer({ status: 'SOLICITADA' }));
    await service.approve('trf-1', user(APROV));
    expect(tx.stockBalance.findUnique.mock.calls[0][0].where.materialId_locationId_lotKey_condition_ownership).toMatchObject({ lotKey: '', condition: 'DISPONIVEL', ownership: 'PROPRIO' });
  });
});

describe('startPicking e dispatch', () => {
  it('separação só para transferências APROVADAS', async () => {
    const { service } = build(transfer({ status: 'SOLICITADA' }));
    await expect(service.startPicking('trf-1', user(APROV))).rejects.toBeInstanceOf(ConflictException);
  });

  it('não urgente, ainda APROVADA, não pode expedir sem separação', async () => {
    const { service } = build(transfer({ status: 'APROVADA', urgent: false }));
    await expect(service.dispatch('trf-1', user(APROV))).rejects.toBeInstanceOf(ConflictException);
  });

  it('urgente aprovada expede direto e registra auditoria', async () => {
    const { service, audit } = build(transfer({ status: 'APROVADA', urgent: true }));
    await service.dispatch('trf-1', user(APROV));
    expect(audit.record).toHaveBeenCalledWith(APROV, 'transfer.urgent_dispatch', 'transfer', 'trf-1', expect.anything(), expect.anything());
  });

  it('expedição baixa a origem e lança no endereço de trânsito, em BLOQUEADO', async () => {
    const { service, stock } = build(transfer({ status: 'SEPARANDO' }));
    await service.dispatch('trf-1', user(APROV));
    expect(stock.applyInternal.mock.calls[0][1]).toMatchObject({ fromLocationId: 'loc-orig', toLocationId: 'loc-transit', fromCondition: 'DISPONIVEL', toCondition: 'BLOQUEADO' });
  });

  it('cancelar depois de expedir (EM_TRANSITO) é recusado', async () => {
    const { service } = build(transfer({ status: 'EM_TRANSITO' }));
    await expect(service.cancel('trf-1', { reason: 'Tarde' }, user(APROV))).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('receive — recebimento parcial por item', () => {
  const sent = (over: Record<string, unknown> = {}) => transfer({ status: 'EM_TRANSITO', items: [item({ quantity: D(4), reservedQty: D(0) })], ...over });

  it('quantidade recebida maior que a expedida é recusada', async () => {
    const { service } = build(sent());
    await expect(service.receive('trf-1', { items: [{ itemId: 'it-1', receivedQty: 5, toLocationId: 'loc-dest' }] }, user(APROV))).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('receber 0 não movimenta estoque e marca divergência', async () => {
    const { service, stock, tx } = build(sent());
    const out = await service.receive('trf-1', { items: [{ itemId: 'it-1', receivedQty: 0, toLocationId: 'loc-dest' }] }, user(APROV));
    expect(stock.applyInternal).not.toHaveBeenCalled();
    expect(tx.transfer.update.mock.calls[0][0].data).toMatchObject({ status: 'RECEBIDA', hasDivergence: true });
    expect(out.hasDivergence).toBe(true);
  });

  it('itens repetidos ou faltando são recusados', async () => {
    const { service } = build(sent({ items: [item({ id: 'it-1' }), item({ id: 'it-2' })] }));
    await expect(service.receive('trf-1', { items: [{ itemId: 'it-1', receivedQty: 4, toLocationId: 'loc-dest' }] }, user(APROV))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.receive('trf-1', { items: [{ itemId: 'it-1', receivedQty: 4, toLocationId: 'loc-dest' }, { itemId: 'it-1', receivedQty: 4, toLocationId: 'loc-dest' }] }, user(APROV))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('endereço de destino fora do almoxarifado de destino é recusado', async () => {
    const { service } = build(sent(), { destLocation: false });
    await expect(service.receive('trf-1', { items: [{ itemId: 'it-1', receivedQty: 4, toLocationId: 'loc-outro-wh' }] }, user(APROV))).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('recebimento exige status EM_TRANSITO', async () => {
    const { service } = build(sent({ status: 'APROVADA' }));
    await expect(service.receive('trf-1', { items: [{ itemId: 'it-1', receivedQty: 4, toLocationId: 'loc-dest' }] }, user(APROV))).rejects.toBeInstanceOf(ConflictException);
  });

  it('escopo: recebimento checa o almoxarifado de DESTINO, não o de origem', async () => {
    const { service, rbac } = build(sent());
    await service.receive('trf-1', { items: [{ itemId: 'it-1', receivedQty: 4, toLocationId: 'loc-dest' }] }, user(APROV));
    expect(rbac.assertWarehouseAccess).toHaveBeenCalledWith(expect.anything(), 'wh-dest');
  });
});

describe('close — divergência em aberto', () => {
  it('não encerra com divergência pendente', async () => {
    const { service } = build(transfer({ status: 'RECEBIDA', hasDivergence: true }));
    await expect(service.close('trf-1', user(APROV))).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
