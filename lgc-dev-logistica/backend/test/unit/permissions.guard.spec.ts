import { describe, it, expect } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../src/rbac/permissions.guard.js';
import { RequirePermissions } from '../../src/rbac/permissions.decorator.js';

class Target {
  @RequirePermissions('material:write', 'material:read')
  guarded() {}

  open() {}
}

const ctxFor = (handler: unknown, user?: { permissions: string[] }): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => Target,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('rota sem @RequirePermissions é liberada para qualquer usuário autenticado', () => {
    expect(guard.canActivate(ctxFor(Target.prototype.open, { permissions: [] }))).toBe(true);
  });

  it('libera quando todas as permissões exigidas estão presentes', () => {
    expect(guard.canActivate(ctxFor(Target.prototype.guarded, { permissions: ['material:read', 'material:write', 'x'] }))).toBe(true);
  });

  it('nega quando falta qualquer permissão e informa quais faltam', () => {
    const run = () => guard.canActivate(ctxFor(Target.prototype.guarded, { permissions: ['material:read'] }));
    expect(run).toThrow(ForbiddenException);
    expect(run).toThrow('Necessário: material:write.');
  });

  it('nega quando não há usuário na requisição', () => {
    expect(() => guard.canActivate(ctxFor(Target.prototype.guarded, undefined))).toThrow(ForbiddenException);
  });

  it('exige correspondência exata: permissão parecida não serve', () => {
    expect(() => guard.canActivate(ctxFor(Target.prototype.guarded, { permissions: ['material:write:all', 'material:read '] }))).toThrow(ForbiddenException);
  });
});
