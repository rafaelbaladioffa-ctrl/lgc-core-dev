import { describe, expect, it, vi } from 'vitest';
import { MemoryStore, OfflineQueue, type OpResult, type QueueOp } from './queue';

// Bordas da fila offline: lotes de 200, falha no meio de vários lotes, reabertura do store, retryAsNew e dismiss.
const clock = () => new Date('2026-11-01T12:00:00Z');
const okAll = async (ops: Array<Pick<QueueOp, 'opId'>>): Promise<OpResult[]> => ops.map((o) => ({ opId: o.opId, status: 'APLICADA' }));

describe('OfflineQueue — lotes e falhas parciais', () => {
  it('divide o envio em lotes de no máximo 200 operações, na ordem', async () => {
    const send = vi.fn(okAll);
    const q = new OfflineQueue(new MemoryStore(), send, clock);
    for (let i = 0; i < 450; i++) await q.enqueue('count.submit', { id: 'c', lineId: `l${i}`, quantity: i });
    const s = await q.flush();
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([200, 200, 50]);
    expect(s).toMatchObject({ sent: 450, applied: 450 });
    expect((send.mock.calls[1][0][0] as { payload: { lineId: string } }).payload.lineId).toBe('l200');
  });

  it('falha no meio de vários lotes: o que já foi aplicado sai da fila, o resto segue pendente e reenvia com os mesmos opIds', async () => {
    let calls = 0;
    const sentIds: string[][] = [];
    const send = vi.fn(async (ops: Array<Pick<QueueOp, 'opId'>>) => {
      calls++;
      sentIds.push(ops.map((o) => o.opId));
      if (calls === 2) throw new Error('rede caiu');
      return okAll(ops);
    });
    const q = new OfflineQueue(new MemoryStore(), send, clock);
    for (let i = 0; i < 450; i++) await q.enqueue('count.submit', { id: 'c', lineId: `l${i}`, quantity: i });
    const first = await q.flush();
    expect(first).toMatchObject({ sent: 200, applied: 200, offline: true });
    const left = await q.list();
    expect(left).toHaveLength(250);
    // o lote que falhou (200..399) ganhou uma tentativa; o último, que nunca saiu, continua com 0
    expect(left.slice(0, 200).every((o) => o.attempts === 1)).toBe(true);
    expect(left[200].attempts).toBe(0);

    const second = await q.flush();
    expect(second).toMatchObject({ applied: 250, offline: false });
    expect(await q.list()).toHaveLength(0);
    expect(sentIds[1]).toEqual(sentIds[2].slice(0, 200)); // lote que falhou foi reenviado com os mesmos opIds
  });

  it('resposta do servidor sem resultado para uma operação deixa a operação pendente (não some)', async () => {
    const q = new OfflineQueue(new MemoryStore(), async (ops) => [{ opId: ops[0].opId, status: 'APLICADA' }], clock);
    await q.enqueue('picking.start', { id: 't1' });
    const b = await q.enqueue('picking.start', { id: 't2' });
    const s = await q.flush();
    expect(s).toMatchObject({ applied: 1, retry: 1 });
    const left = await q.list();
    expect(left.map((o) => o.opId)).toEqual([b.opId]);
    expect(left[0].attempts).toBe(1);
  });

  it('CONFLITO fica fora do próximo envio até o operador agir', async () => {
    const send = vi.fn(async (ops: Array<Pick<QueueOp, 'opId'>>): Promise<OpResult[]> => [{ opId: ops[0].opId, status: 'CONFLITO', code: 'TASK_LOCKED', message: 'Outro separador' }]);
    const q = new OfflineQueue(new MemoryStore(), send, clock);
    const a = await q.enqueue('picking.start', { id: 't1' });
    await q.flush();
    await q.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await q.pendingCount()).toBe(0);
    expect((await q.list())[0]).toMatchObject({ opId: a.opId, state: 'CONFLITO', code: 'TASK_LOCKED', message: 'Outro separador' });
  });

  it('chamadas simultâneas de flush compartilham um único envio', async () => {
    const send = vi.fn(okAll);
    const q = new OfflineQueue(new MemoryStore(), send, clock);
    await q.enqueue('putaway.confirm', { id: 'p1', locationId: 'l1' });
    const [x, y] = await Promise.all([q.flush(), q.flush()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(x).toBe(y);
  });
});

describe('OfflineQueue — reabertura do store, retryAsNew e dismiss', () => {
  it('após reabrir o store, a ordem por seq continua e novas operações entram no fim', async () => {
    const store = new MemoryStore();
    const q1 = new OfflineQueue(store, okAll, clock);
    const a = await q1.enqueue('picking.start', { id: 't1' });
    const b = await q1.enqueue('picking.scan', { id: 't1', quantity: 1 });
    const q2 = new OfflineQueue(store, okAll, clock); // novo app abre o mesmo store
    const c = await q2.enqueue('picking.complete', { id: 't1' });
    expect((await q2.list()).map((o) => o.opId)).toEqual([a.opId, b.opId, c.opId]);
    expect(c.seq).toBeGreaterThan(b.seq);
  });

  it('retryAsNew cria nova operação com novo opId, mesmo payload e rótulo, no fim da fila', async () => {
    const send = vi.fn(async (ops: Array<Pick<QueueOp, 'opId'>>): Promise<OpResult[]> => [{ opId: ops[0].opId, status: 'REJEITADA', code: 'INVALID_LOCATION', message: 'Endereço errado' }]);
    const q = new OfflineQueue(new MemoryStore(), send, clock);
    const old = await q.enqueue('picking.scan', { id: 't1', locationId: 'x' }, 'Bipar SKU-1');
    await q.flush();
    const fresh = await q.retryAsNew(old.opId);
    expect(fresh).not.toBeNull();
    expect(fresh!.opId).not.toBe(old.opId);
    expect(fresh).toMatchObject({ type: 'picking.scan', payload: { id: 't1', locationId: 'x' }, label: 'Bipar SKU-1', state: 'PENDENTE', attempts: 0 });
    expect((await q.list()).map((o) => o.opId)).toEqual([fresh!.opId]);
  });

  it('retryAsNew de opId desconhecido não cria nada', async () => {
    const q = new OfflineQueue(new MemoryStore(), okAll, clock);
    expect(await q.retryAsNew('nao-existe')).toBeNull();
    expect(await q.list()).toHaveLength(0);
  });

  it('dismiss remove só a operação indicada e não conta como pendente', async () => {
    const q = new OfflineQueue(new MemoryStore(), okAll, clock);
    const a = await q.enqueue('picking.start', { id: 't1' });
    const b = await q.enqueue('picking.start', { id: 't2' });
    await q.dismiss(a.opId);
    expect((await q.list()).map((o) => o.opId)).toEqual([b.opId]);
    expect(await q.pendingCount()).toBe(1);
    await q.dismiss('inexistente'); // não quebra
    expect(await q.list()).toHaveLength(1);
  });
});
