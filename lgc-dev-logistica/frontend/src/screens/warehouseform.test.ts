import { describe, expect, it } from 'vitest';
import { validateWarehouse } from './WarehouseForm';

const ok = { code: 'ALM-SUMARE', name: 'Almoxarifado Sumaré', type: 'CENTRAL', addressText: '' };

describe('validação do novo almoxarifado', () => {
  it('aceita o cadastro mínimo', () => {
    expect(validateWarehouse(ok)).toEqual({});
  });

  it('código segue o formato da API', () => {
    expect(validateWarehouse({ ...ok, code: '' }).code).toBe('Informe o código.');
    expect(validateWarehouse({ ...ok, code: 'alm sumare' }).code).toMatch(/Código inválido/);
    expect(validateWarehouse({ ...ok, code: 'ALM--X' }).code).toMatch(/Código inválido/);
    expect(validateWarehouse({ ...ok, code: 'A'.repeat(31) }).code).toMatch(/30 caracteres/);
  });

  it('nome com ao menos 3 caracteres e tipo conhecido', () => {
    expect(validateWarehouse({ ...ok, name: ' ab ' }).name).toMatch(/ao menos 3/);
    expect(validateWarehouse({ ...ok, type: 'GALPAO' }).type).toBe('Escolha o tipo.');
  });

  it('endereço é opcional, com limite', () => {
    expect(validateWarehouse({ ...ok, addressText: 'x'.repeat(301) }).addressText).toMatch(/300/);
  });
});
