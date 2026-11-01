import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CalculateDto, DiscardDto, ListSuggestionsQuery, SetPolicyDto, suggestionCode } from '../../src/replenishment/replenishment.service.js';

// Validação dos DTOs de reposição (sem banco). Replica o ValidationPipe global do app.

const U = '11111111-1111-4111-8111-111111111111';
const base = { materialId: U, warehouseId: U, minQty: 0 };
const props = (cls: new () => object, body: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);

describe('SetPolicyDto', () => {
  it('aceita mínimo zero e campos opcionais ausentes', () => {
    expect(props(SetPolicyDto, base)).toEqual([]);
  });

  it('rejeita quantidades negativas em todos os campos numéricos', () => {
    for (const k of ['minQty', 'maxQty', 'safetyQty', 'reorderPoint']) {
      expect(props(SetPolicyDto, { ...base, [k]: -1 })).toContain(k);
    }
  });

  it('rejeita ponto de reposição acima de 1e12', () => {
    expect(props(SetPolicyDto, { ...base, reorderPoint: 1e13 })).toContain('reorderPoint');
  });

  it('rejeita mais de 6 casas decimais na quantidade', () => {
    expect(props(SetPolicyDto, { ...base, minQty: 0.1234567 })).toContain('minQty');
  });

  it('converte quantidades vindas como texto (query/form)', () => {
    const dto = plainToInstance(SetPolicyDto, { ...base, minQty: '2.5' });
    expect(dto.minQty).toBe(2.5);
    expect(props(SetPolicyDto, { ...base, minQty: '2.5' })).toEqual([]);
  });

  it('exige UUID de material e almoxarifado', () => {
    expect(props(SetPolicyDto, { ...base, materialId: 'x' })).toContain('materialId');
    expect(props(SetPolicyDto, { ...base, warehouseId: 'x' })).toContain('warehouseId');
  });
});

describe('DiscardDto', () => {
  it('exige motivo com ao menos 3 caracteres e no máximo 300', () => {
    expect(props(DiscardDto, { reason: 'abc' })).toEqual([]);
    expect(props(DiscardDto, { reason: 'ab' })).toContain('reason');
    expect(props(DiscardDto, { reason: 'a'.repeat(301) })).toContain('reason');
    expect(props(DiscardDto, {})).toContain('reason');
  });
});

describe('CalculateDto e ListSuggestionsQuery', () => {
  it('calculate aceita escopo vazio (todos os almoxarifados) e rejeita UUID inválido', () => {
    expect(props(CalculateDto, {})).toEqual([]);
    expect(props(CalculateDto, { warehouseId: 'nao-uuid' })).toContain('warehouseId');
  });

  it('lista rejeita status fora do enum', () => {
    expect(props(ListSuggestionsQuery, { status: 'ABERTA' })).toEqual([]);
    expect(props(ListSuggestionsQuery, { status: 'PENDENTE' })).toContain('status');
  });
});

describe('suggestionCode', () => {
  it('formata REP com 8 dígitos e preserva sequência acima de 8 dígitos', () => {
    expect(suggestionCode(1)).toBe('REP-00000001');
    expect(suggestionCode(123456789)).toBe('REP-123456789');
  });
});
