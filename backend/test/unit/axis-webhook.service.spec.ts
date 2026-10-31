import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { AxisWebhookService } from '../../src/integration/axis-webhook.service.js';

// Casos de borda do receptor do webhook (assinatura e envelope), sem banco.

const SECRET = 'segredo-unitario-0123456789';
const HOUR = 3_600_000;

const service = (cfg: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = { AXIS_WEBHOOK_SECRET: SECRET, ...cfg };
  const config = { get: vi.fn((k: string) => values[k]) };
  return new AxisWebhookService({} as never, config as never, {} as never);
};
const sig = (raw: Buffer | string, secret = SECRET) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
const buf = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');
const envelope = (over: Record<string, unknown> = {}) => ({
  event_id: randomUUID(), event_type: 'project.created', occurred_at: new Date().toISOString(), payload: { project_id: 'p1' }, ...over,
});
const parse = (svc: AxisWebhookService, raw: Buffer) => (svc as unknown as { parse: (b: Buffer) => unknown }).parse(raw);

describe('AxisWebhookService.verifySignature', () => {
  it('sem AXIS_WEBHOOK_SECRET o receptor fica indisponível (503), nunca aceita', () => {
    const svc = service({ AXIS_WEBHOOK_SECRET: undefined });
    expect(() => svc.verifySignature(buf('{}'), sig(buf('{}')))).toThrow(ServiceUnavailableException);
  });

  it('corpo ausente, cabeçalho ausente ou fora do formato sha256= é 401', () => {
    const svc = service();
    const raw = buf('{}');
    expect(() => svc.verifySignature(undefined, sig(raw))).toThrow(UnauthorizedException);
    expect(() => svc.verifySignature(raw, undefined)).toThrow(UnauthorizedException);
    expect(() => svc.verifySignature(raw, '')).toThrow(UnauthorizedException);
    expect(() => svc.verifySignature(raw, sig(raw).replace('sha256=', 'SHA256='))).toThrow(UnauthorizedException);
    expect(() => svc.verifySignature(raw, sig(raw).slice('sha256='.length))).toThrow(UnauthorizedException);
  });

  it('valor vazio, truncado ou com comprimento diferente é 401 (sem comparar parcialmente)', () => {
    const svc = service();
    const raw = buf('{"a":1}');
    expect(() => svc.verifySignature(raw, 'sha256=')).toThrow(UnauthorizedException);
    expect(() => svc.verifySignature(raw, sig(raw).slice(0, -2))).toThrow(UnauthorizedException);
    expect(() => svc.verifySignature(raw, sig(raw) + '00')).toThrow(UnauthorizedException);
  });

  it('assinatura correta passa; mesma assinatura sobre outro corpo ou outro segredo é 401', () => {
    const svc = service();
    const raw = buf('{"a":1}');
    expect(() => svc.verifySignature(raw, sig(raw))).not.toThrow();
    expect(() => svc.verifySignature(buf('{"a":2}'), sig(raw))).toThrow(UnauthorizedException);
    expect(() => svc.verifySignature(raw, sig(raw, 'outro'))).toThrow(UnauthorizedException);
  });

  it('assinatura é sobre os bytes UTF-8: acento escrito com escape \\u00e7 não bate com o ç literal', () => {
    const svc = service();
    const literal = buf('{"nome":"Ação"}');
    const escaped = buf('{"nome":"A\\u00e7\\u00e3o"}');
    expect(() => svc.verifySignature(literal, sig(literal))).not.toThrow();
    expect(() => svc.verifySignature(escaped, sig(literal))).toThrow(UnauthorizedException);
    // assinado em latin1 por engano: os bytes UTF-8 de "ç" são diferentes
    const latin1 = Buffer.from('{"nome":"Ação"}', 'latin1');
    expect(() => svc.verifySignature(literal, sig(latin1))).toThrow(UnauthorizedException);
  });
});

