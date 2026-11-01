import { describe, expect, it } from 'vitest';
import { resolveCode } from './codes';

const mats = [
  { id: 'm1', code: 'EPI-CAP-0001', description: 'Capacete', uom: 'UN', uomPrecision: 0, serialControlled: false, barcodes: [{ code: '7891234567895', factor: '1' }, { code: '17891234567892', factor: '12' }] },
  { id: 'm2', code: 'TUB:PVC', description: 'Tubo', uom: 'M', uomPrecision: 2, serialControlled: false, barcodes: [] },
];
const locs = [{ id: 'l1', code: 'A01-C02' }, { id: 'l2', code: 'DOCA' }];

describe('resolveCode — QR de lote e número com dois-pontos', () => {
  it('QR de lote cujo número tem ":" mantém o número inteiro', () => {
    expect(resolveCode('LGC:MAT:EPI-CAP-0001:LOT:2026:11:A', mats, locs)).toMatchObject({ kind: 'material', id: 'm1', lotNumber: '2026:11:A' });
  });
  it('código de material com ":" não cabe no formato LGC:MAT e fica desconhecido (nunca um material errado)', () => {
    expect(resolveCode('LGC:MAT:TUB:PVC', mats, locs).kind).toBe('unknown');
  });
  it('QR de lote sem número não inventa lote', () => {
    const r = resolveCode('LGC:MAT:EPI-CAP-0001', mats, locs);
    expect(r).toMatchObject({ kind: 'material' });
    expect((r as { lotNumber?: string }).lotNumber).toBeUndefined();
  });
});

describe('resolveCode — GTIN com fator e endereço', () => {
  it('embalagem com fator 12 converte; GTIN do item unitário mantém fator 1', () => {
    expect(resolveCode('17891234567892', mats, locs)).toMatchObject({ factor: 12 });
    expect(resolveCode('7891234567895', mats, locs)).toMatchObject({ factor: 1 });
  });
  it('GTIN de embalagem com fator inválido ("0") cai para 1, não zera a quantidade', () => {
    const bad = [{ ...mats[0], barcodes: [{ code: '999', factor: '0' }] }];
    expect(resolveCode('999', bad, locs)).toMatchObject({ kind: 'material', factor: 1 });
  });
  it('endereço em minúsculas, com espaços ou em QR, resolve para o código cadastrado', () => {
    expect(resolveCode('  a01-c02  ', mats, locs)).toMatchObject({ kind: 'location', code: 'A01-C02' });
    expect(resolveCode('LGC:LOC:ALM1:a01-c02', mats, locs)).toMatchObject({ kind: 'location', id: 'l1' });
    expect(resolveCode('doca', mats, locs)).toMatchObject({ kind: 'location', id: 'l2' });
  });
});

describe('resolveCode — entradas maliciosas ou enormes', () => {
  it('HTML, SQL e caracteres de controle viram "unknown" com o texto bruto preservado', () => {
    const inj = "<img src=x onerror=alert(1)>'; DROP TABLE material;--";
    expect(resolveCode(inj, mats, locs)).toEqual({ kind: 'unknown', raw: inj });
    expect(resolveCode('\u0000\u0007EPI', mats, locs).kind).toBe('unknown');
  });
  it('texto de 1 MB não quebra e não casa nenhum código', () => {
    const big = 'A'.repeat(1_000_000);
    expect(resolveCode(big, mats, locs).kind).toBe('unknown');
    expect(resolveCode(`LGC:MAT:${big}`, mats, locs).kind).toBe('unknown');
  });
  it('prefixo LGC sem tipo válido ou sem valor não casa nada', () => {
    expect(resolveCode('LGC::', mats, locs).kind).toBe('unknown');
    expect(resolveCode('LGC:LOC:ALM1:', mats, locs).kind).toBe('unknown');
    expect(resolveCode('LGC:MAT:', mats, locs).kind).toBe('unknown');
  });
});
