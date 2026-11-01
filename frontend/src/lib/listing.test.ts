import { describe, expect, it } from 'vitest';
import { balanceSearchText, clampPage, filterBalances, materialsQuery, pageCount, pageRange } from './listing';

describe('paginação', () => {
  it('pageCount tem ao menos uma página, mesmo sem resultados', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
  });

  it('clampPage mantém a página dentro do intervalo quando os resultados encolhem', () => {
    expect(clampPage(3, 10, 20)).toBe(1); // filtro reduziu para uma página
    expect(clampPage(5, 45, 20)).toBe(3); // última página
    expect(clampPage(0, 45, 20)).toBe(1);
    expect(clampPage(2, 0, 20)).toBe(1); // lista vazia
  });

  it('pageRange exibe o intervalo correto, sem passar do total', () => {
    expect(pageRange(1, 20, 45)).toEqual({ from: 1, to: 20 });
    expect(pageRange(3, 20, 45)).toEqual({ from: 41, to: 45 });
    expect(pageRange(1, 20, 0)).toEqual({ from: 0, to: 0 });
  });

  it('pageRange com página fora do intervalo gera from > to (por isso o chamador deve usar clampPage)', () => {
    expect(pageRange(5, 20, 10)).toEqual({ from: 81, to: 10 });
  });
});

describe('materialsQuery (catálogo)', () => {
  const base = { page: 1, pageSize: 20, status: 'ATIVO', q: '', type: '', category: '' };

  it('envia só paginação e situação quando não há filtros', () => {
    expect(materialsQuery(base)).toBe('page=1&pageSize=20&status=ATIVO');
  });

  it('inclui busca, tipo e categoria quando preenchidos, com escape', () => {
    const qs = new URLSearchParams(materialsQuery({ ...base, page: 2, q: 'parafuso M8 & porca', type: 'CONSUMO', category: 'Fixação' }));
    expect(qs.get('page')).toBe('2');
    expect(qs.get('q')).toBe('parafuso M8 & porca');
    expect(qs.get('type')).toBe('CONSUMO');
    expect(qs.get('category')).toBe('Fixação');
  });
});

describe('filtro de saldos (estoque)', () => {
  const byId = new Map([
    ['m1', { code: 'MAT-001', shortDescription: 'Luva nitrílica' }],
    ['m2', { code: 'MAT-002', shortDescription: 'Óleo lubrificante' }],
  ]);
  const rows = [
    { materialId: 'm1', locationCode: 'A-01-01', lotNumber: 'L100' },
    { materialId: 'm2', locationCode: 'B-02-03', lotNumber: null },
    { materialId: 'm9', locationCode: 'C-01-01', lotNumber: 'L200' }, // material fora do mapa (ex.: inativo)
  ];

  it('termo vazio ou só espaços mantém tudo', () => {
    expect(filterBalances(rows, byId, '')).toHaveLength(3);
    expect(filterBalances(rows, byId, '   ')).toHaveLength(3);
  });

  it('busca por código, descrição, endereço e lote, sem diferenciar maiúsculas', () => {
    expect(filterBalances(rows, byId, 'mat-002')).toEqual([rows[1]]);
    expect(filterBalances(rows, byId, 'NITRÍLICA'.toLowerCase())).toEqual([rows[0]]);
    expect(filterBalances(rows, byId, 'c-01')).toEqual([rows[2]]);
    expect(filterBalances(rows, byId, 'l100')).toEqual([rows[0]]);
  });

  it('material ausente do mapa ainda pode ser achado pelo endereço ou lote', () => {
    expect(filterBalances(rows, byId, 'l200')).toEqual([rows[2]]);
  });

  it('aceita termo com espaços nas bordas (já com trim pelo chamador ou não)', () => {
    expect(filterBalances(rows, byId, '  luva ')).toEqual([rows[0]]);
  });

  it('balanceSearchText não quebra com lote nulo nem material ausente', () => {
    expect(balanceSearchText({ locationCode: 'X', lotNumber: null })).toBe('  x ');
  });
});
