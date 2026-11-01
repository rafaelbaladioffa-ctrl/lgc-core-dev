import { describe, expect, it } from 'vitest';
import { resolveCode } from './codes';
import { fmtDateTime, fmtQty, parseQty } from './format';

const mats = [{ id: 'm1', code: 'EPI-CAP-0001', description: 'Capacete', uom: 'UN', uomPrecision: 0, serialControlled: false, barcodes: [{ code: '7891234567895', factor: '1' }, { code: '17891234567892', factor: '12' }] }];
const locs = [{ id: 'l1', code: 'A01-C02' }];

describe('resolveCode', () => {
  it('reconhece QR de endereço, material com lote, SKU, GTIN e embalagem com fator', () => {
    expect(resolveCode('LGC:LOC:ALM1:A01-C02', mats, locs)).toMatchObject({ kind: 'location', id: 'l1' });
    expect(resolveCode('LGC:MAT:EPI-CAP-0001:LOT:L-9', mats, locs)).toMatchObject({ kind: 'material', id: 'm1', lotNumber: 'L-9' });
    expect(resolveCode('epi-cap-0001', mats, locs)).toMatchObject({ kind: 'material', factor: 1 });
    expect(resolveCode('7891234567895', mats, locs)).toMatchObject({ kind: 'material', factor: 1 });
    expect(resolveCode('17891234567892', mats, locs)).toMatchObject({ kind: 'material', factor: 12 });
    expect(resolveCode('a01-c02', mats, locs)).toMatchObject({ kind: 'location', code: 'A01-C02' });
  });
  it('código desconhecido, vazio ou de outro sistema não vira material nem endereço', () => {
    expect(resolveCode('999', mats, locs).kind).toBe('unknown');
    expect(resolveCode('   ', mats, locs).kind).toBe('unknown');
    expect(resolveCode('LGC:MAT:NAO-EXISTE', mats, locs).kind).toBe('unknown');
    expect(resolveCode('LGC:XYZ:1', mats, locs).kind).toBe('unknown');
  });
});

describe('formatação pt-BR', () => {
  it('data e hora em America/Sao_Paulo', () => expect(fmtDateTime('2026-11-01T15:30:00Z')).toBe('01/11/2026 12:30'));
  it('quantidades com vírgula e entrada tolerante', () => {
    expect(fmtQty('1234.5')).toBe('1.234,5');
    expect(parseQty('1,5')).toBe(1.5);
    expect(parseQty('1.234,5')).toBe(1234.5);
    expect(parseQty('3')).toBe(3);
    expect(parseQty('')).toBeNull();
    expect(parseQty('abc')).toBeNull();
  });
});
