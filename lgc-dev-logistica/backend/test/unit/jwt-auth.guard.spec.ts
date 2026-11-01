import { describe, it, expect, vi, afterEach } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard.js';
import { Public } from '../../src/auth/public.decorator.js';

class Target {
  @Public()
  publicRoute() {}

  privateRoute() {}
}

const ctxFor = (handler: unknown, user?: object): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => Target,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

// Classe base gerada por AuthGuard('jwt') do @nestjs/passport.
const passportBase = Object.getPrototypeOf(JwtAuthGuard.prototype) as { canActivate: (c: ExecutionContext) => Promise<boolean> };

describe('JwtAuthGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rota @Public() não exige JWT', async () => {
    const spy = vi.spyOn(passportBase, 'canActivate').mockResolvedValue(false);
    const guard = new JwtAuthGuard(new Reflector());
    await expect(guard.canActivate(ctxFor(Target.prototype.publicRoute))).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rota privada delega ao passport e nega quando a validação falha', async () => {
    vi.spyOn(passportBase, 'canActivate').mockResolvedValue(false);
    const guard = new JwtAuthGuard(new Reflector());
    await expect(guard.canActivate(ctxFor(Target.prototype.privateRoute, { mustChangePassword: false }))).resolves.toBe(false);
  });

  it('bloqueia com 403 quando o Axis marca mustChangePassword', async () => {
    vi.spyOn(passportBase, 'canActivate').mockResolvedValue(true);
    const guard = new JwtAuthGuard(new Reflector());
    await expect(guard.canActivate(ctxFor(Target.prototype.privateRoute, { mustChangePassword: true }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('libera rota privada com JWT válido e senha em dia', async () => {
    vi.spyOn(passportBase, 'canActivate').mockResolvedValue(true);
    const guard = new JwtAuthGuard(new Reflector());
    await expect(guard.canActivate(ctxFor(Target.prototype.privateRoute, { mustChangePassword: false }))).resolves.toBe(true);
  });
});
