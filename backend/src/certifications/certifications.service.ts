import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCertificationDto } from './dto/create-certification.dto.js';
import { UpdateCertificationDto } from './dto/update-certification.dto.js';

const EXPIRY_WARNING_WINDOW_DAYS = 30;

@Injectable()
export class CertificationsService {
  private readonly logger = new Logger(CertificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCertificationDto) {
    return this.prisma.technicianCertification.create({
      data: {
        collaboratorId: dto.collaboratorId,
        type: dto.type,
        issuedAt: new Date(dto.issuedAt),
        expiresAt: new Date(dto.expiresAt),
      },
    });
  }

  findAllForCollaborator(collaboratorId: string) {
    return this.prisma.technicianCertification.findMany({
      where: { collaboratorId },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async update(id: string, dto: UpdateCertificationDto) {
    await this.getOrThrow(id);
    return this.prisma.technicianCertification.update({
      where: { id },
      data: {
        type: dto.type,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }

  async remove(id: string) {
    await this.getOrThrow(id);
    await this.prisma.technicianCertification.delete({ where: { id } });
  }

  /** Certifications already expired or expiring within the warning window. */
  findExpiring(windowDays = EXPIRY_WARNING_WINDOW_DAYS) {
    const threshold = new Date(Date.now() + windowDays * 86_400_000);
    return this.prisma.technicianCertification.findMany({
      where: { expiresAt: { lte: threshold } },
      include: { collaborator: { select: { id: true, fullName: true, corporateEmail: true } } },
      orderBy: { expiresAt: 'asc' },
    });
  }

  private async getOrThrow(id: string) {
    const cert = await this.prisma.technicianCertification.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('Certification not found');
    return cert;
  }

  /** Daily job: logs certifications nearing expiry so they surface in app logs/alerting. */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async checkExpiringCertifications() {
    const expiring = await this.findExpiring();
    if (expiring.length === 0) return;
    this.logger.warn(`${expiring.length} technician certification(s) expired or expiring within ${EXPIRY_WARNING_WINDOW_DAYS} days`);
    for (const cert of expiring) {
      this.logger.warn(
        `Certification ${cert.type} for ${cert.collaborator.fullName} (${cert.collaborator.corporateEmail}) expires at ${cert.expiresAt.toISOString()}`,
      );
    }
  }
}
