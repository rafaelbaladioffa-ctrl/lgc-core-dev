import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ADJUSTMENT_REASONS, AdjustLineDto, ApplyAdjustmentsDto, CancelCountDto, CountScopeDto, CreateCountDto, ListCountsQuery, SubmitCountDto, ActionPlanDto } from '../../src/inventory/inventory.dto.js';

// Validação isolada dos DTOs de inventário (sem banco), com as mesmas opções do ValidationPipe da aplicação.
const UUID = '6f1c2b8e-3d4a-4b5c-8d6e-7f8091a2b3c4';
const UUID2 = '7a2d3c9f-4e5b-4c6d-9e7f-8091a2b3c4d5';
const check = async <T extends object>(cls: new () => T, body: Record<string, unknown>) => {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto as object, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property);
};
const createBase = { type: 'ENDERECO', warehouseId: UUID, scope: { locationIds: [UUID] } };

describe('CreateCountDto — tolerância', () => {
  it.each([0, 0.01, 10, 99.99, 100])('aceita tolerância %s', async (t) => {
    expect(await check(CreateCountDto, { ...createBase, tolerancePct: t })).toEqual([]);
  });
  it.each([-0.01, 100.01, 10.005, 'abc'])('rejeita tolerância %s', async (t) => {
    expect(await check(CreateCountDto, { ...createBase, tolerancePct: t })).toContain('tolerancePct');
  });
  it('converte tolerância enviada como texto numérico', async () => {
    expect(await check(CreateCountDto, { ...createBase, tolerancePct: '5' })).toEqual([]);
  });
  it('tipo e almoxarifado obrigatórios; tipo fora do enum é rejeitado', async () => {
    expect(await check(CreateCountDto, { warehouseId: UUID })).toEqual(expect.arrayContaining(['type']));
    expect(await check(CreateCountDto, { ...createBase, type: 'FOO' })).toContain('type');
    expect(await check(CreateCountDto, { ...createBase, warehouseId: 'nao-uuid' })).toContain('warehouseId');
  });
  it('frozen não é coagido de texto: "true" é rejeitado', async () => {
    expect(await check(CreateCountDto, { ...createBase, frozen: 'true' })).toContain('frozen');
    expect(await check(CreateCountDto, { ...createBase, frozen: false })).toEqual([]);
  });
});

describe('CountScopeDto — escopo', () => {
  it('aceita exatamente 500 endereços e rejeita 501', async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(await check(CountScopeDto, { locationIds: ids(500) })).toEqual([]);
    expect(await check(CountScopeDto, { locationIds: ids(501) })).toContain('locationIds');
  });
  it('rejeita ids que não são UUID em qualquer lista do escopo', async () => {
    expect(await check(CountScopeDto, { materialIds: ['x'] })).toContain('materialIds');
    expect(await check(CountScopeDto, { lotIds: [UUID, 'x'] })).toContain('lotIds');
  });
  it.each(['A', 'B', 'C'])('criticidade %s é válida', async (c) => {
    expect(await check(CountScopeDto, { criticality: c })).toEqual([]);
  });
  it.each(['D', 'a', ''])('criticidade %j é inválida', async (c) => {
    expect(await check(CountScopeDto, { criticality: c })).toContain('criticality');
  });
  it.each([1, 5000])('tamanho de amostra %s é aceito', async (n) => {
    expect(await check(CountScopeDto, { sampleSize: n })).toEqual([]);
  });
  it.each([0, 5001, 1.5, -3])('tamanho de amostra %s é rejeitado', async (n) => {
    expect(await check(CountScopeDto, { sampleSize: n })).toContain('sampleSize');
  });
  it('tamanho de amostra em texto não é coagido (ao contrário da tolerância)', async () => {
    expect(await check(CountScopeDto, { sampleSize: '2' })).toContain('sampleSize');
  });
  it('campo fora do escopo é barrado pelo whitelist', async () => {
    expect(await check(CountScopeDto, { locationIds: [UUID], warehouseId: UUID2 })).toContain('warehouseId');
  });
});

