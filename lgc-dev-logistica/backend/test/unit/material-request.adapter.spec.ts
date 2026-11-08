import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { adaptMaterialRequestEvent, MATERIAL_REQUEST_CATEGORIES } from '../../src/integration/material-request.adapter.js';

// Casos de borda do adaptador evento legado/nativo → evento de domínio (PLANNING_LOGISTICA.md 0.4), sem banco.

const CAT = 'Requisição de material/insumo';
const item = (over: Record<string, unknown> = {}) => ({ material_code: 'MAT-1', quantity: 2, ...over });
const ticket = (over: Record<string, unknown> = {}) => ({ ticket_id: 'TCK-1', category: CAT, status: 'aberto', items: [item()], ...over });

describe('adaptMaterialRequestEvent — ticket.status_changed (legado)', () => {
  it('categoria de material + status aberto vira aprovação com a ordem traduzida', () => {
    const r = adaptMaterialRequestEvent('ticket.status_changed', ticket({ warehouse_code: 'CD1', project_id: 'P1', needed_by: '2026-11-10', notes: 'Urgente' }));
    expect(r).toEqual({
      kind: 'approved',
      order: {
        axisRequestId: 'TCK-1', requestVersion: 1, projectAxisId: 'P1', costCenterAxisId: undefined, requesterAxisId: undefined, recipientAxisId: undefined,
        warehouseCode: 'CD1', neededBy: '2026-11-10', notes: 'Urgente', items: [{ materialId: undefined, materialCode: 'MAT-1', quantity: 2, notes: undefined }],
      },
    });
  });

  it('status é comparado sem diferenciar maiúsculas (ABERTO = aberto)', () => {
    expect(adaptMaterialRequestEvent('ticket.status_changed', ticket({ status: 'ABERTO' }))?.kind).toBe('approved');
  });

  it('status cancelado (qualquer caixa) vira cancel_requested com motivo padrão ou informado', () => {
    expect(adaptMaterialRequestEvent('ticket.status_changed', ticket({ status: 'Cancelado' }))).toEqual({ kind: 'cancel_requested', axisRequestId: 'TCK-1', reason: 'Chamado cancelado no Axis' });
    expect(adaptMaterialRequestEvent('ticket.status_changed', ticket({ status: 'cancelado', reason: 'Duplicado' }))).toEqual({ kind: 'cancel_requested', axisRequestId: 'TCK-1', reason: 'Duplicado' });
  });

  it('outros status (em andamento, resolvido, ausente) são ignorados (null)', () => {
    for (const status of ['em_andamento', 'resolvido', '', undefined]) {
      expect(adaptMaterialRequestEvent('ticket.status_changed', ticket({ status }))).toBeNull();
    }
  });

  it('outras categorias são ignoradas, inclusive "Solicitação de compra" (reposição, Sprint 8)', () => {
    expect(adaptMaterialRequestEvent('ticket.status_changed', ticket({ category: 'Solicitação de compra' }))).toBeNull();
    expect(adaptMaterialRequestEvent('ticket.status_changed', ticket({ category: undefined }))).toBeNull();
    expect(adaptMaterialRequestEvent('ticket.status_changed', ticket({ category: 'requisição de material/insumo' }))).toBeNull(); // categoria é exata
  });

  it('as duas categorias de material são reconhecidas', () => {
    expect(MATERIAL_REQUEST_CATEGORIES).toHaveLength(2);
    for (const c of MATERIAL_REQUEST_CATEGORIES) {
      expect(adaptMaterialRequestEvent('ticket.status_changed', ticket({ category: c }))?.kind).toBe('approved');
    }
  });

  it('categoria de material sem ticket_id é 400 (não ignora em silêncio)', () => {
    expect(() => adaptMaterialRequestEvent('ticket.status_changed', ticket({ ticket_id: undefined }))).toThrow(BadRequestException);
  });

  it('ticket de material aberto sem itens não vira ordem: 400', () => {
    expect(() => adaptMaterialRequestEvent('ticket.status_changed', ticket({ items: [] }))).toThrow('Requisição sem itens');
    expect(() => adaptMaterialRequestEvent('ticket.status_changed', ticket({ items: undefined }))).toThrow('Requisição sem itens');
  });
});

