import { describe, expect, it } from 'vitest';
import { buildMaterialBody, emptyMaterial, validateMaterial } from './MaterialForm';

const ok = () => ({ ...emptyMaterial(), code: 'EPI-CAP-0001', shortDescription: 'Capacete', category: 'EPI', type: 'EPI', stockUomId: 'u1' });

describe('validateMaterial', () => {
  it('cadastro válido não tem erros', () => expect(validateMaterial(ok(), 'create')).toEqual({}));
  it('obrigatórios e formato do código', () => {
    const e = validateMaterial(emptyMaterial(), 'create');
    expect(Object.keys(e)).toEqual(expect.arrayContaining(['code', 'shortDescription', 'category', 'type', 'stockUomId']));
    expect(validateMaterial({ ...ok(), code: 'epi cap' }, 'create').code).toMatch(/inválido/);
    expect(validateMaterial({ ...ok(), code: 'ABC' }, 'create').code).toBeTruthy();
  });
  it('na edição o código não é exigido', () => expect(validateMaterial({ ...ok(), code: '' }, 'edit').code).toBeUndefined());
  it('regras de controle espelham a API', () => {
    expect(validateMaterial({ ...ok(), expiryControlled: true }, 'create').expiryControlled).toBeTruthy();
    expect(validateMaterial({ ...ok(), exitMethod: 'FEFO' }, 'create').exitMethod).toBeTruthy();
    expect(validateMaterial({ ...ok(), serialControlled: true }, 'create').exitMethod).toBeTruthy();
    expect(validateMaterial({ ...ok(), serialControlled: true, exitMethod: 'SERIE_ESPECIFICA' }, 'create')).toEqual({});
    expect(validateMaterial({ ...ok(), minShelfLifeDays: '30' }, 'create').minShelfLifeDays).toBeTruthy();
    expect(validateMaterial({ ...ok(), lotControlled: true, expiryControlled: true, exitMethod: 'FEFO', minShelfLifeDays: '30' }, 'create')).toEqual({});
    expect(validateMaterial({ ...ok(), requiresAuthorization: true }, 'create').authorizationBy).toBeTruthy();
  });
});

describe('buildMaterialBody', () => {
  it('criação envia o código e os campos preenchidos', () => {
    const b = buildMaterialBody({ ...ok(), brand: ' 3M ' }, 'create');
    expect(b).toMatchObject({ code: 'EPI-CAP-0001', shortDescription: 'Capacete', brand: '3M', type: 'EPI', stockUomId: 'u1' });
    expect(b).not.toHaveProperty('subcategory');
  });
  it('edição envia só o que mudou, sem código, com o motivo', () => {
    const orig = ok();
    const b = buildMaterialBody({ ...orig, shortDescription: 'Capacete de segurança', changeReason: ' ajuste ' }, 'edit', orig);
    expect(b).toEqual({ shortDescription: 'Capacete de segurança', changeReason: 'ajuste' });
  });
});
