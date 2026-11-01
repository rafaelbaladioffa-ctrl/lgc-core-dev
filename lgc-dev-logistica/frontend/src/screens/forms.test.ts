import { describe, expect, it } from 'vitest';
import { parseNum, validateLocationCode } from './AdminForms';
import { buildReceiveBody } from './TransferReceive';

describe('validateLocationCode', () => {
  it('aceita o formato da API', () => expect(validateLocationCode('A01-C02-E03')).toBeUndefined());
  it('recusa vazio, minúsculas e hífens soltos', () => {
    expect(validateLocationCode('  ')).toBeTruthy();
    expect(validateLocationCode('a01')).toBeTruthy();
    expect(validateLocationCode('A01--B')).toBeTruthy();
    expect(validateLocationCode('X'.repeat(41))).toBeTruthy();
  });
});

describe('parseNum', () => {
  it('lê formato pt-BR', () => { expect(parseNum('1.234,5')).toBe(1234.5); expect(parseNum('10')).toBe(10); });
  it('vazio ou inválido vira null', () => { expect(parseNum('')).toBeNull(); expect(parseNum('abc')).toBeNull(); });
});

describe('buildReceiveBody', () => {
  const items = [{ id: 'i1', materialId: 'm1', quantity: '10' }];
  it('exige endereço e quantidade válida', () => {
    expect('error' in buildReceiveBody(items, { i1: { qty: '10', loc: '' } })).toBe(true);
    expect('error' in buildReceiveBody(items, { i1: { qty: '', loc: 'L1' } })).toBe(true);
    expect('error' in buildReceiveBody(items, { i1: { qty: '11', loc: 'L1' } })).toBe(true);
  });
  it('monta o corpo (inclui recebimento parcial)', () => {
    expect(buildReceiveBody(items, { i1: { qty: '8', loc: 'L1' } })).toEqual({ body: { items: [{ itemId: 'i1', receivedQty: 8, toLocationId: 'L1' }] } });
  });
});

import { buildLocationPatch } from './AdminForms';
describe('buildLocationPatch', () => {
  const base = { name: ' Zona ', status: 'ATIVO', reason: '', capKind: '', capValue: '' };
  it('bloqueio exige motivo', () => expect('error' in buildLocationPatch({ ...base, status: 'BLOQUEADO' })).toBe(true));
  it('capacidade exige tipo e valor juntos', () => {
    expect('error' in buildLocationPatch({ ...base, capKind: 'PESO' })).toBe(true);
    expect('error' in buildLocationPatch({ ...base, capValue: '5' })).toBe(true);
    expect(buildLocationPatch({ ...base, capKind: 'PESO', capValue: '1.500,5' })).toEqual({ body: { name: 'Zona', status: 'ATIVO', capacityKind: 'PESO', capacityValue: 1500.5 } });
  });
});
