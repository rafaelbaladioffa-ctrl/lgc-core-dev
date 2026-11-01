import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ConflictException, HttpException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SyncService } from '../../src/sync/sync.service.js';
import type { AuthenticatedUser } from '../../src/auth/authenticated-request.js';

// Regras do SyncService (idempotência, classificação de erros, permissão por tipo) com Prisma e serviços mockados.
// Sem banco: cobre caminhos que a API só alcança com falhas simuladas (ERRO transitório, corrida P2002).

const DEV = 'DEVICE-UNIT-S9';
const TASK = '00000000-0000-4000-8000-000000000011';
const OP = '00000000-0000-4000-8000-0000000000a1';
const OP2 = '00000000-0000-4000-8000-0000000000a2';
const OP3 = '00000000-0000-4000-8000-0000000000a3';
const ALL = ['picking:execute', 'receipt:execute', 'stockcount:count'];
const LOC = '00000000-0000-4000-8000-000000000001';
const scanPayload = { id: TASK, pickingItemId: '00000000-0000-4000-8000-0000000000b1', locationId: LOC, quantity: 1 };

const user = (permissions: string[] = ALL, userId = 'u-unit'): AuthenticatedUser => ({
  userId, email: 'u@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions,
});
const op = (type: string, payload: Record<string, unknown>, opId = OP) => ({ opId, type, payload, clientAt: '2026-11-01T12:00:00.000Z' });

/** Tabela de offline_operations em memória: create respeita a unicidade (deviceId, opId) como o banco. */
function store() {
  const rows = new Map<string, Record<string, unknown>>();
  const key = (d: string, o: string) => `${d}|${o}`;
  return {
    rows,
    findUnique: vi.fn(async ({ where }: { where: { deviceId_opId: { deviceId: string; opId: string } } }) => rows.get(key(where.deviceId_opId.deviceId, where.deviceId_opId.opId)) ?? null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const k = key(data['deviceId'] as string, data['opId'] as string);
      if (rows.has(k)) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
      rows.set(k, data);
      return data;
    }),
  };
}

function build(over: { shipping?: Record<string, unknown>; receiving?: Record<string, unknown>; inventory?: Record<string, unknown>; offline?: ReturnType<typeof store> } = {}) {
  const offline = over.offline ?? store();
  const prisma = { offlineOperation: offline };
  const shipping = { start: vi.fn().mockResolvedValue({ id: TASK, status: 'EM_SEPARACAO' }), scan: vi.fn().mockResolvedValue({ ok: true }), complete: vi.fn().mockResolvedValue({ status: 'SEPARADA' }), ...over.shipping };
  const receiving = { confirmPutaway: vi.fn().mockResolvedValue({ ok: true }), ...over.receiving };
  const inventory = { submit: vi.fn().mockResolvedValue({ ok: true }), ...over.inventory };
  const svc = new SyncService(prisma as never, {} as never, shipping as never, receiving as never, inventory as never);
  const batch = (ops: unknown[], u: AuthenticatedUser = user()) => svc.batch({ deviceId: DEV, operations: ops } as never, u);
  return { svc, batch, offline, shipping, receiving, inventory };
}

