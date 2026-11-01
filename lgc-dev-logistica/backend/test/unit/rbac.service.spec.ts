import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { RbacService } from '../../src/rbac/rbac.service.js';
import type { AuthenticatedUser } from '../../src/auth/authenticated-request.js';

const user = (permissions: string[], userId = 'u1'): AuthenticatedUser => ({
  userId,
  email: 'u@lgc.test',
  axisRoles: [],
  collaboratorId: null,
  mustChangePassword: false,
  permissions,
});

describe('RbacService', () => {
  let prisma: {
    rolePermission: { findMany: ReturnType<typeof vi.fn> };
    logisticsRole: { findMany: ReturnType<typeof vi.fn> };
    userWarehouseAccess: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  };
  let service: RbacService;

  beforeEach(() => {
    prisma = {
      rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
      logisticsRole: { findMany: vi.fn().mockResolvedValue([]) },
      userWarehouseAccess: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new RbacService(prisma as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('resolvePermissions', () => {
    it('sem perfis do Axis retorna vazio sem consultar o banco', async () => {
      expect(await service.resolvePermissions([])).toEqual([]);
      expect(prisma.rolePermission.findMany).not.toHaveBeenCalled();
    });

    it('faz a união das permissões de todos os perfis, sem duplicatas e ordenadas', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([
        { permission: { code: 'stock:read' } },
        { permission: { code: 'material:read' } },
        { permission: { code: 'stock:read' } },
      ]);
      expect(await service.resolvePermissions(['a', 'b'])).toEqual(['material:read', 'stock:read']);
    });

    it('usa cache para a mesma combinação de perfis, independentemente da ordem', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ permission: { code: 'uom:read' } }]);
      await service.resolvePermissions(['x', 'y']);
      await service.resolvePermissions(['y', 'x']);
      expect(prisma.rolePermission.findMany).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache força nova consulta', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ permission: { code: 'uom:read' } }]);
      await service.resolvePermissions(['x']);
      service.invalidateCache();
      await service.resolvePermissions(['x']);
      expect(prisma.rolePermission.findMany).toHaveBeenCalledTimes(2);
    });

    it('expira o cache após 30 s', async () => {
      vi.useFakeTimers();
      prisma.rolePermission.findMany.mockResolvedValue([]);
      await service.resolvePermissions(['x']);
      vi.advanceTimersByTime(30_001);
      await service.resolvePermissions(['x']);
      expect(prisma.rolePermission.findMany).toHaveBeenCalledTimes(2);
    });

    it('perfil sem mapeamento não recebe permissão', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([]);
      expect(await service.resolvePermissions(['rh'])).toEqual([]);
    });
  });

  describe('assertWarehouseAccess', () => {
    it('warehouse:access_all dispensa consulta de escopo', async () => {
      await expect(service.assertWarehouseAccess(user(['warehouse:access_all']), 'wh1')).resolves.toBeUndefined();
      expect(prisma.userWarehouseAccess.findUnique).not.toHaveBeenCalled();
    });

    it('libera quando existe vínculo explícito usuário × almoxarifado', async () => {
      prisma.userWarehouseAccess.findUnique.mockResolvedValue({ axisUserId: 'u1', warehouseId: 'wh1' });
      await expect(service.assertWarehouseAccess(user([]), 'wh1')).resolves.toBeUndefined();
      expect(prisma.userWarehouseAccess.findUnique).toHaveBeenCalledWith({
        where: { axisUserId_warehouseId: { axisUserId: 'u1', warehouseId: 'wh1' } },
      });
    });

    it('nega sem vínculo', async () => {
      await expect(service.assertWarehouseAccess(user([]), 'wh1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('accessibleWarehouseIds', () => {
    it('retorna ALL para quem tem warehouse:access_all', async () => {
      expect(await service.accessibleWarehouseIds(user(['warehouse:access_all']))).toBe('ALL');
      expect(prisma.userWarehouseAccess.findMany).not.toHaveBeenCalled();
    });

    it('retorna apenas os almoxarifados vinculados ao usuário', async () => {
      prisma.userWarehouseAccess.findMany.mockResolvedValue([{ warehouseId: 'wh1' }, { warehouseId: 'wh2' }]);
      expect(await service.accessibleWarehouseIds(user([], 'u9'))).toEqual(['wh1', 'wh2']);
      expect(prisma.userWarehouseAccess.findMany).toHaveBeenCalledWith({ where: { axisUserId: 'u9' }, select: { warehouseId: true } });
    });

    it('sem vínculos retorna lista vazia (nunca ALL)', async () => {
      expect(await service.accessibleWarehouseIds(user([]))).toEqual([]);
    });
  });

  describe('logisticsRolesFor', () => {
    it('sem perfis do Axis não consulta o banco', async () => {
      expect(await service.logisticsRolesFor([])).toEqual([]);
      expect(prisma.logisticsRole.findMany).not.toHaveBeenCalled();
    });
  });
});