describe('adaptMaterialRequestEvent — itens e versão', () => {
  it('quantidade zero, negativa, não numérica ou ausente é 400', () => {
    for (const quantity of [0, -1, 'abc', undefined, null]) {
      expect(() => adaptMaterialRequestEvent('ticket.status_changed', ticket({ items: [item({ quantity })] }))).toThrow('quantidade inválida');
    }
  });

  it('quantidade em texto numérico é aceita (coerção Number)', () => {
    const r = adaptMaterialRequestEvent('ticket.status_changed', ticket({ items: [item({ quantity: '2.5' })] }));
    expect(r?.kind === 'approved' && r.order.items[0].quantity).toBe(2.5);
  });

  it('um item inválido reprova a requisição inteira (nada de ordem pela metade)', () => {
    expect(() => adaptMaterialRequestEvent('ticket.status_changed', ticket({ items: [item(), item({ quantity: 0 })] }))).toThrow(BadRequestException);
  });

  it('versão: número é usada; ausente ou texto vira 1', () => {
    const v = (version: unknown) => {
      const r = adaptMaterialRequestEvent('material_request.approved', { request_id: 'R1', version, items: [item()] });
      return r?.kind === 'approved' ? r.order.requestVersion : null;
    };
    expect(v(3)).toBe(3);
    expect(v(undefined)).toBe(1);
    expect(v('3')).toBe(1);
  });

  it('strings vazias viram ausentes (ex.: project_id "" não vira referência)', () => {
    const r = adaptMaterialRequestEvent('ticket.status_changed', ticket({ project_id: '', warehouse_code: '', notes: '' }));
    expect(r?.kind === 'approved' && r.order).toMatchObject({ projectAxisId: undefined, warehouseCode: undefined, notes: undefined });
  });

  it('item usa material_id quando presente; material_code fica disponível para resolução posterior', () => {
    const r = adaptMaterialRequestEvent('material_request.approved', { request_id: 'R2', items: [{ material_id: 'uuid-1', material_code: 'X', quantity: 1 }] });
    expect(r?.kind === 'approved' && r.order.items[0]).toMatchObject({ materialId: 'uuid-1', materialCode: 'X' });
  });

  it('item sem material_id nem material_code é repassado (quem rejeita é o FulfillmentService)', () => {
    const r = adaptMaterialRequestEvent('material_request.approved', { request_id: 'R3', items: [{ quantity: 1 }] });
    expect(r?.kind === 'approved' && r.order.items[0]).toMatchObject({ materialId: undefined, materialCode: undefined });
  });
});

describe('adaptMaterialRequestEvent — eventos nativos material_request.*', () => {
  it('approved e changed usam request_id e, na falta, ticket_id', () => {
    expect(adaptMaterialRequestEvent('material_request.approved', { request_id: 'R1', items: [item()] })).toMatchObject({ kind: 'approved', order: { axisRequestId: 'R1' } });
    expect(adaptMaterialRequestEvent('material_request.changed', { ticket_id: 'T9', items: [item()] })).toMatchObject({ kind: 'approved', order: { axisRequestId: 'T9' } });
  });

  it('approved sem nenhum identificador é 400', () => {
    expect(() => adaptMaterialRequestEvent('material_request.approved', { items: [item()] })).toThrow('request_id ausente.');
  });

  it('material_request.changed é reaplicado como nova versão (não é ignorado)', () => {
    const r = adaptMaterialRequestEvent('material_request.changed', { request_id: 'R1', version: 2, items: [item()] });
    expect(r?.kind === 'approved' && r.order.requestVersion).toBe(2);
  });

  it('cancel_requested usa motivo informado ou o padrão; sem id é 400', () => {
    expect(adaptMaterialRequestEvent('material_request.cancel_requested', { request_id: 'R1' })).toEqual({ kind: 'cancel_requested', axisRequestId: 'R1', reason: 'Cancelamento solicitado no Axis' });
    expect(adaptMaterialRequestEvent('material_request.cancel_requested', { request_id: 'R1', reason: 'Desistência' })).toMatchObject({ reason: 'Desistência' });
    expect(() => adaptMaterialRequestEvent('material_request.cancel_requested', { reason: 'x' })).toThrow(BadRequestException);
  });

  it('cancel_requested não exige itens nem categoria', () => {
    expect(adaptMaterialRequestEvent('material_request.cancel_requested', { ticket_id: 'T1', items: [] })).toMatchObject({ kind: 'cancel_requested', axisRequestId: 'T1' });
  });
});

describe('adaptMaterialRequestEvent — outros eventos', () => {
  it('evento não consumido (ex.: ping, user.created, material_request.rejected) devolve null', () => {
    expect(adaptMaterialRequestEvent('ping', {})).toBeNull();
    expect(adaptMaterialRequestEvent('user.created', { user_id: 'u1' })).toBeNull();
    expect(adaptMaterialRequestEvent('material_request.rejected', { request_id: 'R1' })).toBeNull();
  });
});

