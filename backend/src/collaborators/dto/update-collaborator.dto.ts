import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CollaboratorStatus } from '@prisma/client';
import { CreateCollaboratorDto } from './create-collaborator.dto.js';

export class UpdateCollaboratorDto extends PartialType(CreateCollaboratorDto) {
  // Not on CreateCollaboratorDto: every new collaborator starts "ativo" — status transitions
  // (ativo/afastado/ferias/desligado) only make sense on an existing record. "desligado" with its
  // offboarded_at stamp is still handled by the dedicated POST :id/offboard endpoint.
  @IsOptional()
  @IsEnum(CollaboratorStatus)
  status?: CollaboratorStatus;
}
