import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { AxisWebhookService, ignoredReason } from '../../src/integration/axis-webhook.service.js';
import { adaptCorePurchase } from '../../src/integration/core-purchase.adapter.js';
import { ReplenishmentService } from '../../src/replenishment/replenishment.service.js';
import { JwtStrategy, LOGISTICA_ISSUER } from '../../src/auth/jwt.strategy.js';

// Onda V2 do mapa de interoperabilidade (docs/mapa-interoperabilidade.md §4/§6): o cache de cadastros do Core na Logística.

const OCCURRED = '2026-11-08T12:00:00.000Z';
type Row = { kind: string; axisId: string; code: string | null; name: string | null; active: boolean; data: Record<string, unknown>; sourceOccurredAt: Date };

/** Webhook com cache em memória; `handle` é chamado direto (sem assinatura) para testar a regra de cada evento. */
function webhook(initial: Row[] = []) {
  const rows = new Map(initial.map((r) => [`${r.kind}:${r.axisId}`, r]));
  const tx = {
    axisMasterCache: {
      findUnique: vi.fn(async ({ where }: { where: { kind_axisId: { kind: string; axisId: string } } }) => rows.get(`${where.kind_axisId.kind}:${where.kind_axisId.axisId}`) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { kind_axisId: { kind: string; axisId: string } }; create: Row; update: Partial<Row> }) => {
        const key = `${where.kind_axisId.kind}:${where.kind_axisId.axisId}`;
        const next = rows.has(key) ? { ...rows.get(key)!, ...update } : create;
        rows.set(key, next as Row);
        return next;
      }),
    },
  };
  const fulfillment = { createFromRequest: vi.fn(), cancelByAxisRequest: vi.fn() };
  const replenishment = { registerPurchase: vi.fn().mockResolvedValue(undefined) };
  const service = new AxisWebhookService({} as never, { get: vi.fn() } as never, fulfillment as never, replenishment as never);
  const handle = (eventType: string, payload: Record<string, unknown>, occurredAt = OCCURRED) =>
    (service as unknown as { handle: (tx: unknown, env: unknown) => Promise<string> }).handle(tx, { event_id: randomUUID(), event_type: eventType, occurred_at: occurredAt, payload });
  const get = (kind: string, id: string) => rows.get(`${kind}:${id}`);
  return { handle, get, tx, fulfillment, replenishment };
}

const row = (kind: string, axisId: string, over: Partial<Row> = {}): Row => ({ kind, axisId, code: null, name: 'Antigo', active: true, data: {}, sourceOccurredAt: new Date('2026-11-01T00:00:00Z'), ...over });