describe('SubmitCountDto — quantidade contada', () => {
  const base = { lineId: UUID };
  it('converte texto numérico e aceita até 6 casas decimais', async () => {
    expect(await check(SubmitCountDto, { ...base, quantity: '5' })).toEqual([]);
    expect(await check(SubmitCountDto, { ...base, quantity: 0.000001 })).toEqual([]);
  });
  it('rejeita 7 casas decimais e negativos', async () => {
    expect(await check(SubmitCountDto, { ...base, quantity: 1.1234567 })).toContain('quantity');
    expect(await check(SubmitCountDto, { ...base, quantity: -1 })).toContain('quantity');
  });
  it('rejeita texto não numérico', async () => {
    expect(await check(SubmitCountDto, { ...base, quantity: 'dez' })).toContain('quantity');
  });
  it('rejeita linha que não é UUID', async () => {
    expect(await check(SubmitCountDto, { lineId: '1', quantity: 1 })).toContain('lineId');
  });
  it('observação: até 300 caracteres', async () => {
    expect(await check(SubmitCountDto, { ...base, quantity: 1, notes: 'a'.repeat(300) })).toEqual([]);
    expect(await check(SubmitCountDto, { ...base, quantity: 1, notes: 'a'.repeat(301) })).toContain('notes');
  });
  it('BUG: quantidade vazia ("") não deve ser aceita como contagem zero', async () => {
    // @Type(() => Number) transforma "" em 0 e o DTO aceita: um campo esquecido vira contagem zero.
    expect(await check(SubmitCountDto, { ...base, quantity: '' })).toContain('quantity');
  });
});

describe('AdjustLineDto e ApplyAdjustmentsDto — motivos e aprovação', () => {
  it.each(ADJUSTMENT_REASONS)('motivo %s é aceito', async (r) => {
    expect(await check(AdjustLineDto, { lineId: UUID, reason: r })).toEqual([]);
  });
  it('motivo em minúsculas ou fora da lista é rejeitado', async () => {
    expect(await check(AdjustLineDto, { lineId: UUID, reason: 'perda' })).toContain('reason');
    expect(await check(AdjustLineDto, { lineId: UUID, reason: 'INVENTADO' })).toContain('reason');
  });
  it('observação do ajuste até 300 caracteres', async () => {
    expect(await check(AdjustLineDto, { lineId: UUID, reason: 'OUTRO', notes: 'a'.repeat(301) })).toContain('notes');
  });

  const adj = (over: Record<string, unknown> = {}) => ({ approvalRef: 'APR-123', lines: [{ lineId: UUID, reason: 'PERDA' }], ...over });
  it('aprovação entre 3 e 80 caracteres', async () => {
    expect(await check(ApplyAdjustmentsDto, adj({ approvalRef: 'ABC' }))).toEqual([]);
    expect(await check(ApplyAdjustmentsDto, adj({ approvalRef: 'a'.repeat(80) }))).toEqual([]);
    expect(await check(ApplyAdjustmentsDto, adj({ approvalRef: 'AB' }))).toContain('approvalRef');
    expect(await check(ApplyAdjustmentsDto, adj({ approvalRef: 'a'.repeat(81) }))).toContain('approvalRef');
  });
  it('exige ao menos uma linha e valida cada linha aninhada', async () => {
    expect(await check(ApplyAdjustmentsDto, adj({ lines: [] }))).toContain('lines');
    expect(await check(ApplyAdjustmentsDto, adj({ lines: [{ lineId: UUID, reason: 'NAO_EXISTE' }] }))).toContain('lines');
  });
  it('aprovação ausente é rejeitada', async () => {
    expect(await check(ApplyAdjustmentsDto, { lines: [{ lineId: UUID, reason: 'PERDA' }] })).toContain('approvalRef');
  });
});

describe('CancelCountDto, ActionPlanDto e ListCountsQuery', () => {
  it('motivo de cancelamento entre 3 e 300 caracteres', async () => {
    expect(await check(CancelCountDto, { reason: 'abc' })).toEqual([]);
    expect(await check(CancelCountDto, { reason: 'ab' })).toContain('reason');
    expect(await check(CancelCountDto, { reason: 'a'.repeat(301) })).toContain('reason');
  });
  it('plano de ação entre 5 e 2000 caracteres e somente texto', async () => {
    expect(await check(ActionPlanDto, { text: '12345' })).toEqual([]);
    expect(await check(ActionPlanDto, { text: '1234' })).toContain('text');
    expect(await check(ActionPlanDto, { text: 'a'.repeat(2001) })).toContain('text');
    expect(await check(ActionPlanDto, { text: 12345 })).toContain('text');
  });
  it('filtros da listagem: status do enum e almoxarifado UUID', async () => {
    expect(await check(ListCountsQuery, { status: 'APURADA', warehouseId: UUID })).toEqual([]);
    expect(await check(ListCountsQuery, { status: 'FECHADA' })).toContain('status');
    expect(await check(ListCountsQuery, { warehouseId: 'x' })).toContain('warehouseId');
  });
});
