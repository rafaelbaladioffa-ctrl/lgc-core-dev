import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { requireBpmTestDatabaseUrl } from './support/bpm-test-database.js';
// The dedicated database must be provisioned/migrated explicitly. This suite never
// uses DATABASE_URL, migrations, operational seeds, or pre-existing records.
describe.skipIf(!process.env.BPM_TEST_DATABASE_URL)(
  'BPM dedicated PostgreSQL persistence',
  () => {
    let first: PrismaClient;
    let second: PrismaClient;
    const actor = `bpm-fixture-${randomUUID()}`;
    const ids: string[] = [];
    beforeAll(async () => {
      const url = requireBpmTestDatabaseUrl();
      first = new PrismaClient({ datasources: { db: { url } } });
      second = new PrismaClient({ datasources: { db: { url } } });
      await Promise.all([first.$connect(), second.$connect()]);
    });
    afterAll(async () => {
      if (first) {
        await first.requestCommandReceipt.deleteMany({
          where: { actorUserId: actor, id: { in: ids } },
        });
        await first.$disconnect();
      }
      await second?.$disconnect();
    });
    const data = (key: string) => ({
      commandId: randomUUID(),
      actorUserId: actor,
      key,
      routeScope: 'fixture',
      requestHash: 'test-hash',
      statusCode: 200,
      resultRef: { fixture: true },
    });
    it('enforces receipt uniqueness across two clients and survives client restart', async () => {
      const key = randomUUID();
      const results = await Promise.allSettled([
        first.requestCommandReceipt.create({ data: data(key) }),
        second.requestCommandReceipt.create({ data: data(key) }),
      ]);
      const successes = results.filter((r) => r.status === 'fulfilled');
      for (const result of successes)
        if (result.status === 'fulfilled') ids.push(result.value.id);
      expect(successes).toHaveLength(1);
      await second.$disconnect();
      await second.$connect();
      expect(
        await second.requestCommandReceipt.count({
          where: { actorUserId: actor, key },
        }),
      ).toBe(1);
    });
    it('rolls back a receipt when the command transaction fails', async () => {
      const key = randomUUID();
      await expect(
        first.$transaction(async (tx) => {
          await tx.requestCommandReceipt.create({ data: data(key) });
          throw new Error('fixture failpoint');
        }),
      ).rejects.toThrow('fixture failpoint');
      expect(
        await second.requestCommandReceipt.count({
          where: { actorUserId: actor, key },
        }),
      ).toBe(0);
    });
  },
);
