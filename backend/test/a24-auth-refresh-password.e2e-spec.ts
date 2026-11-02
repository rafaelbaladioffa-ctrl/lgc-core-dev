import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service.js';
import { requireBpmTestDatabaseUrl } from './support/bpm-test-database.js';

/**
 * A24 authentication fixture.
 *
 * This suite deliberately exercises the service contract instead of the running
 * Axis instance. It only runs when BPM_TEST_DATABASE_URL points at a local
 * database ending in _bpm_test; every record is synthetic and uniquely named.
 */
describe.skipIf(!process.env.BPM_TEST_DATABASE_URL)(
  'A24 — isolated login, refresh and password-change smoke',
  () => {
    let prisma: PrismaClient;
    let auth: AuthService;
    let userId: string;
    const initialPassword = 'A24-initial-password';
    const nextPassword = 'A24-next-password';

    beforeAll(async () => {
      const url = requireBpmTestDatabaseUrl();
      prisma = new PrismaClient({ datasources: { db: { url } } });
      await prisma.$connect();

      const jwt = new JwtService();
      const config = {
        get: (key: string) =>
          ({
            JWT_ACCESS_SECRET: 'a24-isolated-access-secret',
            JWT_REFRESH_SECRET: 'a24-isolated-refresh-secret',
            JWT_ACCESS_TTL: '15m',
            JWT_REFRESH_TTL: '7d',
          })[key],
      } as any;
      auth = new AuthService(prisma as any, jwt, config);

      const prefix = `a24-${randomUUID()}`;
      const role = await prisma.role.create({
        data: { name: `${prefix}-role` },
      });
      const jobTitle = await prisma.jobTitle.create({
        data: { name: `${prefix}-job` },
      });
      const sector = await prisma.sector.create({
        data: { code: prefix, name: `${prefix}-sector` },
      });
      const collaborator = await prisma.collaborator.create({
        data: {
          fullName: `${prefix}-collaborator`,
          rgEnc: 'synthetic',
          cpfEnc: 'synthetic',
          cpfHash: `${prefix}-cpf`,
          corporateEmail: `${prefix}@example.invalid`,
          matricula: `${prefix}-matricula`,
          sectorId: sector.id,
          jobTitleId: jobTitle.id,
        },
      });
      const user = await prisma.user.create({
        data: {
          email: `${prefix}@example.invalid`,
          passwordHash: await bcrypt.hash(initialPassword, 4),
          collaboratorId: collaborator.id,
          mustChangePassword: true,
          userRoles: { create: { roleId: role.id } },
        },
      });
      userId = user.id;
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it('rotates refresh tokens and completes an isolated forced password change', async () => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });

      const first = await auth.login(user.email, initialPassword);
      expect(first.accessToken).toEqual(expect.any(String));
      expect(first.refreshToken).toEqual(expect.any(String));

      const refreshed = await auth.refresh(first.refreshToken);
      expect(refreshed.accessToken).toEqual(expect.any(String));
      expect(refreshed.refreshToken).toEqual(expect.any(String));
      expect(refreshed.refreshToken).not.toBe(first.refreshToken);
      await expect(auth.refresh(first.refreshToken)).rejects.toThrow('revoked');

      const changed = await auth.changePassword(
        userId,
        initialPassword,
        nextPassword,
      );
      expect(changed.accessToken).toEqual(expect.any(String));
      expect(changed.refreshToken).toEqual(expect.any(String));

      const persisted = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(persisted.mustChangePassword).toBe(false);
      expect(await bcrypt.compare(nextPassword, persisted.passwordHash)).toBe(
        true,
      );
      expect(
        await bcrypt.compare(initialPassword, persisted.passwordHash),
      ).toBe(false);

      await expect(auth.login(user.email, initialPassword)).rejects.toThrow(
        'Invalid credentials',
      );
      const loggedInAgain = await auth.login(user.email, nextPassword);
      expect(loggedInAgain.accessToken).toEqual(expect.any(String));
      expect(loggedInAgain.refreshToken).toEqual(expect.any(String));
    }, 30000);
  },
);