// Envio de material para obra (plano projeto aprovado §4.3): destino do site e quantidade decimal em string.
describe('adaptMaterialRequestEvent — material_request.approved com destino (§4.3)', () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    request_id: '11111111-1111-4111-8111-111111111111', version: 1, code: 'REQ-1', project_id: 'proj-1', cost_center_id: 'cc-1',
    requester_id: null, recipient_id: 'colab-1', warehouse_code: null, needed_by: '2026-11-24',
    destination: { site_id: 'site-1', site_code: 'GRU53', address: 'Rua das Fibras, 100', city: 'Sumaré', state: 'SP', latitude: -23.4, longitude: -46.5 },
    items: [{ material_code: 'RED-CAB-0123', quantity: '1200.000' }],
    ...over,
  });
  const order = (p: Record<string, unknown>) => {
    const r = adaptMaterialRequestEvent('material_request.approved', p);
    if (r?.kind !== 'approved') throw new Error('esperava approved');
    return r.order;
  };

  it('lê o destino do payload e monta o texto do romaneio', () => {
    expect(order(payload())).toMatchObject({
      axisRequestId: '11111111-1111-4111-8111-111111111111', projectAxisId: 'proj-1', costCenterAxisId: 'cc-1', recipientAxisId: 'colab-1', neededBy: '2026-11-24',
      destinationSiteAxisId: 'site-1', destinationText: 'GRU53 — Rua das Fibras, 100, Sumaré/SP', destinationLat: -23.4, destinationLng: -46.5,
    });
    expect(order(payload()).requesterAxisId).toBeUndefined(); // requester_id nulo
  });

  it('quantidade decimal em string vira número; material_code ou material_id', () => {
    const o = order(payload({ items: [{ material_code: 'A', quantity: '1200.000' }, { material_id: 'uuid-b', quantity: '0.5' }, { material_code: 'C', quantity: 3 }] }));
    expect(o.items).toEqual([
      { materialId: undefined, materialCode: 'A', quantity: 1200, notes: undefined },
      { materialId: 'uuid-b', materialCode: undefined, quantity: 0.5, notes: undefined },
      { materialId: undefined, materialCode: 'C', quantity: 3, notes: undefined },
    ]);
  });

  it('quantidade inválida (texto, zero, negativa, notação científica, mais de 6 casas) é 400', () => {
    for (const quantity of ['abc', '0', '0.000', '-1', '1e3', '1,5', '1.1234567', '', null, undefined, NaN]) {
      expect(() => order(payload({ items: [{ material_code: 'A', quantity }] })), String(quantity)).toThrow('quantidade inválida');
    }
  });

  it('sem destination a ordem fica sem destino (ticket legado e retirada continuam valendo)', () => {
    const o = order(payload({ destination: undefined }));
    expect(o.destinationSiteAxisId).toBeUndefined();
    expect(o.destinationText).toBeUndefined();
    expect(o.destinationLat).toBeUndefined();
    expect(order(payload({ destination: null })).destinationText).toBeUndefined();
    expect(order(ticket()).destinationText).toBeUndefined();
  });

  it('destino parcial: só o código do site já gera texto; endereço sem cidade não deixa "/" sobrando', () => {
    expect(order(payload({ destination: { site_id: 's', site_code: 'GRU53' } })).destinationText).toBe('GRU53');
    expect(order(payload({ destination: { site_id: 's', address: 'Av. X' } })).destinationText).toBe('Av. X');
    expect(order(payload({ destination: { site_id: 's', city: 'Sumaré', state: 'SP' } })).destinationText).toBe('Sumaré/SP');
    expect(order(payload({ destination: { site_id: 's' } })).destinationText).toBeUndefined();
  });

  it('coordenadas: aceita string decimal; arredonda a 6 casas; fora do intervalo ou só uma delas é 400', () => {
    expect(order(payload({ destination: { site_id: 's', latitude: '-23.123456789', longitude: '-46.5' } }))).toMatchObject({ destinationLat: -23.123457, destinationLng: -46.5 });
    expect(() => order(payload({ destination: { site_id: 's', latitude: 91, longitude: 0 } }))).toThrow('latitude inválida');
    expect(() => order(payload({ destination: { site_id: 's', latitude: 0, longitude: 181 } }))).toThrow('longitude inválida');
    expect(() => order(payload({ destination: { site_id: 's', latitude: 'norte', longitude: 0 } }))).toThrow('latitude inválida');
    expect(() => order(payload({ destination: { site_id: 's', latitude: -23.4 } }))).toThrow('devem vir juntas');
  });

  it('destination que não é objeto é 400', () => {
    for (const destination of ['GRU53', 7, ['x']]) expect(() => order(payload({ destination }))).toThrow('destination inválido');
  });

  it('material_request.changed leva o destino da nova versão', () => {
    const r = adaptMaterialRequestEvent('material_request.changed', payload({ version: 2 }));
    expect(r).toMatchObject({ kind: 'approved', order: { requestVersion: 2, destinationSiteAxisId: 'site-1' } });
  });

  it('cancel_requested segue sem destino', () => {
    expect(adaptMaterialRequestEvent('material_request.cancel_requested', { request_id: 'r1', reason: 'Projeto cancelado' })).toEqual({ kind: 'cancel_requested', axisRequestId: 'r1', reason: 'Projeto cancelado' });
  });
});
