/** Fila de operações offline (PLANNING_LOGISTICA 15.2 e 11.17): idempotente por opId, em ordem, sem perder nada em falha de rede. */

export type OpType = 'picking.start' | 'picking.scan' | 'picking.complete' | 'putaway.confirm' | 'count.submit';
export type OpState = 'PENDENTE' | 'CONFLITO' | 'REJEITADA';

export interface QueueOp {
  opId: string;
  seq: number;
  type: OpType;
  payload: Record<string, unknown>;
  clientAt: string;
  state: OpState;
  attempts: number;
  message?: string;
  code?: string;
  label?: string; // texto para o operador reconhecer a ação na lista de pendências
}

export interface OpResult {
  opId: string;
  status: 'APLICADA' | 'DUPLICADA' | 'CONFLITO' | 'REJEITADA' | 'ERRO';
  message?: string;
  code?: string;
}

export interface Store {
  all(): Promise<QueueOp[]>;
  put(op: QueueOp): Promise<void>;
  delete(opId: string): Promise<void>;
}

export class MemoryStore implements Store {
  private m = new Map<string, QueueOp>();
  async all() { return [...this.m.values()].map((o) => structuredClone(o)); }
  async put(op: QueueOp) { this.m.set(op.opId, structuredClone(op)); }
  async delete(opId: string) { this.m.delete(opId); }
}

const BATCH = 200;
const uuid = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16));

export interface FlushSummary { sent: number; applied: number; duplicated: number; conflicts: number; rejected: number; retry: number; offline: boolean }

export class OfflineQueue {
  private flushing: Promise<FlushSummary> | null = null;
  private seq = 0;

  constructor(
    private readonly store: Store,
    private readonly send: (ops: Array<Pick<QueueOp, 'opId' | 'type' | 'payload' | 'clientAt'>>) => Promise<OpResult[]>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list() { return (await this.store.all()).sort((a, b) => a.seq - b.seq); }
  async pendingCount() { return (await this.list()).filter((o) => o.state === 'PENDENTE').length; }

  async enqueue(type: OpType, payload: Record<string, unknown>, label?: string): Promise<QueueOp> {
    const all = await this.store.all();
    this.seq = Math.max(this.seq, ...all.map((o) => o.seq), 0) + 1;
    const op: QueueOp = { opId: uuid(), seq: this.seq, type, payload, clientAt: this.now().toISOString(), state: 'PENDENTE', attempts: 0, label };
    await this.store.put(op);
    return op;
  }

  /** O operador confirma que viu o conflito/rejeição. */
  async dismiss(opId: string) { await this.store.delete(opId); }

  /** Refaz uma operação rejeitada depois de corrigida a causa: novo opId (o antigo já tem resultado gravado no servidor). */
  async retryAsNew(opId: string): Promise<QueueOp | null> {
    const old = (await this.store.all()).find((o) => o.opId === opId);
    if (!old) return null;
    await this.store.delete(opId);
    return this.enqueue(old.type, old.payload, old.label);
  }

  /** Sincroniza o que está pendente. Chamadas simultâneas compartilham o mesmo envio. */
  flush(): Promise<FlushSummary> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async doFlush(): Promise<FlushSummary> {
    const summary: FlushSummary = { sent: 0, applied: 0, duplicated: 0, conflicts: 0, rejected: 0, retry: 0, offline: false };
    const pending = (await this.list()).filter((o) => o.state === 'PENDENTE');
    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      let results: OpResult[];
      try {
        results = await this.send(chunk.map(({ opId, type, payload, clientAt }) => ({ opId, type, payload, clientAt })));
      } catch {
        // Sem rede ou servidor fora: nada é perdido; tenta de novo depois.
        for (const o of chunk) await this.store.put({ ...o, attempts: o.attempts + 1 });
        summary.offline = true;
        return summary;
      }
      const byId = new Map(results.map((r) => [r.opId, r]));
      for (const o of chunk) {
        summary.sent++;
        const r = byId.get(o.opId);
        if (!r || r.status === 'ERRO') { summary.retry++; await this.store.put({ ...o, attempts: o.attempts + 1, message: r?.message }); continue; }
        if (r.status === 'APLICADA') { summary.applied++; await this.store.delete(o.opId); }
        else if (r.status === 'DUPLICADA') { summary.duplicated++; await this.store.delete(o.opId); }
        else {
          if (r.status === 'CONFLITO') summary.conflicts++; else summary.rejected++;
          await this.store.put({ ...o, state: r.status, message: r.message, code: r.code, attempts: o.attempts + 1 });
        }
      }
    }
    return summary;
  }
}