describe('collaborator.* (L2): o cache segue o status do Core', () => {
  it('collaborator.updated com status desligado marca inativo; o reenvio de cadastros não reativa desligados', async () => {
    const w = webhook([row('COLLABORATOR', 'c-1', { active: false })]);
    expect(await w.handle('collaborator.updated', { collaborator_id: 'c-1', name: 'Ana', status: 'desligado' })).toBe('processed');
    expect(w.get('COLLABORATOR', 'c-1')).toMatchObject({ active: false, name: 'Ana' });
  });

  it('status ativo (ou ferias/afastado) mantém ativo; active explícito do payload prevalece sobre o status', async () => {
    const w = webhook();
    await w.handle('collaborator.created', { collaborator_id: 'c-2', name: 'Bia', status: 'ferias' });
    expect(w.get('COLLABORATOR', 'c-2')?.active).toBe(true);
    await w.handle('collaborator.updated', { collaborator_id: 'c-2', name: 'Bia', status: 'ativo', active: false }, '2026-11-08T12:01:00.000Z');
    expect(w.get('COLLABORATOR', 'c-2')?.active).toBe(false);
  });

  it('collaborator.offboarded sempre inativa, mesmo sem status', async () => {
    const w = webhook([row('COLLABORATOR', 'c-3')]);
    await w.handle('collaborator.offboarded', { collaborator_id: 'c-3', offboarded_at: OCCURRED });
    expect(w.get('COLLABORATOR', 'c-3')?.active).toBe(false);
  });

  it('cost_center_changed mescla os dados sem forçar ativo (desligado continua inativo)', async () => {
    const w = webhook([row('COLLABORATOR', 'c-4', { active: false, data: { status: 'desligado', email: 'a@lgc' } })]);
    await w.handle('collaborator.cost_center_changed', { collaborator_id: 'c-4', name: 'Caio', previous_cost_center_id: 'cc-1', cost_center_id: null, valid_from: '2026-11-08' });
    const r = w.get('COLLABORATOR', 'c-4')!;
    expect(r.active).toBe(false);
    expect(r.data).toMatchObject({ status: 'desligado', email: 'a@lgc', cost_center_id: null, previous_cost_center_id: 'cc-1' });
  });

  it('updated e offboarded no mesmo instante (C8): qualquer ordem de chegada termina inativo', async () => {
    for (const order of [['collaborator.updated', 'collaborator.offboarded'], ['collaborator.offboarded', 'collaborator.updated']]) {
      const w = webhook([row('COLLABORATOR', 'c-5')]);
      for (const type of order) await w.handle(type, { collaborator_id: 'c-5', name: 'Duda', status: 'desligado', active: false });
      expect(w.get('COLLABORATOR', 'c-5')?.active).toBe(false);
    }
  });
});

describe('user.* (contrato V1): cache USER com nome, situação e colaborador', () => {
  const payload = { user_id: 'u-1', email: 'ana@lgc.com.br', name: 'Ana Souza', status: 'active', active: true, collaborator_id: 'c-1', roles: ['tecnico'] };

  it('user.created grava nome (não o e-mail), ativo e o payload com collaborator_id e roles', async () => {
    const w = webhook();
    expect(await w.handle('user.created', payload)).toBe('processed');
    expect(w.get('USER', 'u-1')).toMatchObject({ kind: 'USER', name: 'Ana Souza', active: true, data: { collaborator_id: 'c-1', roles: ['tecnico'] } });
  });

  it('sem name, cai para o e-mail', async () => {
    const w = webhook();
    await w.handle('user.updated', { user_id: 'u-2', email: 'sem.nome@lgc.com.br', status: 'active' });
    expect(w.get('USER', 'u-2')?.name).toBe('sem.nome@lgc.com.br');
  });

  it('user.disabled inativa; user.updated com status disabled ou active=false também; reativação volta a ativo', async () => {
    const w = webhook();
    await w.handle('user.created', payload, '2026-11-08T12:00:00.000Z');
    await w.handle('user.disabled', { ...payload, status: 'disabled', active: false }, '2026-11-08T12:01:00.000Z');
    expect(w.get('USER', 'u-1')?.active).toBe(false);
    await w.handle('user.updated', { ...payload, status: 'active', active: true }, '2026-11-08T12:02:00.000Z');
    expect(w.get('USER', 'u-1')?.active).toBe(true);
    await w.handle('user.updated', { user_id: 'u-1', email: 'ana@lgc.com.br', status: 'disabled' }, '2026-11-08T12:03:00.000Z');
    expect(w.get('USER', 'u-1')?.active).toBe(false);
  });

  it('user.disabled nunca reativa, mesmo que o payload venha com active=true por engano', async () => {
    const w = webhook();
    await w.handle('user.disabled', { ...payload, active: true });
    expect(w.get('USER', 'u-1')?.active).toBe(false);
  });
});

