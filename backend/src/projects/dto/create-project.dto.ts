import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ProjectStatus } from '@prisma/client';

export class CreateProjectDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  costCenterId!: string;

  @IsUUID()
  responsibleCollaboratorId!: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
