import { describe, expect, it, vi } from 'vitest';
import { BpmCommandProtocolInterceptor } from './command-protocol.interceptor.js';
const id = 'c7c11546-10ac-4c35-8f20-c90b79aa7a91';
describe('runtime HTTP command envelope', () => {
  it('accepts consistent keys and rejects missing/mismatched headers before the handler', () => {
    const interceptor = new BpmCommandProtocolInterceptor();
    const next = { handle: vi.fn() };
    const context = (key: string | undefined, version?: number) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'PATCH',
            url: '/api/v1/bpm/requests/r/draft',
            route: { path: '/bpm/requests/:id/draft' },
            headers: { 'idempotency-key': key },
            body: { commandKey: id, commandId: id, expectedVersion: version },
          }),
        }),
      }) as any;
    interceptor.intercept(context(id, 7), next);
    expect(next.handle).toHaveBeenCalledTimes(1);
    expect(() => interceptor.intercept(context(undefined, 7), next)).toThrow();
    expect(() =>
      interceptor.intercept(context('different', 7), next),
    ).toThrow();
    expect(() => interceptor.intercept(context(id), next)).toThrow();
    expect(next.handle).toHaveBeenCalledTimes(1);
  });
});
