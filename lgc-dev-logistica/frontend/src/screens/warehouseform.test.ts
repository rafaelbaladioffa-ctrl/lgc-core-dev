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

describe('corpo do cadastro com vínculos do Core', () => {
  it('só envia responsável e site quando escolhidos no seletor; endereço em texto continua', async () => {
    const { warehousePayload } = await import('./WarehouseForm');
    expect(warehousePayload({ ...ok, addressText: '  ' })).toEqual({ code: 'ALM-SUMARE', name: 'Almoxarifado Sumaré', type: 'CENTRAL' });
    expect(warehousePayload({ ...ok, addressText: ' Rua A, 1 ' }, { responsibleAxisUserId: 'c-1', siteAxisId: 's-1' })).toEqual({
      code: 'ALM-SUMARE', name: 'Almoxarifado Sumaré', type: 'CENTRAL', addressText: 'Rua A, 1', responsibleAxisUserId: 'c-1', siteAxisId: 's-1',
    });
  });
});