describe('client.* (contrato V1): nome do cliente', () => {
  it('usa name; sem name, legal_name; sem os dois, trade_name', async () => {
    const w = webhook();
    await w.handle('client.created', { client_id: 'cl-1', code: 42, name: 'ACME Ltda', legal_name: 'ACME Ltda', trade_name: 'ACME' });
    expect(w.get('CLIENT', 'cl-1')).toMatchObject({ code: '42', name: 'ACME Ltda', active: true });
    await w.handle('client.updated', { client_id: 'cl-2', code: 7, legal_name: 'Beta SA' });
    expect(w.get('CLIENT', 'cl-2')?.name).toBe('Beta SA');
    await w.handle('client.updated', { client_id: 'cl-3', code: 8, trade_name: 'Gama' });
    expect(w.get('CLIENT', 'cl-3')?.name).toBe('Gama');
  });

  it('client.deleted (deleted: true) inativa e mantém o nome já conhecido', async () => {
    const w = webhook([row('CLIENT', 'cl-1', { name: 'ACME Ltda' })]);
    await w.handle('client.deleted', { client_id: 'cl-1', code: 42, active: false, deleted: true });
    expect(w.get('CLIENT', 'cl-1')).toMatchObject({ active: false, name: 'ACME Ltda' });
  });
});

describe('eventos que a Logística não usa', () => {
  it.each(['job_title.created', 'job_title.deleted', 'holiday.created', 'holiday.deleted', 'certification.changed', 'request.submitted', 'sla.breached', 'finance_request.approved'])(
    '%s fica ignorado, sem passar pelo adaptador de requisição de material',
    async (type) => {
      const w = webhook();
      expect(await w.handle(type, { job_title_id: 'j', holiday_id: 'h', name: 'X', items: [] })).toBe('ignored');
      expect(w.fulfillment.createFromRequest).not.toHaveBeenCalled();
      expect(w.tx.axisMasterCache.upsert).not.toHaveBeenCalled();
      expect(ignoredReason(type, {})).toBe(`${type} não é usado pela Logística.`);
    },
  );

  it('receive grava o evento como IGNORED com o motivo em lastError', async () => {
    const secret = 'segredo-webhook-0123456789';
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      integrationMessage: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'msg-1' }), update },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
    };
    const service = new AxisWebhookService(prisma as never, { get: (k: string) => (k === 'AXIS_WEBHOOK_SECRET' ? secret : undefined) } as never, {} as never, {} as never);
    const raw = Buffer.from(JSON.stringify({ event_id: randomUUID(), event_type: 'holiday.created', occurred_at: new Date().toISOString(), payload: { holiday_id: 'h-1', date: '2026-12-25', name: 'Natal', active: true } }));
    const res = await service.receive(raw, 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
    expect(res.status).toBe('ignored');
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'IGNORED', lastError: 'holiday.created não é usado pela Logística.' });
  });
});

