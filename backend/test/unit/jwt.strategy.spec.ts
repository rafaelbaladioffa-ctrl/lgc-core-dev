import { describe, it, expect, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../../src/auth/jwt.strategy.js';
import type { RbacService } from '../../src/rbac/rbac.service.js';

const SECRET = 'segredo-de-teste-com-tamanho-suficiente-0123456789';

const build = () => {
  const config = { getOrThrow: vi.fn().mockReturnValue(SECRET) } as unknown as ConfigService;
  const rbac = { resolvePermissions: vi.fn().mockResolvedValue(['material:read']) };
  return { strategy: new JwtStrategy(config, rbac as unknown as RbacService), rbac, config };
};

describe('JwtStrategy (SSO Axis)', () => {
  it('lê JWT_SECRET via ConfigService (falha se ausente)', () => {
    const { config } = build();
    expect(config.getOrThrow).toHaveBeenCalledWith('JWT_SECRET');
  });

  it('mapeia o payload do Axis para o usuário autenticado', async () => {
    const { strategy, rbac } = build();
    const user = await strategy.validate({ sub: 'axis-1', email: 'a@b.c', roles: ['gestor'], collaboratorId: 'c-1', mustChangePassword: false });
    expect(user).toEqual({
      userId: 'axis-1',
      email: 'a@b.c',
      axisRoles: ['gestor'],
      collaboratorId: 'c-1',
      mustChangePassword: false,
      permissions: ['material:read'],
    });
    expect(rbac.resolvePermissions).toHaveBeenCalledWith(['gestor']);
  });

  it('roles não-array viram lista vazia', async () => {
    const { strategy, rbac } = build();
    const user = await strategy.validate({ sub: 'x', email: 'x@x', roles: 'admin' as unknown as string[] });
    expect(user.axisRoles).toEqual([]);
    expect(rbac.resolvePermissions).toHaveBeenCalledWith([]);
  });

  it('collaboratorId ausente vira null; mustChangePassword só vale quando for booleano true', async () => {
    const { strategy } = build();
    const user = await strategy.validate({ sub: 'x', email: 'x@x', mustChangePassword: 'true' as unknown as boolean });
    expect(user.collaboratorId).toBeNull();
    expect(user.mustChangePassword).toBe(false);
  });

  it('ignora permissions embutidas no token (vale só o mapeamento local)', async () => {
    const { strategy, rbac } = build();
    await strategy.validate({ sub: 'x', email: 'x@x', roles: ['gestor'], permissions: ['rbac:write'] } as never);
    expect(rbac.resolvePermissions).toHaveBeenCalledWith(['gestor']);
  });
});
