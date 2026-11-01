import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ClassifyDto, CloseCustodyDto, CreateReturnDto, ListCustodyQuery } from '../../src/returns/returns.dto.js';

// Validação dos DTOs de devolução e custódia (sem banco). Replica o ValidationPipe global do app.

const U = '11111111-1111-4111-8111-111111111111';
const base = { type: 'SOBRA', warehouseId: U, receivingLocationId: U, items: [{ materialId: U, quantity: 1 }] };
const errs = (cls: new () => object, body: Record<string, unknown>) => validateSync(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
const props = (cls: new () => object, body: Record<string, unknown>) => errs(cls, body).map((e) => e.property);

describe('CreateReturnDto', () => {
  it('aceita o payload mínimo válido', () => {
    expect(errs(CreateReturnDto, base)).toHaveLength(0);
  });

  it('aceita todos os tipos de devolução do enum, inclusive SOBRA e TROCA_TAMANHO', () => {
    for (const type of ['SOBRA', 'TROCA_TAMANHO', 'FERRAMENTA', 'ATIVO', 'DEFEITUOSO', 'AVARIA', 'RETORNO_PROJETO', 'RETORNO_TERCEIRO']) {
      expect(props(CreateReturnDto, { ...base, type })).toEqual([]);
    }
    expect(props(CreateReturnDto, { ...base, type: 'CONSUMO' })).toContain('type');
    expect(props(CreateReturnDto, { ...base, type: 'sobra' })).toContain('type');
  });

  it('rejeita array de itens vazio, acima de 200 e não-array', () => {
    expect(props(CreateReturnDto, { ...base, items: [] })).toContain('items');
    const many = Array.from({ length: 201 }, () => ({ materialId: U, quantity: 1 }));
    expect(props(CreateReturnDto, { ...base, items: many })).toContain('items');
    expect(props(CreateReturnDto, { ...base, items: 'nao-e-array' })).toContain('items');
  });

  it('rejeita quantidade zero, negativa, texto e mais de 6 casas decimais', () => {
    expect(props(CreateReturnDto, { ...base, items: [{ materialId: U, quantity: 0 }] })).toContain('items');
    expect(props(CreateReturnDto, { ...base, items: [{ materialId: U, quantity: -1 }] })).toContain('items');
    expect(props(CreateReturnDto, { ...base, items: [{ materialId: U, quantity: 'abc' }] })).toContain('items');
    expect(props(CreateReturnDto, { ...base, items: [{ materialId: U, quantity: 1.1234567 }] })).toContain('items');
  });

  it('aceita quantidade fracionária com até 6 casas (a precisão da UM é checada no service)', () => {
    expect(props(CreateReturnDto, { ...base, items: [{ materialId: U, quantity: 0.5 }] })).toEqual([]);
  });

  it('rejeita material, lote e série que não são UUID', () => {
    expect(props(CreateReturnDto, { ...base, items: [{ materialId: 'x', quantity: 1 }] })).toContain('items');
    expect(props(CreateReturnDto, { ...base, items: [{ materialId: U, quantity: 1, lotId: '123' }] })).toContain('items');
    expect(props(CreateReturnDto, { ...base, items: [{ materialId: U, quantity: 1, serialId: 'abc' }] })).toContain('items');
  });

  it('rejeita campos fora da whitelist e textos longos demais', () => {
    expect(props(CreateReturnDto, { ...base, extra: true })).toContain('extra');
    expect(props(CreateReturnDto, { ...base, notes: 'x'.repeat(501) })).toContain('notes');
    expect(props(CreateReturnDto, { ...base, returnedByAxisId: 'x'.repeat(61) })).toContain('returnedByAxisId');
  });

  it('exige warehouseId e receivingLocationId UUID', () => {
    expect(props(CreateReturnDto, { ...base, warehouseId: 'abc' })).toContain('warehouseId');
    expect(props(CreateReturnDto, { ...base, receivingLocationId: undefined })).toContain('receivingLocationId');
  });
});

describe('ClassifyDto', () => {
  it('aceita destinação válida com parecer', () => {
    expect(errs(ClassifyDto, { disposition: 'DISPONIVEL', notes: 'Em ordem' })).toHaveLength(0);
  });

  it('rejeita destinação fora do enum e parecer curto demais', () => {
    expect(props(ClassifyDto, { disposition: 'LIXO', notes: 'ok' })).toContain('disposition');
    expect(props(ClassifyDto, { disposition: 'DISPONIVEL', notes: 'ab' })).toContain('notes');
    expect(props(ClassifyDto, { disposition: 'DISPONIVEL' })).toContain('notes');
  });

  it('approvalRef é opcional no DTO (a obrigação para SUCATA é regra do service)', () => {
    expect(props(ClassifyDto, { disposition: 'SUCATA', notes: 'sem conserto' })).toEqual([]);
  });

  it('approvalRef acima de 80 caracteres é recusado', () => {
    expect(props(ClassifyDto, { disposition: 'SUCATA', notes: 'sem conserto', approvalRef: 'x'.repeat(81) })).toContain('approvalRef');
  });
});

describe('CloseCustodyDto', () => {
  it('exige motivo e aprovação do Axis', () => {
    expect(errs(CloseCustodyDto, { notes: 'Extraviado', approvalRef: 'EXT-1' })).toHaveLength(0);
    expect(props(CloseCustodyDto, { notes: 'Extraviado' })).toContain('approvalRef');
    expect(props(CloseCustodyDto, { approvalRef: 'EXT-1' })).toContain('notes');
    expect(props(CloseCustodyDto, { notes: 'ab', approvalRef: 'EXT-1' })).toContain('notes');
  });
});

describe('ListCustodyQuery', () => {
  it('converte página e tamanho de query string e limita pageSize a 100', () => {
    const q = plainToInstance(ListCustodyQuery, { page: '2', pageSize: '50' });
    expect(q.page).toBe(2);
    expect(q.pageSize).toBe(50);
    expect(props(ListCustodyQuery, { page: '0' })).toContain('page');
    expect(props(ListCustodyQuery, { pageSize: '101' })).toContain('pageSize');
    expect(props(ListCustodyQuery, { pageSize: '1.5' })).toContain('pageSize');
  });

  it('recusa status de custódia inválido', () => {
    expect(props(ListCustodyQuery, { status: 'ABERTO' })).toContain('status');
    expect(errs(ListCustodyQuery, { status: 'PERDIDO' })).toHaveLength(0);
  });
});
