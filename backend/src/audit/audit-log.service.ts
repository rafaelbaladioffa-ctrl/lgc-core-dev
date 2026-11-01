import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '@prisma/client';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        metadata: params.metadata,
      },
    });
  }
}
