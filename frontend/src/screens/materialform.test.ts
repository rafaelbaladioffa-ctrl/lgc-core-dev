import { describe, expect, it } from 'vitest';
import { buildMaterialBody, codePreview, emptyMaterial, validateMaterial } from './MaterialForm';

const ok = () => ({ ...emptyMaterial(), family: 'EPI', subcode: 'CAP', shortDescription: 'Capacete', category: 'EPI', type: 'EPI', stockUomId: 'u1' });

describe('validateMaterial', () => {
  it('cadastro válido não tem erros', () => expect(validateMaterial(ok(), 'create')).toEqual({}));
  it('obrigatórios e formato do código', () => {
    const e = validateMaterial(emptyMaterial(), 'create');
    expect(Object.keys(e)).toEqual(expect.arrayContaining(['family', 'subcode', 'shortDescription', 'category', 'type', 'stockUomId']));
    expect(validateMaterial({ ...ok(), subcode: 'ca' }, 'create').subcode).toBeTruthy();
    expect(validateMaterial({ ...ok(), subcode: 'CAPS' }, 'create').subcode).toBeTruthy();
  });
  it('na edição família e subcódigo não são exigidos', () => expect(validateMaterial({ ...ok(), family: '', subcode: '' }, 'edit')).toEqual({}));
  it('prévia do código', () => { expect(codePreview('EPI', 'CAP')).toBe('EPI-CAP-####'); expect(codePreview('', 'c')).toBe('???-???-####'); });
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
    expect(b).toMatchObject({ family: 'EPI', subcode: 'CAP', shortDescription: 'Capacete', brand: '3M', type: 'EPI', stockUomId: 'u1' });
    expect(b).not.toHaveProperty('subcategory');
    expect(b).not.toHaveProperty('code');
  });
  it('edição envia só o que mudou, sem código, com o motivo', () => {
    const orig = ok();
    const b = buildMaterialBody({ ...orig, shortDescription: 'Capacete de segurança', changeReason: ' ajuste ' }, 'edit', orig);
    expect(b).toEqual({ shortDescription: 'Capacete de segurança', changeReason: 'ajuste' });
  });
});
