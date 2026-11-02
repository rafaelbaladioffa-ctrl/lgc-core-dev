import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RequestRuntimeService } from './request-runtime.service.js';

function runtimeWith(request: unknown) {
  const prisma = {
    request: { findUnique: vi.fn().mockResolvedValue(request) },
  } as any;
  const service = new RequestRuntimeService(prisma, {
    get: vi.fn((_: string, fallback?: string) => fallback),
  } as any);
  return { prisma, service };
}

describe('BPM executor separation', () => {
  it('returns WRONG_EXECUTOR for a new endpoint addressed to a legacy request', async () => {
    const fixture = runtimeWith({ id: 'legacy-request', executionMode: 'legacy' });

    await expect(
      (fixture.service as any).requestAccess('legacy-request', {
        userId: 'user-1',
        collaboratorId: 'collaborator-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      (fixture.service as any).requestAccess('legacy-request', {
        userId: 'user-1',
        collaboratorId: 'collaborator-1',
      }),
    ).rejects.toMatchObject({ response: { message: 'WRONG_EXECUTOR' } });
  });

  it('keeps an unknown request as not found', async () => {
    const fixture = runtimeWith(null);

    await expect(
      (fixture.service as any).requestAccess('missing-request', {
        userId: 'user-1',
        collaboratorId: 'collaborator-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
