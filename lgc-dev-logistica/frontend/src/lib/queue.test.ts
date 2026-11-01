import { describe, expect, it, vi } from 'vitest';
import { MemoryStore, OfflineQueue, type OpResult } from './queue';

const mk = (send: (ops: any[]) => Promise<OpResult[]>) => new OfflineQueue(new MemoryStore(), send, () => new Date('2026-11-01T12:00:00Z'));

describe('OfflineQueue', () => {
  it('guarda em ordem e limpa o que foi aplicado ou duplicado', async () => {
    const send = vi.fn(async (ops: any[]) => ops.map((o, i): OpResult => ({ opId: o.opId, status: i === 0 ? 'APLICADA' : 'DUPLICADA' })));
    const q = mk(send);
    const a = await q.enqueue('picking.start', { id: 't1' });
    const b = await q.enqueue('picking.scan', { id: 't1', quantity: 1 });
    expect((await q.list()).map((o) => o.opId)).toEqual([a.opId, b.opId]);
    const s = await q.flush();
    expect(s).toMatchObject({ sent: 2, applied: 1, duplicated: 1, offline: false });
    expect(await q.list()).toHaveLength(0);
    expect(send.mock.calls[0][0].map((o: any) => o.type)).toEqual(['picking.start', 'picking.scan']);
  });

  it('sem rede mantém tudo pendente e conta tentativas; depois reenvia os mesmos opIds', async () => {
    let online = false;
    const seen: string[][] = [];
    const q = mk(async (ops) => {
      seen.push(ops.map((o) => o.opId));
      if (!online) throw new Error('offline');
      return ops.map((o) => ({ opId: o.opId, status: 'APLICADA' as const }));
    });
    const op = await q.enqueue('putaway.confirm', { id: 'p1', locationId: 'l1' });
    expect((await q.flush()).offline).toBe(true);
    expect((await q.list())[0]).toMatchObject({ opId: op.opId, state: 'PENDENTE', attempts: 1 });
    online = true;
    await q.flush();
    expect(await q.list()).toHaveLength(0);
    expect(seen[1]).toEqual(seen[0]); // reenvio idempotente: mesmo opId
  });

  it('conflito e rejeição ficam visíveis com a mensagem até o operador dispensar; ERRO volta a pendente', async () => {
    const q = mk(async (ops) => [
      { opId: ops[0].opId, status: 'CONFLITO', message: 'Tarefa de outro separador' },
      { opId: ops[1].opId, status: 'REJEITADA', message: 'Endereço errado', code: 'INVALID_LOCATION' },
      { opId: ops[2].opId, status: 'ERRO', message: 'Falha temporária' },
    ]);
    const a = await q.enqueue('picking.start', { id: 'a' });
    const b = await q.enqueue('picking.scan', { id: 'a' });
    const c = await q.enqueue('count.submit', { id: 'c' });
    const s = await q.flush();
    expect(s).toMatchObject({ conflicts: 1, rejected: 1, retry: 1 });
    const list = await q.list();
    expect(list.map((o) => o.state)).toEqual(['CONFLITO', 'REJEITADA', 'PENDENTE']);
    expect(list[1]).toMatchObject({ code: 'INVALID_LOCATION', message: 'Endereço errado' });
    expect(await q.pendingCount()).toBe(1);
    await q.dismiss(a.opId);
    expect((await q.list()).map((o) => o.opId)).toEqual([b.opId, c.opId]);
  });

  it('flush simultâneo compartilha um único envio; rejeitada pode ser refeita com novo opId', async () => {
    const send = vi.fn(async (ops: any[]) => {
      await new Promise((r) => setTimeout(r, 5));
      return ops.map((o) => ({ opId: o.opId, status: 'REJEITADA' as const, message: 'x' }));
    });
    const q = mk(send);
    const op = await q.enqueue('picking.scan', { id: 't' });
    await Promise.all([q.flush(), q.flush(), q.flush()]);
    expect(send).toHaveBeenCalledTimes(1);
    const again = await q.retryAsNew(op.opId);
    expect(again!.opId).not.toBe(op.opId);
    expect(again!.state).toBe('PENDENTE');
    expect(await q.list()).toHaveLength(1);
  });

  it('envia em lotes de até 200 operações', async () => {
    const send = vi.fn(async (ops: any[]) => ops.map((o) => ({ opId: o.opId, status: 'APLICADA' as const })));
    const q = mk(send);
    for (let i = 0; i < 450; i++) await q.enqueue('count.submit', { id: 'c', i });
    await q.flush();
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([200, 200, 50]);
  });
});
