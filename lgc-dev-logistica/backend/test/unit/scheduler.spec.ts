import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { SchedulerService } from '../../src/scheduler/scheduler.service.js';

// Agendador (12.4, 19) com serviços mockados e ConfigService falso. Cobre o liga/desliga por SCHEDULER_ENABLED,
// a ausência de sobreposição do mesmo job e o isolamento de falhas entre jobs.

const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function build(env: Record<string, string | undefined>) {
  const dispatcher = { dispatchOnce: vi.fn(async () => ({ enabled: true, delivered: 0, retried: 0, deadLettered: 0 })) };
  const alerts = { scan: vi.fn(async () => ({})) };
  const fulfillment = { expireReservations: vi.fn(async () => ({})) };
  const reconciliation = { run: vi.fn(async () => ({ found: 0, created: 0, refreshed: 0, closed: 0 })) };
  const config = { get: (k: string) => env[k] } as never;
  const svc = new SchedulerService(config, dispatcher as never, alerts as never, fulfillment as never, reconciliation as never);
  const runAll = () => Promise.all([svc.outbox(), svc.scanAlerts(), svc.expireReservations(), svc.reconcile()]);
  return { svc, dispatcher, alerts, fulfillment, reconciliation, runAll };
}

describe('SchedulerService (unit)', () => {
  describe('liga/desliga', () => {
    it.each([
      ['variável ausente', undefined],
      ['"false"', 'false'],
      ['"1"', '1'],
      ['"TRUE" (maiúsculas não contam)', 'TRUE'],
      ['vazia', ''],
    ])('com SCHEDULER_ENABLED %s nenhum job roda', async (_label, value) => {
      const b = build({ SCHEDULER_ENABLED: value });
      await b.runAll();
      expect(b.dispatcher.dispatchOnce).not.toHaveBeenCalled();
      expect(b.alerts.scan).not.toHaveBeenCalled();
      expect(b.fulfillment.expireReservations).not.toHaveBeenCalled();
      expect(b.reconciliation.run).not.toHaveBeenCalled();
    });

    it('com SCHEDULER_ENABLED="true" cada job roda uma vez, com o ator "sistema" na reconciliação', async () => {
      const b = build({ SCHEDULER_ENABLED: 'true' });
      await b.runAll();
      expect(b.dispatcher.dispatchOnce).toHaveBeenCalledTimes(1);
      expect(b.alerts.scan).toHaveBeenCalledTimes(1);
      expect(b.fulfillment.expireReservations).toHaveBeenCalledTimes(1);
      expect(b.reconciliation.run).toHaveBeenCalledWith('sistema');
    });
  });

  describe('sem sobreposição do mesmo job', () => {
    it('uma segunda chamada enquanto o job ainda roda é ignorada', async () => {
      const b = build({ SCHEDULER_ENABLED: 'true' });
      const gate = deferred();
      b.dispatcher.dispatchOnce.mockImplementationOnce(() => gate.promise.then(() => ({ enabled: true, delivered: 0, retried: 0, deadLettered: 0 })));
      const first = b.svc.outbox();
      const second = b.svc.outbox();
      await second;
      expect(b.dispatcher.dispatchOnce).toHaveBeenCalledTimes(1);
      gate.resolve();
      await first;
    });

    it('depois que o job termina, a próxima execução roda normalmente', async () => {
      const b = build({ SCHEDULER_ENABLED: 'true' });
      await b.svc.outbox();
      await b.svc.outbox();
      expect(b.dispatcher.dispatchOnce).toHaveBeenCalledTimes(2);
    });

    it('um job em execução não bloqueia os outros jobs', async () => {
      const b = build({ SCHEDULER_ENABLED: 'true' });
      const gate = deferred();
      b.alerts.scan.mockImplementationOnce(() => gate.promise.then(() => ({})));
      const slow = b.svc.scanAlerts();
      await b.svc.outbox();
      expect(b.dispatcher.dispatchOnce).toHaveBeenCalledTimes(1);
      gate.resolve();
      await slow;
    });

    it('o job é liberado mesmo quando falha (o próximo ciclo volta a rodar)', async () => {
      const b = build({ SCHEDULER_ENABLED: 'true' });
      b.dispatcher.dispatchOnce.mockRejectedValueOnce(new Error('banco indisponível'));
      await expect(b.svc.outbox()).resolves.toBeUndefined();
      await b.svc.outbox();
      expect(b.dispatcher.dispatchOnce).toHaveBeenCalledTimes(2);
    });
  });

  describe('isolamento de falhas', () => {
    it('falha de um job não impede os demais de rodarem nem derruba o agendador', async () => {
      const b = build({ SCHEDULER_ENABLED: 'true' });
      b.alerts.scan.mockRejectedValueOnce(new Error('alertas quebrados'));
      b.dispatcher.dispatchOnce.mockRejectedValueOnce(new Error('axis fora'));
      await expect(b.runAll()).resolves.toBeDefined();
      expect(b.fulfillment.expireReservations).toHaveBeenCalledTimes(1);
      expect(b.reconciliation.run).toHaveBeenCalledTimes(1);
    });

    it('um erro síncrono lançado por um serviço também é isolado', async () => {
      const b = build({ SCHEDULER_ENABLED: 'true' });
      b.reconciliation.run.mockImplementationOnce(() => { throw new TypeError('bug sincrono'); });
      await expect(b.svc.reconcile()).resolves.toBeUndefined();
      await expect(b.svc.outbox()).resolves.toBeUndefined();
      expect(b.dispatcher.dispatchOnce).toHaveBeenCalledTimes(1);
    });
  });
});
