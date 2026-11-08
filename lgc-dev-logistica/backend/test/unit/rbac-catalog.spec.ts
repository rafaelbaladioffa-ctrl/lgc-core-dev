import { describe, expect, it } from 'vitest';
import { DEFAULT_AXIS_ROLE_MAP, ROLES } from '../../src/rbac/catalog.js';

const permsOf = (axisRole: string) => new Set(DEFAULT_AXIS_ROLE_MAP[axisRole].flatMap((code) => ROLES.find((r) => r.code === code)?.permissions ?? []));

describe('mapeamento padrão das roles do Axis', () => {
  it('admin do Axis lê todas as ordens de atendimento', () => {
    const perms = permsOf('admin');
    expect(perms.has('fulfillment:read')).toBe(true);
    expect(perms.has('fulfillment:read_all')).toBe(true);
  });

  it('a leitura não traz operação: admin continua sem reservar, cancelar, separar ou expedir', () => {
    const perms = permsOf('admin');
    for (const p of ['fulfillment:manage', 'picking:execute', 'shipment:execute', 'stock:post', 'stock:adjust']) expect(perms.has(p)).toBe(false);
  });

  it('todo perfil mapeado existe no catálogo', () => {
    for (const codes of Object.values(DEFAULT_AXIS_ROLE_MAP)) for (const c of codes) expect(ROLES.some((r) => r.code === c)).toBe(true);
  });
});
