import { IsDateString, IsEnum, IsUUID } from 'class-validator';
import { CertificationType } from '@prisma/client';

export class CreateCertificationDto {
  @IsUUID()
  collaboratorId!: string;

  @IsEnum(CertificationType)
  type!: CertificationType;

  @IsDateString()
  issuedAt!: string;

  @IsDateString()
  expiresAt!: string;
}
