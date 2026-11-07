import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { DEFAULT_AXIS_ROLE_MAP, PERMISSIONS, ROLES } from './catalog.js';
import { PermissionsGuard } from './permissions.guard.js';

function context(permissions: string[] | undefined): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: permissions ? { permissions } : undefined }) }),
  } as unknown as ExecutionContext;
}

const guardRequiring = (required: string[] | undefined) => new PermissionsGuard({ getAllAndOverride: () => required } as unknown as Reflector);

describe('PermissionsGuard', () => {
  it('libera rota sem permissão exigida', () => {
    expect(guardRequiring(undefined).canActivate(context(undefined))).toBe(true);
  });

  it('libera quando o usuário tem todas as permissões', () => {
    expect(guardRequiring(['payable:read', 'payable:approve']).canActivate(context(['payable:approve', 'payable:read']))).toBe(true);
  });

  it('nega e lista o que falta', () => {
    expect(() => guardRequiring(['payable:read', 'payable:approve']).canActivate(context(['payable:read']))).toThrow(new ForbiddenException('Permissão insuficiente. Necessário: payable:approve.'));
  });
});

describe('catálogo de RBAC', () => {
  const byCode = new Map(ROLES.map((r) => [r.code, r]));

  it('todo perfil usa só permissões existentes, sem repetir', () => {
    for (const role of ROLES) {
      expect(role.permissions.filter((p) => !(p in PERMISSIONS))).toEqual([]);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('o mapeamento inicial do Core aponta para perfis existentes', () => {
    for (const codes of Object.values(DEFAULT_AXIS_ROLE_MAP)) for (const c of codes) expect(byCode.has(c)).toBe(true);
  });

  it('segregação: quem lança não aprova, quem aprova não paga', () => {
    const can = (code: string, p: string) => byCode.get(code)!.permissions.includes(p);
    expect(can('ANALISTA_CONTAS_PAGAR', 'payable:approve')).toBe(false);
    expect(can('APROVADOR_FINANCEIRO', 'payable:write')).toBe(false);
    expect(can('APROVADOR_FINANCEIRO', 'payment:execute')).toBe(false);
    expect(can('TESOURARIA', 'payable:approve')).toBe(false);
  });

  it('o administrador técnico não acessa títulos, pagamentos nem dados bancários', () => {
    const admin = byCode.get('ADMIN_TECNICO')!.permissions;
    expect(admin.filter((p) => /^(payable|payment|supplier|bank_account):/.test(p))).toEqual([]);
  });
});
