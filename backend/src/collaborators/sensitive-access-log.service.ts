import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SensitiveAccessLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(collaboratorId: string, actorUserId: string, fields: string[]): Promise<void> {
    await this.prisma.sensitiveDataAccessLog.create({
      data: { collaboratorId, actorUserId, fields },
    });
  }
}