describe('AxisWebhookService.parse (envelope e janela de replay)', () => {
  it('envelope válido é devolvido como veio', () => {
    const e = envelope();
    expect(parse(service(), buf(e))).toEqual(e);
  });

  it('JSON inválido, "null", array e objeto vazio são 400', () => {
    const svc = service();
    expect(() => parse(svc, buf('{nao json'))).toThrow(BadRequestException);
    expect(() => parse(svc, buf('null'))).toThrow(BadRequestException);
    expect(() => parse(svc, buf('[]'))).toThrow(BadRequestException);
    expect(() => parse(svc, buf('{}'))).toThrow('event_id ausente ou inválido.');
  });

  it('event_id precisa ser UUID (maiúsculas aceitas; número ou texto livre recusados)', () => {
    const svc = service();
    expect(() => parse(svc, buf(envelope({ event_id: randomUUID().toUpperCase() })))).not.toThrow();
    expect(() => parse(svc, buf(envelope({ event_id: 12345 })))).toThrow('event_id');
    expect(() => parse(svc, buf(envelope({ event_id: 'abc-123' })))).toThrow('event_id');
    expect(() => parse(svc, buf(envelope({ event_id: `${randomUUID()}x` })))).toThrow('event_id');
  });

  it('event_type vazio ou com mais de 100 caracteres é 400; exatamente 100 passa', () => {
    const svc = service();
    expect(() => parse(svc, buf(envelope({ event_type: '' })))).toThrow('event_type');
    expect(() => parse(svc, buf(envelope({ event_type: 'a'.repeat(101) })))).toThrow('event_type');
    expect(() => parse(svc, buf(envelope({ event_type: 'a'.repeat(100) })))).not.toThrow();
  });

  it('occurred_at ausente, não-data ou não-texto é 400', () => {
    const svc = service();
    expect(() => parse(svc, buf(envelope({ occurred_at: 'ontem' })))).toThrow('occurred_at');
    expect(() => parse(svc, buf(envelope({ occurred_at: 1_700_000_000_000 })))).toThrow('occurred_at');
    expect(() => parse(svc, buf(envelope({ occurred_at: undefined })))).toThrow('occurred_at');
  });

  it('payload deve ser objeto: null, array, texto ou ausente são 400', () => {
    const svc = service();
    for (const payload of [null, [], 'x', 3, undefined]) {
      expect(() => parse(svc, buf(envelope({ payload })))).toThrow('payload ausente ou inválido.');
    }
    expect(() => parse(svc, buf(envelope({ payload: {} })))).not.toThrow();
  });

  it('janela padrão de 72 h: 71 h atrás passa, 73 h atrás é replay', () => {
    const svc = service();
    expect(() => parse(svc, buf(envelope({ occurred_at: new Date(Date.now() - 71 * HOUR).toISOString() })))).not.toThrow();
    expect(() => parse(svc, buf(envelope({ occurred_at: new Date(Date.now() - 73 * HOUR).toISOString() })))).toThrow('replay');
  });

  it('WEBHOOK_MAX_AGE_HOURS configurado (texto do ambiente) é respeitado', () => {
    const svc = service({ WEBHOOK_MAX_AGE_HOURS: '1' });
    expect(() => parse(svc, buf(envelope({ occurred_at: new Date(Date.now() - 2 * HOUR).toISOString() })))).toThrow('replay');
    expect(() => parse(svc, buf(envelope({ occurred_at: new Date(Date.now() - 30 * 60_000).toISOString() })))).not.toThrow();
  });

  it('occurred_at até 5 min no futuro (relógio desalinhado) passa; além disso é 400', () => {
    const svc = service();
    expect(() => parse(svc, buf(envelope({ occurred_at: new Date(Date.now() + 4 * 60_000).toISOString() })))).not.toThrow();
    expect(() => parse(svc, buf(envelope({ occurred_at: new Date(Date.now() + 6 * 60_000).toISOString() })))).toThrow('no futuro');
  });

  it.fails('WEBHOOK_MAX_AGE_HOURS inválido (ex.: "abc") não pode desligar a janela de replay', () => {
    // Bug: Number('abc') = NaN; `Date.now() - occurred > NaN` é sempre falso, então qualquer evento antigo passa.
    // Esperado: configuração inválida deve falhar fechada (ou cair no padrão de 72 h), rejeitando um evento de 1000 h.
    const svc = service({ WEBHOOK_MAX_AGE_HOURS: 'abc' });
    expect(() => parse(svc, buf(envelope({ occurred_at: new Date(Date.now() - 1000 * HOUR).toISOString() })))).toThrow('replay');
  });
});
