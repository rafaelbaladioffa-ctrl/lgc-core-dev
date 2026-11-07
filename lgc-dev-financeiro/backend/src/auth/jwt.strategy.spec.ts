import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy.js';
import type { RbacService } from '../rbac/rbac.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function build(cachedUser: { active: boolean } | null = null) {
  const config = { getOrThrow: () => 'segredo-de-teste' } as unknown as ConfigService;
  const rbac = { resolvePermissions: vi.fn().mockResolvedValue(['payable:read']) };
  const prisma = { axisMasterCache: { findUnique: vi.fn().mockResolvedValue(cachedUser) } };
  const strategy = new JwtStrategy(config, rbac as unknown as RbacService, prisma as unknown as PrismaService);
  return { strategy, rbac, prisma };
}

describe('JwtStrategy', () => {
  it('aceita o access token do Core e resolve as permissões locais', async () => {
    const { strategy, rbac } = build();
    const user = await strategy.validate({ sub: 'u1', email: 'ana@lgc.com.br', roles: ['admin', 7], collaboratorId: 'c1', mustChangePassword: false });
    expect(user).toEqual({ userId: 'u1', email: 'ana@lgc.com.br', axisRoles: ['admin'], collaboratorId: 'c1', mustChangePassword: false, permissions: ['payable:read'] });
    expect(rbac.resolvePermissions).toHaveBeenCalledWith(['admin'], 'u1');
  });

  it('recusa token com emissor, como a sessão de 8 h da Logística', async () => {
    const { strategy, rbac } = build();
    await expect(strategy.validate({ sub: 'u1', email: 'ana@lgc.com.br', iss: 'axis-logistica' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rbac.resolvePermissions).not.toHaveBeenCalled();
  });

  it('recusa usuário desativado no cache do Core', async () => {
    const { strategy } = build({ active: false });
    await expect(strategy.validate({ sub: 'u1', email: 'ana@lgc.com.br' })).rejects.toThrow('Usuário desativado no Axis.');
  });

  it('recusa token sem sub ou e-mail', async () => {
    const { strategy } = build();
    await expect(strategy.validate({ sub: '', email: 'ana@lgc.com.br' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate({ sub: 'u1' } as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('propaga a troca de senha pendente para o guard', async () => {
    const { strategy } = build();
    const user = await strategy.validate({ sub: 'u1', email: 'ana@lgc.com.br', mustChangePassword: true });
    expect(user.mustChangePassword).toBe(true);
  });
});