describe('SyncService.batch — classificação de resultados', () => {
  it('falha transitória (erro genérico, 503 ou 500) volta como ERRO e NÃO é gravada, para reenvio', async () => {
    const { batch, offline, shipping } = build({ shipping: { start: vi.fn().mockRejectedValue(new Error('connection reset')) } });
    const [r] = (await batch([op('picking.start', { id: TASK })])).results;
    expect(r).toMatchObject({ opId: OP, status: 'ERRO' });
    expect(offline.create).not.toHaveBeenCalled();
    expect(shipping.start).toHaveBeenCalledTimes(1);

    const down = build({ shipping: { start: vi.fn().mockRejectedValue(new ServiceUnavailableException('db')) } });
    expect((await down.batch([op('picking.start', { id: TASK })])).results[0].status).toBe('ERRO');
    expect(down.offline.create).not.toHaveBeenCalled();
  });

  it('erro 500 vindo de HttpException também é transitório (não grava)', async () => {
    const { batch, offline } = build({ shipping: { complete: vi.fn().mockRejectedValue(new HttpException('boom', 500)) } });
    expect((await batch([op('picking.complete', { id: TASK }, OP2)])).results[0].status).toBe('ERRO');
    expect(offline.create).not.toHaveBeenCalled();
  });

  it('409 vira CONFLITO gravado com o código de negócio; 422 vira REJEITADA gravada', async () => {
    const { batch, offline } = build({
      shipping: { start: vi.fn().mockRejectedValue(new ConflictException({ message: 'Tarefa de outro separador', code: 'TASK_LOCKED' })), scan: vi.fn().mockRejectedValue(new UnprocessableEntityException({ message: 'Quantidade acima do planejado', code: 'OVER_PICK' })) },
    });
    const r = (await batch([op('picking.start', { id: TASK }), op('picking.scan', scanPayload, OP2)])).results;
    expect(r[0]).toMatchObject({ status: 'CONFLITO', code: 'TASK_LOCKED', message: 'Tarefa de outro separador' });
    expect(r[1]).toMatchObject({ status: 'REJEITADA', code: 'OVER_PICK' });
    expect(offline.rows.size).toBe(2);
  });

  it('corrida de envio paralelo (P2002 no create) devolve DUPLICADA em vez de estourar', async () => {
    const offline = store();
    offline.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    const { batch } = build({ offline });
    expect((await batch([op('picking.start', { id: TASK })])).results[0]).toEqual({ opId: OP, status: 'DUPLICADA' });
  });

  it('falha ao gravar o registro (não P2002) vira ERRO, nunca APLICADA', async () => {
    const offline = store();
    offline.create.mockRejectedValueOnce(new Error('disk full'));
    const { batch } = build({ offline });
    expect((await batch([op('picking.start', { id: TASK })])).results[0].status).toBe('ERRO');
  });

  // Bug: record() roda dentro do try que converte qualquer erro em ERRO. Se o serviço de negócio já aplicou a
  // operação e só a gravação em offline_operations falha, o dispositivo recebe ERRO, reenvia e a ação roda de novo.
  // Passos: 1) picking.scan aplicado, mas o create de offline_operations falha uma vez; 2) reenviar o mesmo opId.
  // Esperado: scan chamado uma vez. Obtido: chamado duas vezes (quantidade contada em dobro).
  it.fails('registro que falha após a aplicação não faz o reenvio aplicar a ação de novo', async () => {
    const offline = store();
    const { batch, shipping } = build({ offline });
    offline.create.mockRejectedValueOnce(new Error('timeout ao gravar'));
    await batch([op('picking.scan', scanPayload)]);
    await batch([op('picking.scan', scanPayload)]);
    expect(shipping.scan).toHaveBeenCalledTimes(1);
  });
});

describe('SyncService.batch — idempotência e lote', () => {
  it('a mesma operação repetida no mesmo lote é aplicada uma vez; a segunda devolve DUPLICADA', async () => {
    const { batch, shipping } = build();
    const o = op('picking.start', { id: TASK });
    const r = (await batch([o, o])).results;
    expect(r.map((x) => x.status)).toEqual(['APLICADA', 'DUPLICADA']);
    expect(shipping.start).toHaveBeenCalledTimes(1);
  });

  it('DUPLICADA reenvia o resultado original gravado (inclusive a mensagem)', async () => {
    const { batch, shipping } = build({ shipping: { scan: vi.fn().mockRejectedValue(new UnprocessableEntityException({ message: 'Endereço errado', code: 'INVALID_LOCATION' })) } });
    const first = (await batch([op('picking.scan', scanPayload)])).results[0];
    expect(first).toMatchObject({ status: 'REJEITADA', code: 'INVALID_LOCATION' });
    const [r] = (await batch([op('picking.scan', scanPayload)])).results;
    expect(r).toMatchObject({ status: 'DUPLICADA', code: 'INVALID_LOCATION', message: 'Endereço errado' });
    expect(shipping.scan).toHaveBeenCalledTimes(1);
  });

  it('lote misto: válidas, inválidas e duplicadas mantêm a ordem e não contaminam umas às outras', async () => {
    const { batch, shipping, receiving } = build();
    const ops = [
      op('picking.start', { id: TASK }, OP),
      op('putaway.confirm', { id: 'nao-uuid' }, OP2), // inválida → REJEITADA
      op('picking.start', { id: TASK }, OP), // duplicada
      op('putaway.confirm', { id: TASK, locationId: 'x', extra: 1 }, OP3), // campo extra → REJEITADA
    ];
    const r = (await batch(ops)).results;
    expect(r.map((x) => [x.opId, x.status])).toEqual([[OP, 'APLICADA'], [OP2, 'REJEITADA'], [OP, 'DUPLICADA'], [OP3, 'REJEITADA']]);
    expect(shipping.start).toHaveBeenCalledTimes(1);
    expect(receiving.confirmPutaway).not.toHaveBeenCalled();
  });

  it('opId reutilizado com outro payload ou outro usuário é REJEITADA (OP_ID_REUTILIZADO) e não chama o serviço', async () => {
    const { batch, shipping } = build();
    await batch([op('picking.start', { id: TASK })]);
    const other = (await batch([op('picking.start', { id: '00000000-0000-4000-8000-0000000000ff' })])).results[0];
    expect(other).toMatchObject({ status: 'REJEITADA', code: 'OP_ID_REUTILIZADO' });
    const otherUser = (await batch([op('picking.start', { id: TASK })], user(ALL, 'outro-usuario'))).results[0];
    expect(otherUser).toMatchObject({ status: 'REJEITADA', code: 'OP_ID_REUTILIZADO' });
    expect(shipping.start).toHaveBeenCalledTimes(1);
  });

  it('o mesmo opId em outro dispositivo é outra operação (idempotência é por dispositivo)', async () => {
    const offline = store();
    const { svc, shipping } = build({ offline });
    await svc.batch({ deviceId: DEV, operations: [op('picking.start', { id: TASK })] } as never, user());
    const r = await svc.batch({ deviceId: 'OUTRO-DISPOSITIVO', operations: [op('picking.start', { id: TASK })] } as never, user());
    expect(r.results[0].status).toBe('APLICADA');
    expect(shipping.start).toHaveBeenCalledTimes(2);
  });

  // Bug: o hash usa JSON.stringify com a lista de chaves do topo como replacer. Ela se aplica também a objetos aninhados,
  // que perdem as chaves não listadas no topo, então payloads que diferem só dentro de um objeto aninhado têm o mesmo hash.
  // Passos: 1) enviar opId X com payload { id, filtro: { a: 1 } } → aplicada; 2) reenviar X com { id, filtro: { a: 2 } }.
  // Esperado: REJEITADA (OP_ID_REUTILIZADO). Obtido: DUPLICADA.
  it.fails('opId reutilizado com payload que muda só dentro de objeto aninhado é rejeitado', async () => {
    const { batch } = build();
    await batch([op('count.submit', { id: TASK, filtro: { a: 1 } })]);
    const [r] = (await batch([op('count.submit', { id: TASK, filtro: { a: 2 } })])).results;
    expect(r.status).toBe('REJEITADA');
  });
});