describe('purchase.* do Core (L5) → previsão de compra da reposição', () => {
  const purchase = (over: Record<string, unknown> = {}) => ({
    request_id: 'req-1', code: 'REQ-0042', cost_center_id: 'cc-1', project_id: 'p-1', requester_id: 'u-1', approved_at: OCCURRED, total: '150.00',
    groups: [
      { group_id: 'q-1', supplier: 'Fornecedor A', total: '100.00', order_number: 'PC-9', expected_delivery_date: '2026-11-20', items: [{ material_id: 'mat-1', description: 'Cabo', quantity: 10, unit_price: '10.00', total: '100.00' }, { material_id: null, description: 'Item livre', quantity: 1, unit_price: '5.00', total: '5.00' }] },
      { group_id: 'estoque', supplier: 'Estoque', total: '50.00', items: [{ material_id: 'mat-2', description: 'Conector', quantity: 5, unit_price: '10.00', total: '50.00' }] },
    ],
    ...over,
  });

  it('sem warehouse_code (o Core não manda hoje): ignorado com motivo, sem tocar na reposição', async () => {
    const w = webhook();
    expect(await w.handle('purchase.approved', purchase())).toBe('ignored');
    expect(await w.handle('purchase.order_registered', purchase())).toBe('ignored');
    expect(w.replenishment.registerPurchase).not.toHaveBeenCalled();
    expect(ignoredReason('purchase.approved', purchase())).toMatch(/sem almoxarifado de destino/);
  });

  it('com warehouse_code: registra a previsão só com itens do catálogo fora do grupo Estoque', async () => {
    const w = webhook();
    expect(await w.handle('purchase.order_registered', purchase({ warehouse_code: 'ALM-CENTRAL' }))).toBe('processed');
    expect(w.replenishment.registerPurchase).toHaveBeenCalledWith(w.tx, { purchase_order_id: 'REQ-0042', warehouse_code: 'ALM-CENTRAL', expected_date: '2026-11-20', items: [{ material_id: 'mat-1', quantity: 10 }] });
  });

  it('purchase.delivery_received e purchase.cancelled não alteram a reposição', () => {
    expect(adaptCorePurchase('purchase.delivery_received', purchase({ warehouse_code: 'X' })).kind).toBe('ignored');
    expect(adaptCorePurchase('purchase.cancelled', purchase({ warehouse_code: 'X' })).kind).toBe('ignored');
  });

  it('só grupo Estoque ou itens sem material_id: ignorado', () => {
    const r = adaptCorePurchase('purchase.approved', purchase({ warehouse_code: 'X', groups: [purchase().groups[1]] }));
    expect(r).toEqual({ kind: 'ignored', reason: expect.stringMatching(/sem itens do catálogo/) });
  });

  it('registerPurchase aceita material_id (id da Logística) e cria a previsão', async () => {
    const tx = {
      warehouse: { findUnique: vi.fn().mockResolvedValue({ id: 'wh-1' }) },
      material: { findFirst: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: 'mat-1' }) },
      replenishmentSuggestion: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn() },
    };
    const svc = new ReplenishmentService({} as never, {} as never, {} as never);
    await svc.registerPurchase(tx as never, { purchase_order_id: 'REQ-0042', warehouse_code: 'ALM-CENTRAL', items: [{ material_id: 'mat-1', quantity: 4 }, { material_id: 'mat-1', quantity: 6 }] });
    expect(tx.material.findUnique).toHaveBeenCalledWith({ where: { id: 'mat-1' } });
    expect(tx.material.findFirst).not.toHaveBeenCalled();
    expect(tx.replenishmentSuggestion.create).toHaveBeenCalledTimes(1);
    expect(tx.replenishmentSuggestion.create.mock.calls[0][0].data).toMatchObject({ materialId: 'mat-1', warehouseId: 'wh-1', approvedQty: 10, axisPurchaseOrderId: 'REQ-0042' });
  });
});

describe('bloqueio de usuário desativado (JWT)', () => {
  const build = (cached: { active: boolean } | null) => {
    const prisma = { axisMasterCache: { findUnique: vi.fn().mockResolvedValue(cached) } };
    const strategy = new JwtStrategy({ getOrThrow: () => 'segredo-de-teste-com-tamanho-suficiente-0123456789' } as never, { resolvePermissions: vi.fn().mockResolvedValue([]) } as never, prisma as never);
    return { strategy, prisma };
  };

  it('sessão da Logística (launcher) de usuário desativado pelo user.disabled é recusada (401)', async () => {
    const { strategy, prisma } = build({ active: false });
    await expect(strategy.validate({ sub: 'u-1', email: 'a@lgc', iss: LOGISTICA_ISSUER })).rejects.toThrow(UnauthorizedException);
    expect(prisma.axisMasterCache.findUnique).toHaveBeenCalledWith({ where: { kind_axisId: { kind: 'USER', axisId: 'u-1' } } });
  });

  it('usuário ativo ou ainda fora do cache segue normalmente', async () => {
    await expect(build({ active: true }).strategy.validate({ sub: 'u-1', email: 'a@lgc', iss: LOGISTICA_ISSUER })).resolves.toMatchObject({ userId: 'u-1' });
    await expect(build(null).strategy.validate({ sub: 'u-1', email: 'a@lgc', iss: LOGISTICA_ISSUER })).resolves.toMatchObject({ userId: 'u-1' });
  });
});