describe('SyncService.batch — permissão por tipo', () => {
  it('usuário sem picking:execute recebe REJEITADA FORBIDDEN e nada é chamado; a rejeição fica gravada', async () => {
    const { batch, shipping, receiving, inventory, offline } = build();
    const contador = user(['stockcount:count']);
    const r = (await batch([op('picking.start', { id: TASK }), op('putaway.confirm', { id: TASK, locationId: TASK }, OP2), op('count.submit', { id: TASK, lineId: TASK, quantity: 1 }, OP3)], contador)).results;
    expect(r.map((x) => [x.status, x.code])).toEqual([['REJEITADA', 'FORBIDDEN'], ['REJEITADA', 'FORBIDDEN'], ['APLICADA', undefined]]);
    expect(shipping.start).not.toHaveBeenCalled();
    expect(receiving.confirmPutaway).not.toHaveBeenCalled();
    expect(inventory.submit).toHaveBeenCalledTimes(1);
    expect(offline.rows.size).toBe(3);
  });

  it('sem nenhuma permissão operacional, todo tipo é recusado sem tocar nos serviços', async () => {
    const { batch, shipping, inventory } = build();
    const nada = user([]);
    const r = (await batch([op('picking.complete', { id: TASK }), op('count.submit', { id: TASK, lineId: TASK, quantity: 1 }, OP2)], nada)).results;
    expect(r.every((x) => x.status === 'REJEITADA' && x.code === 'FORBIDDEN')).toBe(true);
    expect(shipping.complete).not.toHaveBeenCalled();
    expect(inventory.submit).not.toHaveBeenCalled();
  });

  it('tipo desconhecido não chega ao serviço (o mapa de permissões é fechado)', async () => {
    const { batch, shipping } = build();
    const r = (await batch([op('picking.delete', { id: TASK })], user(ALL))).results[0];
    expect(r.status).toBe('REJEITADA');
    expect(shipping.start).not.toHaveBeenCalled();
  });
});

describe('SyncService.batch — payload', () => {
  it('scan com campo extra ou quantidade textual é rejeitado antes de chegar ao ShippingService', async () => {
    const { batch, shipping } = build();
    const r = (await batch([
      op('picking.scan', { id: TASK, quantity: 1, sistema: 'x' }, OP),
      op('picking.scan', { id: TASK, quantity: 'dez' }, OP2),
    ])).results;
    expect(r.map((x) => x.status)).toEqual(['REJEITADA', 'REJEITADA']);
    expect(shipping.scan).not.toHaveBeenCalled();
  });

  it('payload sem id ou com id fora do formato UUID é rejeitado com 400', async () => {
    const { batch, shipping } = build();
    const r = (await batch([op('picking.start', {}, OP), op('picking.start', { id: 'TASK-1' }, OP2)])).results;
    expect(r.map((x) => x.code)).toEqual(['400', '400']);
    expect(shipping.start).not.toHaveBeenCalled();
  });

  it('erro de validação de payload não vira ERRO (não é transitório)', async () => {
    const { batch } = build();
    const [r] = (await batch([op('count.submit', { id: TASK, lineId: TASK, quantity: 1, extra: true })])).results;
    expect(r.status).not.toBe('ERRO');
    expect(r.status).toBe('REJEITADA');
  });
});
